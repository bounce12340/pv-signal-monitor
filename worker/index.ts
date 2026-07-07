// Cloudflare Worker: serves the built SPA (static assets) and proxies
// /ollama-cloud/* to https://ollama.com, which sends no CORS headers and
// therefore cannot be called from the browser directly. The user's API key
// passes through in the Authorization header and is never stored here.

interface Env {
  ASSETS: { fetch: typeof fetch };
}

// Only the Ollama API surfaces the app actually uses.
const ALLOWED_PREFIXES = ['/v1/', '/api/'];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
