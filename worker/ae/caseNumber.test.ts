// @vitest-environment node
// 個案編號由 Worker 配發（worker/ae/ae.js 的 caseNumberSql）。跑真的 schema 與 SQL。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAeRequest, taipeiYear } from './ae.js';

let sql: DatabaseSync;
let env: any;
const YEAR = taipeiYear();
const blank = (id: string, extra = {}) => ({ id, caseNumber: '', status: 'submitted', reportType: 'initial', followUpOfId: '', events: [], drugs: [], attachments: [], ...extra });
async function call(method: string, path: string, body: unknown, actor = 'rep@example.test') {
  const url = new URL(`https://example.test/api/ae-reports${path}`);
  const res = await handleAeRequest(new Request(url, { method, body: JSON.stringify(body) }), env, url, { email: actor }, {});
  return { status: res!.status, body: await res!.json() };
}
const column = (id: string) => sql.prepare('SELECT case_number, payload FROM ae_cases WHERE id=?').get(id) as any;

beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const prepare = (query: string) => ({ bind: (...args: any[]) => ({
    first: async () => sql.prepare(query).get(...args) || null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => ({ meta: sql.prepare(query).run(...args) }),
  }) });
  env = { AE_PV_EMAILS: 'pv@example.test', DB: { prepare, batch: async (statements: any[]) => {
    sql.exec('BEGIN');
    try { const out = []; for (const s of statements) out.push(await s.run()); sql.exec('COMMIT'); return out; }
    catch (e) { sql.exec('ROLLBACK'); throw e; }
  } } };
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { sql.close(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('server-assigned case numbers', () => {
  it('numbers each rep submission in sequence and returns it, ignoring the client value', async () => {
    const a = await call('POST', '', blank('a', { caseNumber: `PV-${YEAR}-0001` }));
    const b = await call('POST', '', blank('b', { caseNumber: `PV-${YEAR}-0001` }), 'other-rep@example.test');
    expect(a).toMatchObject({ status: 201, body: { caseNumber: `PV-${YEAR}-0001` } });
    expect(b).toMatchObject({ status: 201, body: { caseNumber: `PV-${YEAR}-0002` } });
  });

  it('keeps payload and column in agreement, and reads the number from the column', async () => {
    await call('POST', '', blank('a', { caseNumber: 'FORGED' }));
    const row = column('a');
    expect(JSON.parse(row.payload).caseNumber).toBe(row.case_number);
    const read = await call('GET', '/a', undefined);
    expect(read.body.case.caseNumber).toBe(row.case_number);
  });

  it('treats the column as the source of truth when a stored payload disagrees', async () => {
    sql.prepare(`INSERT INTO ae_cases (id,payload,case_number,status,submitted_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run('stale', JSON.stringify({ caseNumber: 'STALE' }), `PV-${YEAR}-0007`, 'submitted', 'rep@example.test', '2026-01-01', '2026-01-01');
    expect((await call('GET', '/stale', undefined)).body.case.caseNumber).toBe(`PV-${YEAR}-0007`);
    expect((await call('GET', '', undefined)).body.cases[0].caseNumber).toBe(`PV-${YEAR}-0007`);
  });

  it('continues after the highest existing number, so legacy duplicates are not collided with again', async () => {
    for (const id of ['legacy1', 'legacy2']) {
      sql.prepare(`INSERT INTO ae_cases (id,payload,case_number,status,submitted_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, '{}', `PV-${YEAR}-0001`, 'submitted', 'rep@example.test', '2026-01-01', '2026-01-01');
    }
    sql.prepare(`INSERT INTO ae_cases (id,payload,case_number,status,submitted_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run('odd', '{}', `PV-${YEAR}-not-a-number`, 'submitted', 'rep@example.test', '2026-01-01', '2026-01-01');
    expect((await call('POST', '', blank('new'))).body.caseNumber).toBe(`PV-${YEAR}-0002`);
  });

  it('keeps the number on a rep retry of the same case', async () => {
    const first = await call('POST', '', blank('a'));
    const retry = await call('POST', '', blank('a', { version: 0, caseNumber: 'PV-1999-9999' }));
    expect(retry).toMatchObject({ status: 200, body: { caseNumber: first.body.caseNumber } });
    expect(column('a').case_number).toBe(first.body.caseNumber);
  });

  it('does not let PV edits change an assigned number', async () => {
    const first = await call('POST', '', blank('a'));
    const edit = await call('PATCH', '/a', { ...blank('a'), version: 0, caseNumber: 'RENUMBERED' }, 'pv@example.test');
    expect(edit).toMatchObject({ status: 200, body: { caseNumber: first.body.caseNumber } });
    expect(column('a').case_number).toBe(first.body.caseNumber);
    expect(JSON.parse(column('a').payload).caseNumber).toBe(first.body.caseNumber);
  });

  it('numbers PV follow-ups as <parent>-F<n>', async () => {
    const parent = (await call('POST', '', blank('p'))).body.caseNumber;
    const f1 = await call('POST', '', blank('f1', { reportType: 'follow_up', followUpOfId: 'p' }), 'pv@example.test');
    const f2 = await call('POST', '', blank('f2', { reportType: 'follow_up', followUpOfId: 'p' }), 'pv@example.test');
    expect(f1.body.caseNumber).toBe(`${parent}-F1`);
    expect(f2.body.caseNumber).toBe(`${parent}-F2`);
    // Follow-ups do not consume a number in the yearly sequence.
    expect((await call('POST', '', blank('next'))).body.caseNumber).toBe(`PV-${YEAR}-0002`);
  });

  it('does not let a rep attach to someone else’s case or learn its number', async () => {
    await call('POST', '', blank('p'), 'owner@example.test');
    const rep = await call('POST', '', blank('r', { reportType: 'follow_up', followUpOfId: 'p' }), 'rep@example.test');
    expect(rep.body.caseNumber).toBe(`PV-${YEAR}-0002`);
  });

  it('falls back to the yearly sequence when the follow-up parent does not exist', async () => {
    const f = await call('POST', '', blank('f', { reportType: 'follow_up', followUpOfId: 'missing' }), 'pv@example.test');
    expect(f.body.caseNumber).toBe(`PV-${YEAR}-0001`);
  });
});

describe('taipeiYear', () => {
  it('rolls over at Taipei midnight, not UTC midnight', () => {
    expect(taipeiYear(new Date('2026-12-31T15:59:59Z'))).toBe('2026');
    expect(taipeiYear(new Date('2026-12-31T16:00:00Z'))).toBe('2027');
  });
});
