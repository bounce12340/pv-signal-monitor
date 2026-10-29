// 主管機關安全性公告：Worker 端。
//
//   • 定時抓取（scheduledRefresh）：每小時輪到一個來源（sources.ts），存進 DB 的 reg_alerts。
//     一次只抓一個，讓每次執行的 CPU 與子請求都很小。
//   • /api/reg-alerts*（handleRegAlerts）：PV 限定，由 worker/index.ts 的 pvGate 擋在前面，
//     這裡拿到的 actor 已是驗證過的 JWT email。
//
// 成分比對不在這裡做：Worker 只存公告原文，前端依監測成分清單比對
// （services/regulatory/match.ts），規則改了不必重抓。
//
// 資料表要手動建立（schema.sql）。還沒建時，API 回 503 並指出要套用哪個檔案，
// 定時抓取只記 log，不丟例外。

import { RegItem } from './parsers';
import { FetchText, SOURCES, UNCOVERED, sourceById } from './sources';

// Minimal D1 typings (same approach as worker/index.ts: no workers-types dep).
interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface RegDb {
  prepare(query: string): Stmt;
  batch(statements: Stmt[]): Promise<unknown[]>;
}

export const REG_PATH = '/api/reg-alerts';
export const isRegPath = (pathname: string) => {
  const path = pathname.replace(/\/+$/, '');
  return path === REG_PATH || path.startsWith(`${REG_PATH}/`);
};

export const REVIEW_STATUSES = ['not_relevant', 'assessed', 'action'] as const;
type ReviewStatus = typeof REVIEW_STATUSES[number];

/** A manual refresh of the same source is refused within this window (don't hammer regulators). */
export const REFRESH_COOLDOWN_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 5_000_000;
const MAX_ITEMS_PER_SOURCE = 400;
// Older notices (EMA's file goes back to 2020) add D1 writes and CPU on every
// poll without helping anyone notice something new.
const MAX_AGE_DAYS = 400;
const USER_AGENT = 'pv-signal-monitor/1.0 (regulatory safety feed poller; +https://pv.uic-ai.com)';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const missingTables = (e: unknown) => /no such table/i.test(String((e as Error)?.message ?? e));
const SCHEMA_MISSING = () => json({
  error: 'reg_alerts tables missing: apply worker/regfeeds/schema.sql to the DB database (see docs/regulatory-alerts.md)',
}, 503);

/** Fetches one regulator URL as text, with a timeout and a size cap. */
export const fetchSourceText: FetchText = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/xml, text/xml, text/html;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  const declared = Number(res.headers.get('Content-Length') || '0');
  if (declared > MAX_BODY_BYTES) throw new Error(`response too large (${declared} bytes)`);
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) throw new Error(`response too large (${text.length} chars)`);
  return text;
};

const UPSERT = `INSERT INTO reg_alerts (id, source, title, url, published, summary, substances, first_seen, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, published = excluded.published,
    summary = excluded.summary, substances = excluded.substances, updated_at = excluded.updated_at
  WHERE reg_alerts.title IS NOT excluded.title OR reg_alerts.published IS NOT excluded.published
    OR reg_alerts.summary IS NOT excluded.summary OR reg_alerts.substances IS NOT excluded.substances`;

export interface RefreshResult { source: string; ok: boolean; count: number; error?: string }

/**
 * Fetches one source and stores its items. A failure is recorded against the
 * source (and the items already stored stay); it never throws, except when the
 * tables don't exist.
 */
