// Cloudflare Worker: serves the built SPA (static assets), proxies
// /ollama-cloud/* to https://ollama.com (no CORS upstream), and exposes the
// /api/sync endpoints backed by D1 for cross-device data sync.
//
// Identity comes from the Cf-Access-Authenticated-User-Email header that
// Cloudflare Access injects after login. The only route to this Worker is
// pv.uic-ai.com, which sits entirely behind Access (workers.dev is off), so
// a request without that header is not a legitimate one.

// Minimal D1 typings so the project needs no @cloudflare/workers-types dep.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  ASSETS: { fetch: typeof fetch };
  DB: D1Database;
  // Only ever set by `wrangler dev --var DEV_MODE:true`; never in
  // wrangler.jsonc, so production deployments cannot carry it.
  DEV_MODE?: string;
  // Set via `wrangler secret put OLLAMA_API_KEY`. Injected only when the
  // client sends no Authorization header, so a browser-stored key still wins.
  // Safe to inject because the only route (pv.uic-ai.com) sits behind
  // Cloudflare Access; workers.dev is disabled in wrangler.jsonc.
  OLLAMA_API_KEY?: string;
}

// Only the Ollama API surfaces the app actually uses.
const ALLOWED_PREFIXES = ['/v1/', '/api/'];

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleSync(request, env, url);
    }

    if (url.pathname.startsWith('/ollama-cloud/')) {
      if (request.method !== 'GET' && request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      const upstreamPath = url.pathname.replace(/^\/ollama-cloud/, '');
      if (!ALLOWED_PREFIXES.some((p) => upstreamPath.startsWith(p))) {
        return new Response('Not found', { status: 404 });
      }

      const headers = new Headers();
      const auth = request.headers.get('Authorization');
      if (auth) headers.set('Authorization', auth);
      else if (env.OLLAMA_API_KEY) headers.set('Authorization', `Bearer ${env.OLLAMA_API_KEY}`);
      const contentType = request.headers.get('Content-Type');
      if (contentType) headers.set('Content-Type', contentType);

      const upstream = await fetch(`https://ollama.com${upstreamPath}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === 'GET' ? undefined : request.body,
      });
      return new Response(upstream.body, upstream);
    }

    return env.ASSETS.fetch(request);
  },
};
