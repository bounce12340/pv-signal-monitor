// @vitest-environment node
// Runs the real schema.sql and SQL against node:sqlite (D1 is SQLite).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { REFRESH_COOLDOWN_MS, RegDb, cleanWatchlist, handleRegAlerts, refreshSource, scheduledRefresh, sourceForTick } from './handler';
import { SOURCES } from './sources';

let sql: DatabaseSync;
let db: RegDb;

function d1(conn: DatabaseSync): RegDb {
  const prepare = (query: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => { args = a; return stmt; },
      first: async () => (conn.prepare(query).get(...(args as any[])) as any) ?? null,
      all: async () => ({ results: conn.prepare(query).all(...(args as any[])) as any[] }),
      run: async () => conn.prepare(query).run(...(args as any[])),
    };
    return stmt;
  };
  return {
    prepare: prepare as any,
    batch: async (statements: any[]) => {
      conn.exec('BEGIN');
      try { const out = []; for (const s of statements) out.push(await s.run()); conn.exec('COMMIT'); return out; }
      catch (e) { conn.exec('ROLLBACK'); throw e; }
    },
  };
}

// Fictional GOV.UK payload; the MHRA source is the simplest one to drive.
// Dated today so the age cutoff never ages these tests out.
const govUk = (titles: string[]) => JSON.stringify({ results: titles.map((t, i) => ({
  title: t, link: `/drug-safety-update/item-${i}`, public_timestamp: new Date().toISOString(), description: `About ${t}`,
})) });
const fetchOk = (titles: string[]) => vi.fn(async () => govUk(titles));

const req = (method: string, path: string, body?: unknown) => {
  const url = new URL(`https://pv.example.test${path}`);
  return [new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), url] as const;
};
const call = async (method: string, path: string, body?: unknown, fetchText = fetchOk(['A'])) => {
  const [r, url] = req(method, path, body);
  return handleRegAlerts(r, db, url, 'pv@example.test', fetchText);
};

beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  db = d1(sql);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { sql.close(); vi.restoreAllMocks(); });

