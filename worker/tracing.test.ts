import { describe, expect, it } from 'vitest';
import { buildOtlpPayload, readModel, readResponseMeta, tracingEnabled } from './tracing';

const meta = {
  route: '/llm', upstreamHost: 'ollama.com', upstreamPath: '/v1/chat/completions', method: 'POST',
  startMs: 1_700_000_000_000, endMs: 1_700_000_001_500, status: 200,
  requestModel: 'deepseek-v4-pro', responseModel: 'deepseek-v4-pro',
  usage: { input: 10, output: 5, total: 15 },
};

describe('worker/tracing', () => {
  it('needs both keys', () => {
    expect(tracingEnabled({})).toBe(false);
    expect(tracingEnabled({ FI_API_KEY: 'k' })).toBe(false);
    expect(tracingEnabled({ FI_API_KEY: 'k', FI_SECRET_KEY: 's' })).toBe(true);
  });

  it('reads only model and usage from bodies', () => {
    expect(readModel('{"model":"m","messages":[{"content":"x"}]}')).toBe('m');
    expect(readModel('{"model":""}')).toBeUndefined();
    expect(readModel('not json')).toBeUndefined();
    expect(readResponseMeta('{"model":"m","usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}'))
      .toEqual({ model: 'm', usage: { input: 3, output: 2, total: 5 } });
    expect(readResponseMeta('{"choices":[]}')).toEqual({ model: undefined, usage: undefined });
    expect(readResponseMeta('data: {"x":1}')).toEqual({});
  });

  it('builds an OTLP JSON span with nanosecond times and hex ids', () => {
    const span = buildOtlpPayload(meta, 'proj').resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe('chat deepseek-v4-pro');
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.startTimeUnixNano).toBe('1700000000000000000');
    expect(span.endTimeUnixNano).toBe('1700000001500000000');
    expect(span.kind).toBe(3);
    expect(span.status).toEqual({ code: 1 });
  });

  it('has no content-bearing attributes', () => {
    const keys = buildOtlpPayload(meta, 'proj').resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a) => a.key);
    expect(keys.filter((k) => /input\.value|output\.value|message|prompt\b|content|email|user/i.test(k))).toEqual([]);
  });

  it('marks a failed fetch (no status) as an error', () => {
    const span = buildOtlpPayload({ ...meta, status: undefined, usage: undefined }, 'proj').resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status).toEqual({ code: 2, message: 'upstream fetch failed' });
    expect(span.attributes.some((a) => a.key.startsWith('gen_ai.usage'))).toBe(false);
  });

  it('names a non-Ollama upstream by its host', () => {
    const attrs = buildOtlpPayload({ ...meta, upstreamHost: 'openrouter.ai' }, 'p').resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(attrs.find((a) => a.key === 'gen_ai.provider.name')?.value).toEqual({ stringValue: 'openrouter.ai' });
  });
});
