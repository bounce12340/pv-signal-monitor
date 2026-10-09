// Routing and authentication boundary of worker/index.ts for the AE case API.
// The AE handlers themselves are covered in worker/ae/*.test.ts; this file
// proves that only a verified Access identity ever reaches them, and that
// they only ever see the AE bindings.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { resetJwksCache } from './accessJwt';

const domain = 'test.cloudflareaccess.com';
const aud = 'test-aud';
let pair: CryptoKeyPair;
let jwk: JsonWebKey;

beforeAll(async () => {
  pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey;
});
beforeEach(() => {
  resetJwksCache();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [{ ...jwk, kid: 'test-key' }] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
async function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const h = b64({ alg: 'RS256', kid: 'test-key', ...header });
  const p = b64({ iss: `https://${domain}`, aud, email: 'pv@example.test', exp: Math.floor(Date.now() / 1000) + 60, ...claims });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}

// A D1 stand-in that records every query, so a test can prove which database was touched.
function fakeDb(name: string, log: string[]) {
  return {
    prepare(query: string) {
      log.push(`${name}: ${query.trim().split(/\s+/).slice(0, 4).join(' ')}`);
      const stmt = {
        bind: () => stmt,
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      };
      return stmt;
    },
    batch: async () => [],
  };
}

const baseEnv = (over: Record<string, unknown> = {}) => ({
  ASSETS: { fetch: async () => new Response('asset') },
  ACCESS_TEAM_DOMAIN: domain,
  ACCESS_AUD: aud,
  ...over,
}) as any;

const call = (path: string, env: any, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://pv.example.test${path}`, { ...init, headers }), env);

describe('AE API authentication boundary', () => {
  it('lets a validly signed Access token through to the AE handler', async () => {
    const res = await call('/api/me', baseEnv({ AE_DB: fakeDb('ae', []) }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe('pv@example.test');
  });

  it.each([
    { exp: undefined }, { exp: 0 }, { exp: '9999999999' }, { exp: null },
    { iss: undefined }, { iss: 'https://other.test' },
    { nbf: 'tomorrow' }, { nbf: 9999999999 }, { nbf: null },
    { aud: 'wrong' }, { aud: undefined },
  ])('rejects invalid required claims %j', async (claims) => {
    const res = await call('/api/me', baseEnv({ AE_DB: fakeDb('ae', []) }), { 'Cf-Access-Jwt-Assertion': await token(claims) });
    expect(res.status).toBe(401);
  });

  it('rejects an algorithm label inconsistent with the pinned verifier', async () => {
    const res = await call('/api/me', baseEnv({ AE_DB: fakeDb('ae', []) }), { 'Cf-Access-Jwt-Assertion': await token({}, { alg: 'HS256' }) });
    expect(res.status).toBe(401);
  });

  it('does not accept the plain Access email header', async () => {
    const res = await call('/api/ae-reports', baseEnv({ AE_DB: fakeDb('ae', []) }), { 'Cf-Access-Authenticated-User-Email': 'pv@example.test' });
    expect(res.status).toBe(401);
  });

  it.each([{ ACCESS_AUD: undefined }, { ACCESS_TEAM_DOMAIN: undefined }])('fails closed when Access is half-configured %j', async (settings) => {
    const res = await call('/api/me', baseEnv({ AE_DB: fakeDb('ae', []), ...settings }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(503);
  });

  it('does not let the wrangler dev shortcut paper over a half-configured Access', async () => {
    const res = await call('/api/me', baseEnv({ AE_DB: fakeDb('ae', []), ACCESS_AUD: undefined, DEV_MODE: 'true' }));
    expect(res.status).toBe(503);
  });

  it('fails closed when Access is not configured at all, outside wrangler dev', async () => {
    const res = await call('/api/me', baseEnv({ AE_DB: fakeDb('ae', []), ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(503);
  });

  it('accepts the CF_Authorization cookie as a fallback carrier for the same signed token', async () => {
    const res = await call('/api/me', baseEnv({ AE_DB: fakeDb('ae', []) }), { Cookie: `theme=dark; CF_Authorization=${await token()}` });
    expect(res.status).toBe(200);
  });
});

describe('AE API bindings', () => {
  it('only ever touches AE_DB, never the sync snapshots database', async () => {
    const log: string[] = [];
    const env = baseEnv({ DB: fakeDb('snapshots', log), AE_DB: fakeDb('ae', log) });
    await call('/api/ae-reports', env, { 'Cf-Access-Jwt-Assertion': await token() });
    await call('/api/me', env, { 'Cf-Access-Jwt-Assertion': await token() });
    expect(log.length).toBeGreaterThan(0);
    expect(log.filter(l => l.startsWith('snapshots'))).toEqual([]);
  });

  it('reports a missing AE_DB binding instead of falling back to the snapshots database', async () => {
    const log: string[] = [];
    const res = await call('/api/ae-reports', baseEnv({ DB: fakeDb('snapshots', log) }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(501);
    expect(log).toEqual([]);
  });
});

describe('routing leaves existing endpoints alone', () => {
  it('still serves /api/sync from the snapshots database', async () => {
    const log: string[] = [];
    const res = await call('/api/sync/latest', baseEnv({ DB: fakeDb('snapshots', log), AE_DB: fakeDb('ae', log), AE_PV_EMAILS: 'pv@example.test' }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(200);
    expect(log.some(l => l.startsWith('snapshots'))).toBe(true);
  });

  it('does not route look-alike paths to the AE API', async () => {
    const log: string[] = [];
    const res = await call('/api/ae-reportsX', baseEnv({ DB: fakeDb('snapshots', log), AE_DB: fakeDb('ae', log), AE_PV_EMAILS: 'pv@example.test' }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(404);
    expect(log.filter(l => l.startsWith('ae'))).toEqual([]);
  });

  it('serves static assets as before', async () => {
    const res = await call('/', baseEnv());
    expect(await res.text()).toBe('asset');
  });
});

describe('LLM proxies are PV-only', () => {
  // Upstream stand-in: records proxied calls; JWKS lookups still answer with the test key.
  function upstream(log: string[]) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflareaccess.com')) return Response.json({ keys: [{ ...jwk, kid: 'test-key' }] });
      log.push(url);
      return Response.json({ ok: true });
    }));
  }
  const roleDb = (role: string | null) => ({
    prepare: () => {
      const stmt = { bind: () => stmt, first: async () => (role ? { role } : null) };
      return stmt;
    },
  });
  const chat = (path: string, env: any, headers: Record<string, string>) =>
    call(path, env, { 'Content-Type': 'application/json', ...headers }, { method: 'POST', body: '{"messages":[]}' });

  it.each(['/llm/chat/completions', '/ollama-cloud/v1/chat/completions'])('proxies %s for a PV listed in AE_PV_EMAILS', async (path) => {
    const log: string[] = [];
    upstream(log);
    const res = await chat(path, baseEnv({ AE_PV_EMAILS: 'pv@example.test', AE_DB: roleDb(null) }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(200);
    expect(log).toHaveLength(1);
  });

  it('proxies for a PV recorded in ae_users', async () => {
    const log: string[] = [];
    upstream(log);
    const res = await chat('/llm/chat/completions', baseEnv({ AE_DB: roleDb('pv') }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(200);
  });

  it.each(['/llm/chat/completions', '/ollama-cloud/v1/chat/completions'])('refuses %s to a rep without reaching upstream', async (path) => {
    const log: string[] = [];
    upstream(log);
    const res = await chat(path, baseEnv({ AE_PV_EMAILS: 'someone-else@example.test', AE_DB: roleDb('rep') }), { 'Cf-Access-Jwt-Assertion': await token({ email: 'rep@example.test' }) });
    expect(res.status).toBe(403);
    expect(log).toEqual([]);
  });

  it('refuses everyone when no PV source is configured (fails closed)', async () => {
    const log: string[] = [];
    upstream(log);
    const res = await chat('/llm/chat/completions', baseEnv(), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(403);
    expect(log).toEqual([]);
  });

  it('requires a verified token, not the plain email header', async () => {
    const log: string[] = [];
    upstream(log);
    const res = await chat('/llm/chat/completions', baseEnv({ AE_PV_EMAILS: 'pv@example.test' }), { 'Cf-Access-Authenticated-User-Email': 'pv@example.test' });
    expect(res.status).toBe(401);
    expect(log).toEqual([]);
  });
});

describe('/api/sync is PV-only', () => {
  // Snapshots stand-in that records the bound user_email of every query, so a
  // test can prove whose snapshot was read or written — and that a refused
  // caller never reached the database at all.
  function snapshotsDb(bound: unknown[][]) {
    return {
      prepare: () => {
        const stmt = {
          bind: (...values: unknown[]) => { bound.push(values); return stmt; },
          first: async () => null,
          run: async () => ({ meta: { changes: 1 } }),
        };
        return stmt;
      },
    };
  }
  const roleDb = (role: string | null) => ({
    prepare: () => {
      const stmt = { bind: () => stmt, first: async () => (role ? { role } : null) };
      return stmt;
    },
  });
  const put = (env: any, headers: Record<string, string>) =>
    call('/api/sync', env, { 'Content-Type': 'application/json', ...headers }, {
      method: 'PUT', body: JSON.stringify({ device: 'test', data: { schema: 'pv-signal-monitor-backup' } }),
    });

  it('serves a PV listed in AE_PV_EMAILS, keyed by the verified email', async () => {
    const bound: unknown[][] = [];
    const res = await call('/api/sync/latest', baseEnv({ DB: snapshotsDb(bound), AE_DB: roleDb(null), AE_PV_EMAILS: 'pv@example.test' }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(200);
    expect(bound).toEqual([['pv@example.test']]);
  });

  it('serves a PV recorded in ae_users', async () => {
    const bound: unknown[][] = [];
    const res = await put(baseEnv({ DB: snapshotsDb(bound), AE_DB: roleDb('pv') }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(200);
    expect(bound.length).toBeGreaterThan(0);
    expect(bound.every(values => values[0] === 'pv@example.test')).toBe(true);
  });

  it.each([
    ['GET', '/api/sync/latest'],
    ['GET', '/api/sync/data'],
    ['PUT', '/api/sync'],
  ])('refuses %s %s to a rep without touching the snapshots database', async (method, path) => {
    const bound: unknown[][] = [];
    const env = baseEnv({ DB: snapshotsDb(bound), AE_DB: roleDb('rep'), AE_PV_EMAILS: 'someone-else@example.test' });
    const headers = { 'Cf-Access-Jwt-Assertion': await token({ email: 'rep@example.test' }) };
    const res = method === 'PUT' ? await put(env, headers) : await call(path, env, headers);
    expect(res.status).toBe(403);
    expect(bound).toEqual([]);
  });

  it('refuses everyone when no PV source is configured (fails closed)', async () => {
    const bound: unknown[][] = [];
    const res = await put(baseEnv({ DB: snapshotsDb(bound) }), { 'Cf-Access-Jwt-Assertion': await token() });
    expect(res.status).toBe(403);
    expect(bound).toEqual([]);
  });

  it('refuses a verified token that carries no email', async () => {
    const bound: unknown[][] = [];
    const res = await call('/api/sync/latest', baseEnv({ DB: snapshotsDb(bound), AE_DB: roleDb('pv'), AE_PV_EMAILS: 'pv@example.test' }), { 'Cf-Access-Jwt-Assertion': await token({ email: undefined }) });
    expect(res.status).toBe(403);
    expect(bound).toEqual([]);
  });

  it('no longer trusts the plain Access email header', async () => {
    const bound: unknown[][] = [];
    const res = await call('/api/sync/latest', baseEnv({ DB: snapshotsDb(bound), AE_PV_EMAILS: 'pv@example.test' }), { 'Cf-Access-Authenticated-User-Email': 'pv@example.test' });
    expect(res.status).toBe(401);
    expect(bound).toEqual([]);
  });

  it('keeps the wrangler dev shortcut, but only for a dev identity listed as PV', async () => {
    const bound: unknown[][] = [];
    const dev = { DB: snapshotsDb(bound), ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined, DEV_MODE: 'true' };
    expect((await call('/api/sync/latest', baseEnv(dev))).status).toBe(403);
    expect(bound).toEqual([]);
    expect((await call('/api/sync/latest', baseEnv({ ...dev, AE_PV_EMAILS: 'dev@local' }))).status).toBe(200);
    expect(bound).toEqual([['dev@local']]);
  });
});

describe('Future AGI tracing of the LLM proxies (metadata only)', () => {
  const FI_TRACES = 'https://api.futureagi.com/tracer/v1/traces';
  const tracingEnv = (over: Record<string, unknown> = {}) => baseEnv({
    AE_PV_EMAILS: 'pv@example.test',
    FI_API_KEY: 'fi-key',
    FI_SECRET_KEY: 'fi-secret',
    ...over,
  });
  // Collects ctx.waitUntil work so a test can await the background export.
  const makeCtx = () => {
    const pending: Promise<unknown>[] = [];
    return { ctx: { waitUntil: (p: Promise<unknown>) => { pending.push(p); } }, settle: () => Promise.all(pending) };
  };
  const completion = {
    id: 'c1', model: 'deepseek-v4-pro',
    choices: [{ message: { role: 'assistant', content: 'SECRET-AE-NARRATIVE' } }],
    usage: { prompt_tokens: 321, completion_tokens: 54, total_tokens: 375 },
  };
  // Upstream + Future AGI stand-in. `exports` gets every Future AGI POST.
  function stubNetwork(exports: { url: string; init: RequestInit }[], opts: { upstreamStatus?: number; fiFails?: boolean } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes('cloudflareaccess.com')) return Response.json({ keys: [{ ...jwk, kid: 'test-key' }] });
      if (url.startsWith('https://api.futureagi.com')) {
        exports.push({ url, init });
        if (opts.fiFails) throw new Error('collector down');
        return new Response(null, { status: 200 });
      }
      return Response.json(completion, { status: opts.upstreamStatus ?? 200 });
    }));
  }
  const post = async (env: any, ctx: any, body = '{"model":"","messages":[{"role":"user","content":"SECRET-PROMPT"}]}') =>
    worker.fetch(new Request('https://pv.example.test/llm/chat/completions', {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': await token() },
    }), env, ctx);
  const attrsOf = (payload: any) => Object.fromEntries(
    payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a: any) => [a.key, a.value.stringValue ?? Number(a.value.intValue)]),
  );

  it('sends nothing without FI keys', async () => {
    const exports: any[] = [];
    stubNetwork(exports);
    const { ctx, settle } = makeCtx();
    const res = await post(baseEnv({ AE_PV_EMAILS: 'pv@example.test' }), ctx);
    await settle();
    expect(res.status).toBe(200);
    expect(exports).toEqual([]);
  });

  it('reports model, tokens and status but no content or identity', async () => {
    const exports: { url: string; init: RequestInit }[] = [];
    stubNetwork(exports);
    const { ctx, settle } = makeCtx();
    const res = await post(tracingEnv({ LLM_MODEL: 'deepseek-v4-pro' }), ctx);

    // The browser still gets the full, unmodified completion.
    expect(await res.json()).toEqual(completion);
    await settle();

    expect(exports).toHaveLength(1);
    expect(exports[0].url).toBe(FI_TRACES);
    const headers = new Headers(exports[0].init.headers);
    expect(headers.get('X-Api-Key')).toBe('fi-key');
    expect(headers.get('X-Secret-Key')).toBe('fi-secret');
    expect(headers.get('Content-Type')).toBe('application/json');

    const raw = String(exports[0].init.body);
    expect(raw).not.toContain('SECRET-PROMPT');
    expect(raw).not.toContain('SECRET-AE-NARRATIVE');
    expect(raw).not.toContain('pv@example.test');
    expect(raw).not.toContain('fi-key');

    const payload = JSON.parse(raw);
    const resource = Object.fromEntries(payload.resourceSpans[0].resource.attributes.map((a: any) => [a.key, a.value.stringValue]));
    expect(resource.project_name).toBe('pv-signal-monitor');
    expect(resource.project_type).toBe('observe');
    expect(attrsOf(payload)).toMatchObject({
      'gen_ai.span.kind': 'LLM',
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'ollama',
      'gen_ai.request.model': 'deepseek-v4-pro', // injected by LLM_MODEL
      'gen_ai.response.model': 'deepseek-v4-pro',
      'gen_ai.usage.input_tokens': 321,
      'gen_ai.usage.output_tokens': 54,
      'gen_ai.usage.total_tokens': 375,
      'http.response.status_code': 200,
      'url.path': '/v1/chat/completions',
      'pv.proxy_route': '/llm',
    });
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].status.code).toBe(1);
  });

  it('honours FI_PROJECT_NAME and FI_BASE_URL', async () => {
    const exports: any[] = [];
    stubNetwork(exports);
    const { ctx, settle } = makeCtx();
    await post(tracingEnv({ FI_PROJECT_NAME: 'pv-staging', FI_BASE_URL: 'https://api.futureagi.com/' }), ctx);
    await settle();
    const payload = JSON.parse(String(exports[0].init.body));
    expect(exports[0].url).toBe(FI_TRACES); // trailing slash trimmed
    expect(payload.resourceSpans[0].resource.attributes[0].value.stringValue).toBe('pv-staging');
  });

  it('marks an upstream error as a failed span', async () => {
    const exports: any[] = [];
    stubNetwork(exports, { upstreamStatus: 500 });
    const { ctx, settle } = makeCtx();
    const res = await post(tracingEnv(), ctx);
    await settle();
    expect(res.status).toBe(500);
    const payload = JSON.parse(String(exports[0].init.body));
    expect(payload.resourceSpans[0].scopeSpans[0].spans[0].status).toEqual({ code: 2, message: 'HTTP 500' });
  });

  it('never lets a Future AGI failure affect the proxied response', async () => {
    const exports: any[] = [];
    stubNetwork(exports, { fiFails: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, settle } = makeCtx();
    const res = await post(tracingEnv(), ctx);
    expect(await res.json()).toEqual(completion);
    await expect(settle()).resolves.toBeDefined();
    expect(exports).toHaveLength(1);
  });

  it('does not trace GET (model list) calls or calls without a ctx', async () => {
    const exports: any[] = [];
    stubNetwork(exports);
    const { ctx, settle } = makeCtx();
    await worker.fetch(new Request('https://pv.example.test/llm/models', {
      headers: { 'Cf-Access-Jwt-Assertion': await token() },
    }), tracingEnv(), ctx);
    await post(tracingEnv(), undefined);
    await settle();
    expect(exports).toEqual([]);
  });
});
