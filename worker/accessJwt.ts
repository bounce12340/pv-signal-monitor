// Cloudflare Access JWT verification (ported from PV-Link's worker/index.js).
//
// The AE case API records *who* did what in an append-only audit trail, so its
// identity has to be something the client cannot forge. The
// Cf-Access-Authenticated-User-Email header that /api/sync trusts is only as
// good as the perimeter in front of it; the signed Cf-Access-Jwt-Assertion is
// verifiable on its own (signature, issuer, audience, expiry), so the audit
// trail never depends on a header being stripped correctly upstream.

export interface AccessPayload {
  email?: string;
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  [claim: string]: unknown;
}

// Cached per isolate so a burst of requests doesn't refetch the certs each time.
let jwksCache: { domain: string | null; keys: JsonWebKey[] | null; at: number } = { domain: null, keys: null, at: 0 };
const JWKS_TTL_MS = 3600_000;

async function getJwks(teamDomain: string): Promise<JsonWebKey[]> {
  const now = Date.now();
  if (jwksCache.domain === teamDomain && jwksCache.keys && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`fetch certs failed ${res.status}`);
  const { keys } = (await res.json()) as { keys: JsonWebKey[] };
  jwksCache = { domain: teamDomain, keys, at: now };
  return keys;
}

/** Test hook: a new signing key in a test must not be masked by a cached one. */
export function resetJwksCache(): void {
  jwksCache = { domain: null, keys: null, at: 0 };
}

function b64urlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const b64urlToJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/** Returns the verified payload, or throws. Every required claim fails closed when missing. */
export async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<AccessPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  const [h, p, s] = parts;
  const header = b64urlToJson(h);
  // Pin the algorithm: trusting the token's own `alg` label is the classic downgrade.
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('unsupported signing header');
  }
  const jwk = (await getJwks(teamDomain)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error('signing key not found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');
  const payload = b64urlToJson(p) as AccessPayload;
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || now >= (payload.exp as number)) throw new Error('missing or expired exp');
  if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || now < payload.nbf)) throw new Error('invalid nbf');
  if (payload.iss !== `https://${teamDomain}`) throw new Error('issuer mismatch');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('aud mismatch');
  return payload;
}