export async function refreshSource(db: RegDb, sourceId: string, fetchText: FetchText = fetchSourceText, now = new Date()): Promise<RefreshResult> {
  const source = sourceById(sourceId);
  if (!source) return { source: sourceId, ok: false, count: 0, error: 'unknown source' };
  const at = now.toISOString();
  let items: RegItem[];
  try {
    const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    items = (await source.load(fetchText))
      .filter((i) => i.published === null || i.published >= cutoff)
      .slice(0, MAX_ITEMS_PER_SOURCE);
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 300);
    await db.prepare(`INSERT INTO reg_sources (source, last_attempt, last_error) VALUES (?1, ?2, ?3)
      ON CONFLICT(source) DO UPDATE SET last_attempt = excluded.last_attempt, last_error = excluded.last_error`)
      .bind(source.id, at, error).run();
    return { source: source.id, ok: false, count: 0, error };
  }
  const seen = new Set<string>();
  const statements: Stmt[] = [];
  for (const i of items) {
    const id = `${source.id}:${i.url}`;
    if (seen.has(id)) continue;
    seen.add(id);
    statements.push(db.prepare(UPSERT).bind(id, source.id, i.title, i.url, i.published, i.summary, i.substances, at));
  }
  statements.push(db.prepare(`INSERT INTO reg_sources (source, last_attempt, last_success, last_error, last_count)
    VALUES (?1, ?2, ?2, NULL, ?3)
    ON CONFLICT(source) DO UPDATE SET last_attempt = excluded.last_attempt, last_success = excluded.last_success,
      last_error = NULL, last_count = excluded.last_count`).bind(source.id, at, seen.size));
  await db.batch(statements);
  return { source: source.id, ok: true, count: seen.size };
}

/** The source due at `scheduledTime`: hourly ticks walk the list round-robin. */
export const sourceForTick = (scheduledTime: number) => SOURCES[Math.floor(scheduledTime / 3_600_000) % SOURCES.length];

export async function scheduledRefresh(db: RegDb | undefined, scheduledTime: number, fetchText: FetchText = fetchSourceText): Promise<RefreshResult | null> {
  if (!db) return null;
  const source = sourceForTick(scheduledTime);
  try {
    const result = await refreshSource(db, source.id, fetchText, new Date(scheduledTime));
    console.log(`regfeeds ${source.id}: ${result.ok ? `${result.count} items` : `failed: ${result.error}`}`);
    return result;
  } catch (e) {
    console.log(`regfeeds ${source.id}: ${missingTables(e) ? 'tables missing (apply worker/regfeeds/schema.sql)' : String(e)}`);
    return null;
  }
}

// ── API ────────────────────────────────────────────────────────────────────

interface WatchItem { ingredient: string; synonyms: string[] }

/** Whitelists and bounds a watchlist payload; anything else in the body is dropped. */
export function cleanWatchlist(raw: unknown): WatchItem[] | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) return null;
  const rawItems = (raw as { items: unknown[] }).items;
  if (rawItems.length > 200) return null;
  const out: WatchItem[] = [];
  const seen = new Set<string>();
  const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 100) : '');
  for (const r of rawItems) {
    if (!r || typeof r !== 'object') return null;
    const ingredient = str((r as { ingredient?: unknown }).ingredient);
    if (!ingredient) return null;
    const key = ingredient.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rawSyn = (r as { synonyms?: unknown }).synonyms;
    const synonyms = Array.isArray(rawSyn) ? [...new Set(rawSyn.map(str).filter(Boolean))].slice(0, 30) : [];
    out.push({ ingredient, synonyms });
  }
  return out;
}