describe('refreshSource', () => {
  it('stores items once, keeps first_seen on a later fetch, and records success', async () => {
    const r1 = await refreshSource(db, 'mhra', fetchOk(['Examplumab: risk', 'Testostatin: update']), new Date('2026-10-21T00:00:00Z'));
    expect(r1).toEqual({ source: 'mhra', ok: true, count: 2 });
    await refreshSource(db, 'mhra', fetchOk(['Examplumab: risk (revised)', 'Testostatin: update']), new Date('2026-10-22T00:00:00Z'));
    const rows = sql.prepare('SELECT title, first_seen, updated_at FROM reg_alerts ORDER BY id').all() as any[];
    expect(rows).toEqual([
      { title: 'Examplumab: risk (revised)', first_seen: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-22T00:00:00.000Z' },
      // Unchanged rows aren't rewritten (fewer D1 writes, honest updated_at).
      { title: 'Testostatin: update', first_seen: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z' },
    ]);
    expect(sql.prepare('SELECT last_success, last_error, last_count FROM reg_sources').get()).toEqual({
      last_success: '2026-10-22T00:00:00.000Z', last_error: null, last_count: 2,
    });
  });

  it('skips notices older than about 13 months', async () => {
    const payload = JSON.stringify({ results: [
      { title: 'Recent', link: '/drug-safety-update/recent', public_timestamp: '2026-10-01T00:00:00Z' },
      { title: 'Old', link: '/drug-safety-update/old', public_timestamp: '2024-01-01T00:00:00Z' },
    ] });
    const r = await refreshSource(db, 'mhra', vi.fn(async () => payload), new Date('2026-10-21T00:00:00Z'));
    expect(r.count).toBe(1);
    expect(sql.prepare('SELECT title FROM reg_alerts').all()).toEqual([{ title: 'Recent' }]);
  });

  it('records a failure without touching what is stored', async () => {
    await refreshSource(db, 'mhra', fetchOk(['Kept']), new Date('2026-10-21T00:00:00Z'));
    const failing = vi.fn(async () => { throw new Error('HTTP 503 from www.gov.uk'); });
    const r = await refreshSource(db, 'mhra', failing, new Date('2026-10-22T00:00:00Z'));
    expect(r.ok).toBe(false);
    expect(sql.prepare('SELECT count(*) AS n FROM reg_alerts').get()).toEqual({ n: 1 });
    expect(sql.prepare('SELECT last_attempt, last_success, last_error FROM reg_sources').get()).toEqual({
      last_attempt: '2026-10-22T00:00:00.000Z', last_success: '2026-10-21T00:00:00.000Z', last_error: 'HTTP 503 from www.gov.uk',
    });
  });

  it('treats a page that no longer parses as a failure, not as zero alerts', async () => {
    const r = await refreshSource(db, 'fda-dsc', vi.fn(async () => '<html>Access denied</html>'));
    expect(r.ok).toBe(false);
    expect(sql.prepare('SELECT last_success FROM reg_sources').get()).toEqual({ last_success: null });
  });

  it('only ever fetches the URLs the source list fixes', async () => {
    const seen: string[] = [];
    for (const s of SOURCES) await refreshSource(db, s.id, async (u) => { seen.push(u); throw new Error('offline'); });
    expect(seen.every((u) => u.startsWith('https://'))).toBe(true);
    expect(new Set(seen.map((u) => new URL(u).hostname))).toEqual(new Set([
      'www.gov.uk', 'www.fda.gov', 'www.ema.europa.eu', 'www.pmda.go.jp', 'www.bfarm.de', 'ansm.sante.fr', 'www.fda.gov.tw',
    ]));
  });
});

describe('scheduled polling', () => {
  it('walks every source once per cycle of hourly ticks', () => {
    const hour = 3_600_000;
    const ids = SOURCES.map((_, i) => sourceForTick(Date.UTC(2026, 9, 1) + i * hour + 23 * 60_000).id);
    expect(new Set(ids).size).toBe(SOURCES.length);
  });

  it('logs and carries on when the tables have not been created yet', async () => {
    const bare = d1(new DatabaseSync(':memory:'));
    await expect(scheduledRefresh(bare, Date.UTC(2026, 9, 1), fetchOk(['A']))).resolves.toBeNull();
    expect(String((console.log as any).mock.calls.at(-1)[0])).toMatch(/schema\.sql/);
  });
});

describe('/api/reg-alerts', () => {
  it('answers 503 with the file to apply when the tables are missing', async () => {
    db = d1(new DatabaseSync(':memory:'));
    const res = await call('GET', '/api/reg-alerts');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/worker\/regfeeds\/schema\.sql/);
  });

  it('lists alerts with source status, coverage gaps and the latest review', async () => {
    await refreshSource(db, 'mhra', fetchOk(['Examplumab: risk']));
    const id = (sql.prepare('SELECT id FROM reg_alerts').get() as any).id;
    await call('POST', '/api/reg-alerts/review', { alertId: id, status: 'assessed', note: 'first look' });
    await call('POST', '/api/reg-alerts/review', { alertId: id, status: 'not_relevant', note: '' });
    const body = await (await call('GET', '/api/reg-alerts?days=30')).json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].review).toMatchObject({ status: 'not_relevant', actor: 'pv@example.test' });
    expect(body.sources.find((s: any) => s.id === 'mhra')).toMatchObject({ last_count: 1, last_error: null });
    expect(body.sources.find((s: any) => s.id === 'tfda')).toMatchObject({ last_success: null });
    expect(body.uncovered.map((u: any) => u.country)).toEqual(['CH', 'CA', 'AU', 'BE', 'SE']);
    expect(body.watchlist).toEqual({ items: [], updated_by: null, updated_at: null });
  });

  it('keeps every review in an append-only trail', async () => {
    await refreshSource(db, 'mhra', fetchOk(['Examplumab: risk']));
    const id = (sql.prepare('SELECT id FROM reg_alerts').get() as any).id;
    expect((await call('POST', '/api/reg-alerts/review', { alertId: id, status: 'assessed' })).status).toBe(200);
    expect(() => sql.exec("UPDATE reg_audit SET actor = 'someone-else'")).toThrow(/append-only/);
    expect(() => sql.exec('DELETE FROM reg_audit')).toThrow(/append-only/);
  });

  it.each([
    [{ alertId: 'mhra:x', status: 'approved' }, 400],
    [{ status: 'assessed' }, 400],
    [{ alertId: 'nope', status: 'assessed' }, 404],
  ])('validates a review %j', async (body, status) => {
    await refreshSource(db, 'mhra', fetchOk(['A']));
    expect((await call('POST', '/api/reg-alerts/review', body)).status).toBe(status);
  });

  it('requires a note for 需後續行動', async () => {
    await refreshSource(db, 'mhra', fetchOk(['A']));
    const id = (sql.prepare('SELECT id FROM reg_alerts').get() as any).id;
    expect((await call('POST', '/api/reg-alerts/review', { alertId: id, status: 'action', note: '  ' })).status).toBe(400);
    expect((await call('POST', '/api/reg-alerts/review', { alertId: id, status: 'action', note: '評估是否通報' })).status).toBe(200);
  });

  it('never lets the request body choose the actor', async () => {
    await refreshSource(db, 'mhra', fetchOk(['A']));
    const id = (sql.prepare('SELECT id FROM reg_alerts').get() as any).id;
    await call('POST', '/api/reg-alerts/review', { alertId: id, status: 'assessed', actor: 'forged@example.test' });
    await call('PUT', '/api/reg-alerts/watchlist', { items: [], actor: 'forged@example.test', updated_by: 'forged@example.test' });
    expect(sql.prepare('SELECT DISTINCT actor FROM reg_audit').all()).toEqual([{ actor: 'pv@example.test' }]);
  });

  it('saves a whitelisted watchlist and serves the latest one', async () => {
    const res = await call('PUT', '/api/reg-alerts/watchlist', { items: [
      { ingredient: ' Theophylline ', synonyms: ['aminophylline', 'テオフィリン', '', 'aminophylline'], role: 'pv' },
      { ingredient: 'theophylline', synonyms: ['dup'] },
    ] });
    expect(res.status).toBe(200);
    const body = await (await call('GET', '/api/reg-alerts')).json();
    expect(body.watchlist).toMatchObject({
      items: [{ ingredient: 'Theophylline', synonyms: ['aminophylline', 'テオフィリン'] }],
      updated_by: 'pv@example.test',
    });
  });

  it.each([undefined, {}, { items: 'x' }, { items: [{ synonyms: [] }] }, { items: Array(201).fill({ ingredient: 'x' }) }])(
    'rejects a malformed watchlist %#', (raw) => expect(cleanWatchlist(raw)).toBeNull(),
  );

  it('refreshes a named source on demand, logs who asked, and rate-limits repeats', async () => {
    const fetchText = fetchOk(['A', 'B']);
    const res = await call('POST', '/api/reg-alerts/refresh', { source: 'mhra' }, fetchText);
    expect(await res.json()).toEqual({ source: 'mhra', ok: true, count: 2 });
    expect(sql.prepare("SELECT actor, target FROM reg_audit WHERE action = 'refresh'").get()).toEqual({ actor: 'pv@example.test', target: 'mhra' });
    expect((await call('POST', '/api/reg-alerts/refresh', { source: 'mhra' }, fetchText)).status).toBe(429);
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(REFRESH_COOLDOWN_MS).toBeGreaterThan(0);
  });

  it('refuses a source that is not on the fixed list (no caller-chosen URLs)', async () => {
    const fetchText = fetchOk(['A']);
    expect((await call('POST', '/api/reg-alerts/refresh', { source: 'https://evil.test/' }, fetchText)).status).toBe(400);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('is 404 for anything else', async () => {
    expect((await call('DELETE', '/api/reg-alerts')).status).toBe(404);
  });
});
