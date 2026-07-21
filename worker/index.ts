// Cloudflare Worker: serves the built SPA (static assets), proxies the
// platform-default LLM route (/llm/*, backing services/llm.ts's same-origin
// mode) plus the legacy Ollama Cloud alias (/ollama-cloud/*) to an
// OpenAI-compatible upstream (no CORS upstream), and exposes the /api/sync
// endpoints backed by D1 for cross-device data sync.
//
// Identity for /api/* comes from the Cf-Access-Authenticated-User-Email
// header that Cloudflare Access injects after login. The only route to this
// Worker is the custom domain in wrangler.jsonc, which sits entirely behind
// Access (workers.dev is off), so a request without that header is not a
// legitimate one. The /llm
// and /ollama-cloud routes rely on that same perimeter (no per-request
// identity check, no CORS allowlist needed since callers are same-origin).

// Minimal D1 typings so the project needs no @cloudflare/workers-types dep.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

// Minimal KV typing, same rationale as the D1 typings above.
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  ASSETS: { fetch: typeof fetch };
  DB: D1Database;
  // Only ever set by `wrangler dev --var DEV_MODE:true`; never in
  // wrangler.jsonc, so production deployments cannot carry it.
  DEV_MODE?: string;
  // Set via `wrangler secret put OLLAMA_API_KEY`. Injected only when the
  // client sends no Authorization header, so a browser-stored key still wins.
  // Safe to inject because the only route (the custom domain in
  // wrangler.jsonc) sits behind Cloudflare Access; workers.dev is
  // disabled there for exactly this reason. Reused (not
  // renamed) so the existing secret keeps working for both proxy routes.
  OLLAMA_API_KEY?: string;
  // Upstream OpenAI-compatible root for /llm/*, e.g. "https://ollama.com/v1"
  // (its default). Includes any base path the upstream needs, since /llm's
  // stripped request path (e.g. "/chat/completions") is appended directly.
  LLM_BASE_URL?: string;
  // Default model injected into JSON proxy bodies that carry no model of
  // their own (services/llm.ts platform mode sends model: '').
  LLM_MODEL?: string;
  // Fixed-window rate limiter shared by both LLM proxy routes, ported from
  // PV-Link's worker. Unbound → limiter is skipped (fail-open).
  RATE_LIMIT?: KVNamespace;
  RATE_LIMIT_MAX?: string;
}

// Legacy /ollama-cloud/* clients (SettingsModal's "Ollama Cloud" preset) send
// the upstream's own /v1/... or /api/... segment themselves; require it so
// that alias can't be used to reach arbitrary paths on ollama.com.
const ALLOWED_UPSTREAM_PREFIXES = ['/v1/', '/api/'];

// Default upstream for /llm/* when LLM_BASE_URL isn't set (dev convenience;
// production sets it explicitly in wrangler.jsonc).
const DEFAULT_LLM_BASE_URL = 'https://ollama.com/v1';

// Snapshot history kept per user (point-in-time recovery).
const SNAPSHOTS_KEPT = 20;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function identity(request: Request, env: Env): string | null {
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (email) return email;
  // wrangler dev runs without Access in front; never reachable in production.
  if (env.DEV_MODE === 'true') return 'dev@local';
  return null;
}

