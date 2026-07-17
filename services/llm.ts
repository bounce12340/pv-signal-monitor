// Unified LLM client for the whole app. Every inference — the label AE-master
// extraction (services/ai.ts) and the literature-monitoring service
// (services/literature/llmService.ts) — routes through here, so there is a
// single place that knows how to talk to a model, one JSON-repair parser, and
// one batched-concurrency implementation.
//
// Three sources, resolved from the user's saved AI settings:
//   1) Platform default — same-origin `/llm/*` proxy. No API key, no VITE_
//      endpoint variables; the Cloudflare Access cookie rides along with the
//      same-origin request. Used whenever the user hasn't configured a BYO
//      provider. The Worker that backs `/llm` is built in a later stage; the
//      frontend already speaks to it and tests mock the transport.
//   2) BYO OpenAI-compatible — user supplies base URL (+ optional key).
//   3) BYO Gemini — user supplies a Google AI key (uses @google/genai).

import { GoogleGenAI } from '@google/genai';
import { settings, type AiSettings } from './settings';

// Same-origin proxy base for the platform default. OpenAI-compatible shape:
// requests go to `/llm/chat/completions`.
const PLATFORM_BASE = '/llm';

// Default Gemini model when a BYO-Gemini user leaves the model field blank.
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

// --- Batching knobs (shared) ---
// Evaluation/summary records per prompt: caps token size and keeps every pmid.
const BATCH_SIZE = 8;
// Concurrent in-flight batches: parallelism without hammering the upstream.
const BATCH_CONCURRENCY = 3;

/** Progress callback: done / total = processed / all. */
export type ProgressFn = (done: number, total: number) => void;

/** AI output language. */
export type Lang = 'zh' | 'en';

/** Output-language directive injected into prompts. */
export const langDirective = (lang: Lang) =>
  lang === 'en'
    ? 'Respond in English. summary and conclusion fields must be in English.'
    : '請以繁體中文回答。summary 與 conclusion 欄位必須是繁體中文。';

/** Which transport + credentials to use, derived from AiSettings. */
export interface ResolvedLlm {
  mode: 'gemini' | 'openai';
  model: string;
  baseUrl: string; // openai mode only ('/llm' for the platform default)
  apiKey: string; // '' for the platform default
  platform: boolean; // same-origin proxy → send credentials, no Authorization
}

/**
 * Pick the LLM source from saved settings.
 * - Gemini selected *and* a key present → BYO Gemini.
 * - OpenAI-compatible selected *and* a base URL present → BYO OpenAI-compatible.
 * - Anything else (fresh install, key/URL blank) → platform default `/llm`.
 */
export function resolveLlm(ai: AiSettings): ResolvedLlm {
  if (ai.provider === 'gemini' && ai.apiKey) {
    return {
      mode: 'gemini',
      model: ai.model || DEFAULT_GEMINI_MODEL,
      baseUrl: '',
      apiKey: ai.apiKey,
      platform: false,
    };
  }
  if (ai.provider === 'openai-compatible' && ai.baseUrl) {
    return {
      mode: 'openai',
      model: ai.model,
      baseUrl: ai.baseUrl.replace(/\/+$/, ''),
      apiKey: ai.apiKey,
      platform: false,
    };
  }
  // Platform default: same-origin proxy, no key, Access cookie carries identity.
  return { mode: 'openai', model: ai.model || '', baseUrl: PLATFORM_BASE, apiKey: '', platform: true };
}

// --- OpenAI-compatible transport ---

export type ChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

export interface ChatOptions {
  jsonMode?: boolean; // send response_format: json_object
  temperature?: number;
  maxTokens?: number;
}

/**
 * POST an OpenAI Chat Completions request and return the assistant text.
 * Platform mode sends the request same-origin with credentials and no
 * Authorization header; BYO mode adds the bearer key when present.
 */
export async function openaiChat(
  cfg: ResolvedLlm,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    ...(cfg.platform ? { credentials: 'same-origin' as RequestCredentials } : {}),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM 端點回應 ${res.status}：${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

// --- Gemini transport ---

export interface GeminiRequest {
  systemInstruction?: string;
  parts: Array<Record<string, unknown>>;
  schema?: unknown; // responseSchema (guarantees parseable JSON)
  responseJson?: boolean; // force application/json without a schema
  temperature?: number;
  maxTokens?: number;
}

/** Call Gemini via @google/genai and return the response text. */
export async function geminiGenerate(cfg: ResolvedLlm, req: GeminiRequest): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  const response = await ai.models.generateContent({
    model: cfg.model,
    contents: { role: 'user', parts: req.parts },
    config: {
      ...(req.systemInstruction ? { systemInstruction: req.systemInstruction } : {}),
      ...(req.schema || req.responseJson ? { responseMimeType: 'application/json' } : {}),
      ...(req.schema ? { responseSchema: req.schema } : {}),
      temperature: req.temperature ?? 0.1,
      ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
    },
  });
  return (response.text || '').trim();
}

// --- High-level text→JSON entry (used by the literature service) ---

export interface CallModelOptions {
  jsonMode?: boolean; // default true
  temperature?: number;
}

/**
 * Resolve the configured source, send a single-prompt request and return the
 * parsed JSON (via parseJsonLoose). This is the literature layer's workhorse.
 */
export async function callModel(prompt: string, opts: CallModelOptions = {}): Promise<any> {
  const cfg = resolveLlm(settings.getAi());
  const jsonMode = opts.jsonMode ?? true;
  const temperature = opts.temperature ?? 0.2;
  let raw: string;
  if (cfg.mode === 'gemini') {
    raw = await geminiGenerate(cfg, { parts: [{ text: prompt }], responseJson: jsonMode, temperature });
  } else {
    raw = await openaiChat(cfg, [{ role: 'user', content: prompt }], { jsonMode, temperature });
  }
  return parseJsonLoose(raw);
}

// --- Shared concurrency helpers ---

/** Run `fn` over items with at most `limit` in flight; result order matches input. */
export async function mapLimit<A, B>(
  items: A[],
  limit: number,
  fn: (item: A, index: number) => Promise<B>
): Promise<B[]> {
  const results: B[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return results;
}

/**
 * Split items into fixed-size batches processed in parallel (up to
 * BATCH_CONCURRENCY at once) and flatten the results. A failing batch yields an
 * empty array so the caller's reconcile step can backfill it; onProgress
 * reports the cumulative processed count after each batch.
 */
export async function runBatched<T>(
  items: any[],
  fn: (batch: any[]) => Promise<T[]>,
  onProgress?: ProgressFn
): Promise<T[]> {
  const batches: any[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));
  let done = 0;
  const perBatch = await mapLimit(batches, BATCH_CONCURRENCY, async (batch) => {
    try {
      return await fn(batch);
    } catch {
      return [] as T[]; // reconcile backfills the missing pmids
    } finally {
      done += batch.length;
      onProgress?.(Math.min(done, items.length), items.length);
    }
  });
  return perBatch.flat();
}

/** Ensure output covers every input record (matched by pmid); backfill misses. */
export function reconcile(records: any[], results: any[], fallback: (r: any) => any): any[] {
  const byPmid = new Map(results.filter((x) => x && x.pmid != null).map((x) => [String(x.pmid), x]));
  return records.map((r) => byPmid.get(String(r.pmid)) || fallback(r));
}

/** Loosely parse an LLM reply: strip a ```json fence and surrounding noise. */
export function parseJsonLoose(raw: string): any {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    // Fallback: grab from the first { or [ to its matching close.
    const start = s.search(/[{[]/);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    return null;
  }
}