async function audit(db: RegDb, actor: string, action: 'review' | 'watchlist' | 'refresh', target: string, detail: unknown, at = new Date().toISOString()) {
  await db.prepare('INSERT INTO reg_audit (at, actor, action, target, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(at, actor, action, target, JSON.stringify(detail)).run();
  return at;
}

async function list(db: RegDb, url: URL): Promise<Response> {
  const days = Math.min(730, Math.max(1, Number(url.searchParams.get('days')) || 90));
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const alerts = (await db.prepare(`SELECT id, source, title, url, published, summary, substances, first_seen
      FROM reg_alerts WHERE COALESCE(published, substr(first_seen, 1, 10)) >= ?1
      ORDER BY COALESCE(published, substr(first_seen, 1, 10)) DESC, first_seen DESC LIMIT 2000`)
    .bind(since).all<Record<string, unknown>>()).results;
  const reviews = (await db.prepare(`SELECT a.target, a.detail, a.actor, a.at FROM reg_audit a
      JOIN reg_alerts r ON r.id = a.target
      WHERE a.action = 'review' AND COALESCE(r.published, substr(r.first_seen, 1, 10)) >= ?1
        AND a.seq = (SELECT MAX(b.seq) FROM reg_audit b WHERE b.action = 'review' AND b.target = a.target)`)
    .bind(since).all<{ target: string; detail: string; actor: string; at: string }>()).results;
  const byAlert = new Map(reviews.map((r) => {
    const d = JSON.parse(r.detail || '{}') as { status?: string; note?: string };
    return [r.target, { status: d.status, note: d.note || '', actor: r.actor, at: r.at }];
  }));
  const status = new Map((await db.prepare('SELECT source, last_attempt, last_success, last_error, last_count FROM reg_sources')
    .bind().all<Record<string, unknown>>()).results.map((r) => [r.source as string, r]));
  const wl = await db.prepare(`SELECT detail, actor, at FROM reg_audit WHERE action = 'watchlist' ORDER BY seq DESC LIMIT 1`)
    .bind().first<{ detail: string; actor: string; at: string }>();
  return json({
    since,
    sources: SOURCES.map((s) => ({
      id: s.id, name: s.name, country: s.country, homepage: s.homepage, note: s.note,
      last_attempt: status.get(s.id)?.last_attempt ?? null,
      last_success: status.get(s.id)?.last_success ?? null,
      last_error: status.get(s.id)?.last_error ?? null,
      last_count: status.get(s.id)?.last_count ?? null,
    })),
    uncovered: UNCOVERED,
    alerts: alerts.map((a) => ({ ...a, review: byAlert.get(a.id as string) ?? null })),
    watchlist: wl
      ? { items: (JSON.parse(wl.detail) as { items: WatchItem[] }).items, updated_by: wl.actor, updated_at: wl.at }
      : { items: [], updated_by: null, updated_at: null },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return undefined; }
}

/** PV-only (the caller has passed pvGate); `actor` is the verified Access email. */
export async function handleRegAlerts(request: Request, db: RegDb | undefined, url: URL, actor: string, fetchText: FetchText = fetchSourceText): Promise<Response> {
  if (!db) return json({ error: 'DB binding missing' }, 503);
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (request.method === 'GET' && path === REG_PATH) return await list(db, url);

    if (request.method === 'POST' && path === `${REG_PATH}/review`) {
      const body = await readJson(request) as { alertId?: unknown; status?: unknown; note?: unknown } | undefined;
      const alertId = typeof body?.alertId === 'string' ? body.alertId : '';
      const status = body?.status as ReviewStatus;
      const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : '';
      if (!alertId || !REVIEW_STATUSES.includes(status)) return json({ error: 'alertId and a valid status are required' }, 400);
      if (status === 'action' && !note) return json({ error: '「需後續行動」須說明行動內容' }, 400);
      const exists = await db.prepare('SELECT id FROM reg_alerts WHERE id = ?1').bind(alertId).first();
      if (!exists) return json({ error: 'alert not found' }, 404);
      const at = await audit(db, actor, 'review', alertId, { status, note });
      return json({ review: { status, note, actor, at } });
    }

    if (request.method === 'PUT' && path === `${REG_PATH}/watchlist`) {
      const items = cleanWatchlist(await readJson(request));
      if (!items) return json({ error: 'body must be { items: [{ ingredient, synonyms[] }] } (≤ 200 items)' }, 400);
      const at = await audit(db, actor, 'watchlist', 'watchlist', { items });
      return json({ watchlist: { items, updated_by: actor, updated_at: at } });
    }

    if (request.method === 'POST' && path === `${REG_PATH}/refresh`) {
      const body = await readJson(request) as { source?: unknown } | undefined;
      const source = typeof body?.source === 'string' ? sourceById(body.source) : undefined;
      if (!source) return json({ error: 'unknown source' }, 400);
      const last = await db.prepare('SELECT last_attempt FROM reg_sources WHERE source = ?1').bind(source.id).first<{ last_attempt: string | null }>();
      if (last?.last_attempt && Date.now() - Date.parse(last.last_attempt) < REFRESH_COOLDOWN_MS) {
        return json({ error: `${source.name} 剛更新過，請 5 分鐘後再試` }, 429);
      }
      const result = await refreshSource(db, source.id, fetchText);
      await audit(db, actor, 'refresh', source.id, result);
      return json(result);
    }

    return json({ error: 'not found' }, 404);
  } catch (e) {
    if (missingTables(e)) return SCHEMA_MISSING();
    throw e;
  }
}