async function handleSync(request: Request, env: Env, url: URL): Promise<Response> {
  const email = identity(request, env);
  if (!email) return json({ error: 'unauthenticated' }, 401);

  if (request.method === 'GET' && url.pathname === '/api/sync/latest') {
    const row = await env.DB
      .prepare('SELECT updated_at, device FROM snapshots WHERE user_email = ?1 ORDER BY id DESC LIMIT 1')
      .bind(email)
      .first<{ updated_at: string; device: string }>();
    return json(row ?? { updated_at: null, device: null });
  }

  if (request.method === 'GET' && url.pathname === '/api/sync/data') {
    const row = await env.DB
      .prepare('SELECT updated_at, device, data FROM snapshots WHERE user_email = ?1 ORDER BY id DESC LIMIT 1')
      .bind(email)
      .first<{ updated_at: string; device: string; data: string }>();
    if (!row) return json({ error: 'no snapshot' }, 404);
    return json({ updated_at: row.updated_at, device: row.device, data: JSON.parse(row.data) });
  }

  if (request.method === 'PUT' && url.pathname === '/api/sync') {
    let body: { device?: unknown; data?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    const data = body.data as Record<string, unknown> | undefined;
    if (!data || data.schema !== 'pv-signal-monitor-backup') {
      return json({ error: 'not a pv-signal-monitor backup payload' }, 400);
    }
    const device = typeof body.device === 'string' ? body.device.slice(0, 100) : '';
    const updatedAt = new Date().toISOString();

    await env.DB
      .prepare('INSERT INTO snapshots (user_email, updated_at, device, data) VALUES (?1, ?2, ?3, ?4)')
      .bind(email, updatedAt, device, JSON.stringify(data))
      .run();
    await env.DB
      .prepare(
        `DELETE FROM snapshots WHERE user_email = ?1 AND id NOT IN
         (SELECT id FROM snapshots WHERE user_email = ?1 ORDER BY id DESC LIMIT ${SNAPSHOTS_KEPT})`
      )
      .bind(email)
      .run();
    return json({ updated_at: updatedAt });
  }

  return json({ error: 'not found' }, 404);
}

// Fixed-window per-IP rate limit, ported from PV-Link's worker. Returns true
// when the caller should be rejected with 429. Fails open (never blocks) when
// RATE_LIMIT isn't bound, or if the KV call itself throws.
async function isRateLimited(request: Request, env: Env): Promise<boolean> {
  if (!env.RATE_LIMIT) return false;
  try {
    const max = Number(env.RATE_LIMIT_MAX || '30');
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const windowStart = Math.floor(Date.now() / 60000); // 60s fixed window
    const key = `rl:${ip}:${windowStart}`;
    const current = Number((await env.RATE_LIMIT.get(key)) || '0');
    if (current >= max) return true;
    await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 120 });
    return false;
  } catch {
    return false; // KV unavailable → don't block real traffic over it.
  }
}

interface ProxyRoute {
  // Path prefix this request matched on (e.g. '/llm', '/ollama-cloud').
  prefix: string;
  // Upstream origin (+ optional base path) the stripped request path is
  // appended to.
  upstreamBase: string;
  // See ALLOWED_UPSTREAM_PREFIXES above; only the legacy alias needs this.
  requireUpstreamPrefix?: boolean;
}

// Shared by /llm/* and /ollama-cloud/*: strips the route prefix, forwards
// method/body/content-type to `route.upstreamBase`, injects OLLAMA_API_KEY
// as a bearer token when the caller sent no Authorization of its own, and
// streams the upstream response straight back.
async function proxyLlm(request: Request, env: Env, url: URL, route: ProxyRoute): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  const upstreamPath = url.pathname.slice(route.prefix.length);
  if (route.requireUpstreamPrefix && !ALLOWED_UPSTREAM_PREFIXES.some((p) => upstreamPath.startsWith(p))) {
    return new Response('Not found', { status: 404 });
  }
  if (await isRateLimited(request, env)) {
    return json({ error: 'rate limit exceeded, please retry later' }, 429);
  }

  const headers = new Headers();
  const auth = request.headers.get('Authorization');
  if (auth) headers.set('Authorization', auth);
  else if (env.OLLAMA_API_KEY) headers.set('Authorization', `Bearer ${env.OLLAMA_API_KEY}`);
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);

  // JSON bodies without a model get the platform default injected; anything
  // else (non-JSON, unparseable, model already set) is forwarded verbatim.
  let body: BodyInit | null | undefined = request.method === 'GET' ? undefined : request.body;
  if (body && env.LLM_MODEL && (contentType || '').includes('application/json')) {
    const text = await request.text();
    body = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !parsed.model) {
        parsed.model = env.LLM_MODEL;
        body = JSON.stringify(parsed);
      }
    } catch {
      // forward original text unchanged
    }
  }

  const upstream = await fetch(`${route.upstreamBase}${upstreamPath}${url.search}`, {
    method: request.method,
    headers,
    body,
  });
  return new Response(upstream.body, upstream);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleSync(request, env, url);
    }

    // Platform-default LLM proxy backing services/llm.ts's same-origin mode.
    if (url.pathname.startsWith('/llm/')) {
      return proxyLlm(request, env, url, {
        prefix: '/llm',
        upstreamBase: env.LLM_BASE_URL || DEFAULT_LLM_BASE_URL,
      });
    }

    // Compatibility alias for the pre-merge SettingsModal "Ollama Cloud"
    // preset ('/ollama-cloud/v1' base URL); always targets ollama.com
    // directly regardless of LLM_BASE_URL.
    if (url.pathname.startsWith('/ollama-cloud/')) {
      return proxyLlm(request, env, url, {
        prefix: '/ollama-cloud',
        upstreamBase: 'https://ollama.com',
        requireUpstreamPrefix: true,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
