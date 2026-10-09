// Optional Future AGI tracing for the /llm and /ollama-cloud proxies.
//
// Off unless both FI_API_KEY and FI_SECRET_KEY are set (`wrangler secret put`).
// When on, each proxied POST becomes one LLM span sent to Future AGI as
// OTLP/HTTP JSON, after the response has gone back to the browser
// (ctx.waitUntil), so tracing never delays or breaks an LLM call.
//
// METADATA ONLY, by design: these calls carry drug-label text, literature and
// AE case narratives, so a span holds the model names, token counts, timing,
// HTTP status and which proxy route was used. Never prompt or response
// content, never headers, never the caller's identity. The request/response
// bodies are parsed here solely to read `model` and `usage`.

export interface TracingEnv {
  FI_API_KEY?: string;
  FI_SECRET_KEY?: string;
  // Collector root; the Future AGI cloud by default.
  FI_BASE_URL?: string;
  // Project the spans land in; created by Future AGI on first use.
  FI_PROJECT_NAME?: string;
}

export const DEFAULT_FI_BASE_URL = 'https://api.futureagi.com';
export const DEFAULT_FI_PROJECT_NAME = 'pv-signal-monitor';

export function tracingEnabled(env: TracingEnv): boolean {
  return Boolean(env.FI_API_KEY && env.FI_SECRET_KEY);
}

export interface LlmCallMeta {
  route: string; // '/llm' or '/ollama-cloud'
  upstreamHost: string; // e.g. 'ollama.com'
  upstreamPath: string; // e.g. '/chat/completions' (no query string)
  method: string;
  startMs: number;
  endMs: number;
  status?: number; // undefined when the upstream fetch itself threw
  requestModel?: string;
  responseModel?: string;
  usage?: TokenUsage;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

/** `model` from an OpenAI-compatible JSON body; nothing else is read. */
export function readModel(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.model === 'string' && parsed.model ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

/** `model` and `usage` from an OpenAI-compatible chat completion response. */
export function readResponseMeta(body: string): { model?: string; usage?: TokenUsage } {
  try {
    const parsed = JSON.parse(body);
    const u = parsed?.usage;
    const usage = u && typeof u === 'object'
      ? { input: count(u.prompt_tokens), output: count(u.completion_tokens), total: count(u.total_tokens) }
      : undefined;
    const model = typeof parsed?.model === 'string' && parsed.model ? parsed.model : undefined;
    return { model, usage: usage && Object.values(usage).some((v) => v !== undefined) ? usage : undefined };
  } catch {
    return {};
  }
}

const providerName = (host: string) => (/(^|\.)ollama\.com$/.test(host) ? 'ollama' : host);

const operationName = (path: string) => {
  if (path.endsWith('/chat/completions')) return 'chat';
  if (path.endsWith('/completions')) return 'text_completion';
  if (path.endsWith('/embeddings')) return 'embeddings';
  return path.split('/').filter(Boolean).pop() || 'request';
};

type AttrValue = string | number;
const attr = (key: string, value: AttrValue) => ({
  key,
  value: typeof value === 'number' ? { intValue: String(Math.trunc(value)) } : { stringValue: value },
});

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

const nanos = (ms: number) => `${Math.trunc(ms)}000000`;

/** The OTLP/HTTP JSON body for one LLM call. Pure apart from the random ids. */
export function buildOtlpPayload(meta: LlmCallMeta, projectName: string) {
  const operation = operationName(meta.upstreamPath);
  const model = meta.responseModel || meta.requestModel;
  const attributes: ReturnType<typeof attr>[] = [
    attr('gen_ai.span.kind', 'LLM'),
    attr('gen_ai.operation.name', operation),
    attr('gen_ai.provider.name', providerName(meta.upstreamHost)),
    attr('server.address', meta.upstreamHost),
    attr('url.path', meta.upstreamPath),
    attr('http.request.method', meta.method),
    attr('pv.proxy_route', meta.route),
  ];
  if (meta.requestModel) attributes.push(attr('gen_ai.request.model', meta.requestModel));
  if (meta.responseModel) attributes.push(attr('gen_ai.response.model', meta.responseModel));
  if (meta.usage?.input !== undefined) attributes.push(attr('gen_ai.usage.input_tokens', meta.usage.input));
  if (meta.usage?.output !== undefined) attributes.push(attr('gen_ai.usage.output_tokens', meta.usage.output));
  if (meta.usage?.total !== undefined) attributes.push(attr('gen_ai.usage.total_tokens', meta.usage.total));
  if (meta.status !== undefined) attributes.push(attr('http.response.status_code', meta.status));

  const failed = meta.status === undefined || meta.status >= 400;
  return {
    resourceSpans: [{
      resource: {
        attributes: [
          attr('project_name', projectName),
          attr('project_type', 'observe'),
          attr('service.name', 'pv-signal-monitor-worker'),
        ],
      },
      scopeSpans: [{
        scope: { name: 'pv-signal-monitor/worker/tracing' },
        spans: [{
          traceId: hex(16),
          spanId: hex(8),
          name: model ? `${operation} ${model}` : operation,
          kind: 3, // SPAN_KIND_CLIENT
          startTimeUnixNano: nanos(meta.startMs),
          endTimeUnixNano: nanos(Math.max(meta.endMs, meta.startMs)),
          attributes,
          status: failed
            ? { code: 2, message: meta.status === undefined ? 'upstream fetch failed' : `HTTP ${meta.status}` }
            : { code: 1 },
        }],
      }],
    }],
  };
}

/** POST one span to Future AGI. Never throws: tracing must not break the proxy. */
export async function exportLlmSpan(env: TracingEnv, meta: LlmCallMeta): Promise<void> {
  if (!tracingEnabled(env)) return;
  const base = (env.FI_BASE_URL || DEFAULT_FI_BASE_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/tracer/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': env.FI_API_KEY!,
        'X-Secret-Key': env.FI_SECRET_KEY!,
      },
      body: JSON.stringify(buildOtlpPayload(meta, env.FI_PROJECT_NAME || DEFAULT_FI_PROJECT_NAME)),
    });
    if (!res.ok) console.warn(`Future AGI trace export failed: HTTP ${res.status}`);
  } catch (err) {
    console.warn('Future AGI trace export failed:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Finish tracing a proxied call once its body has been read: pulls `model` and
 * `usage` out of a JSON response stream (a copy teed off the one the browser
 * gets) and exports the span. Non-JSON (e.g. streamed SSE) responses are
 * exported without usage.
 */
export async function traceResponse(
  env: TracingEnv,
  meta: Omit<LlmCallMeta, 'endMs' | 'responseModel' | 'usage'>,
  body: ReadableStream<Uint8Array> | null,
  isJson: boolean,
): Promise<void> {
  let responseMeta: { model?: string; usage?: TokenUsage } = {};
  try {
    if (body && isJson) responseMeta = readResponseMeta(await new Response(body).text());
    else if (body) await body.cancel();
  } catch {
    // client went away mid-stream, etc. — still export what we have
  }
  await exportLlmSpan(env, { ...meta, endMs: Date.now(), responseModel: responseMeta.model, usage: responseMeta.usage });
}
