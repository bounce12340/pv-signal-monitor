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

  it('does not accept the plain email header that /api/sync trusts', async () => {
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
  it('still serves /api/sync from the snapshots database with the Access email header', async () => {
    const log: string[] = [];
    const res = await call('/api/sync/latest', baseEnv({ DB: fakeDb('snapshots', log), AE_DB: fakeDb('ae', log) }), { 'Cf-Access-Authenticated-User-Email': 'a@example.test' });
    expect(res.status).toBe(200);
    expect(log.every(l => l.startsWith('snapshots'))).toBe(true);
  });

  it('does not route look-alike paths to the AE API', async () => {
    const log: string[] = [];
    const res = await call('/api/ae-reportsX', baseEnv({ DB: fakeDb('snapshots', log), AE_DB: fakeDb('ae', log) }), { 'Cf-Access-Authenticated-User-Email': 'a@example.test' });
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
