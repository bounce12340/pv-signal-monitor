// Synthetic SQLite regression; invoked directly and by the Vitest wrapper.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleAeRequest } from './ae.js';
import { handleWork } from './work.js';
import { emptyWork, validateWork } from '../../services/ae/caseWorkModel.js';

const root = resolve(new URL('../..', import.meta.url).pathname);
const schema = readFileSync(join(root, 'worker/ae/schema.sql'), 'utf8');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const base = (id, extra = {}) => ({ id, caseNumber: id, status: 'submitted', reportType: 'initial', followUpOf: '', followUpOfId: '', hasSignificantNewInfo: false, primaryReporterConsentFollowUp: false, events: [{ id: 'e1', verbatim: 'rash', onsetDate: '', endDate: '', outcome: '', seriousnessCriteria: [] }], drugs: [], attachments: [], ...extra });
function api() {
  const sql = new DatabaseSync(':memory:'); sql.exec(schema);
  const prepare = query => ({ bind: (...args) => ({ first: async () => sql.prepare(query).get(...args) || null, all: async () => ({ results: sql.prepare(query).all(...args) }), run: async () => ({ meta: sql.prepare(query).run(...args) }) }) });
  const files = new Map();
  const env = { AE_PV_EMAILS: 'pv@example.test', DB: { prepare, batch: async statements => { sql.exec('BEGIN'); try { const out=[]; for (const s of statements) out.push(await s.run()); sql.exec('COMMIT'); return out; } catch (e) { sql.exec('ROLLBACK'); throw e; } } }, AE_FILES: { put: async (key, bytes) => files.set(key, bytes), get: async key => files.has(key) ? { body: files.get(key) } : null } };
  const call = async (method, path='', body, actor='rep@example.test') => {
    const url = new URL(`https://example.test/api/ae-reports${path}`);
    return handleAeRequest(new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, url, { email: actor }, {});
  };
  return { sql, call };
}
{
  const { sql, call } = api();
  const original = base('retry', { primaryReporterConsentFollowUp: true, triage: { notes: 'forged' }, events: [{ id: 'e1', verbatim: 'rash', onsetDate: '', endDate: '', outcome: '', seriousnessCriteria: [], meddraPt: 'forged' }] });
  let response = await call('POST', '', original); eq(response.status, 201, 'rep creates a report'); eq((await response.json()).version, 0, 'create returns server version');
  let saved = JSON.parse(sql.prepare('SELECT payload FROM ae_cases WHERE id=?').get('retry').payload);
  eq(saved.events[0].meddraPt, undefined, 'rep cannot inject MedDRA'); eq(saved.triage.notes, undefined, 'rep cannot inject PV triage'); eq(saved.primaryReporterConsentFollowUp, true, 'legal consent true is retained');
  response = await call('PATCH', '/retry', { ...base('retry', { version: 0, primaryReporterConsentFollowUp: false, triage: { notes: 'PV note' }, events: [{ id: 'e1', verbatim: 'rash', onsetDate: '', endDate: '', outcome: '', seriousnessCriteria: [], meddraPt: 'Rash', meddraSoc: 'Skin', meddraVerified: true }] }) }, 'pv@example.test'); eq(response.status, 200, 'PV codes event');
  eq((await call('POST', '', original)).status, 409, 'stale rep retry is rejected');
  eq((await call('POST', '', { ...original, version: '1' })).status, 409, 'non-integer retry token is rejected');
  eq((await call('POST', '', { ...original, version: 1, events: [] })).status, 409, 'rep cannot remove coded event');
  eq((await call('POST', '', { ...original, version: 1, events: [{ ...original.events[0], id: 'renamed' }] })).status, 409, 'rep cannot rename coded event');
  response = await call('POST', '', { ...original, version: 1, triage: { notes: 'forged again' }, events: [{ id: 'e1', verbatim: 'rash', onsetDate: '', endDate: '', outcome: '', seriousnessCriteria: [] }] }); eq(response.status, 200, 'current rep retry succeeds');
  saved = JSON.parse(sql.prepare('SELECT payload FROM ae_cases WHERE id=?').get('retry').payload);
  eq(saved.events[0].meddraPt, 'Rash', 'current retry retains matching coding'); eq(saved.triage.notes, 'PV note', 'current retry retains PV triage'); eq(saved.primaryReporterConsentFollowUp, true, 'retry preserves supplied legal boolean');
  eq((await call('POST', '', base('dupe', { events: [{ ...base('x').events[0] }, { ...base('x').events[0] }] }))).status, 400, 'duplicate event ids are rejected');
  sql.close();
}
{
  const RealDate = globalThis.Date; const instant = '2026-09-29T00:00:00.000Z';
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new RealDate(instant).getTime(); } };
  try {
    const { sql, call } = api();
    eq((await call('POST', '', base('race'), 'pv@example.test')).status, 201, 'PV create');
    eq((await call('PATCH', '/race', { ...base('race'), version: 0, auditTrail: [{ action: 'legit' }] }, 'pv@example.test')).status, 200, 'first CAS update');
    const attachment = { id: 'race-att', name: 'r.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQKaGVsbG8=' };
    eq((await call('PATCH', '/race', { ...base('race'), version: 0, attachments: [attachment], auditTrail: [{ action: 'forged-stale' }] }, 'pv@example.test')).status, 409, 'same-millisecond stale CAS rejects');
    eq(sql.prepare("SELECT count(*) n FROM ae_attachments WHERE id='race-att'").get().n, 0, 'stale request leaves no attachment metadata');
    ok(!sql.prepare("SELECT 1 FROM ae_audit WHERE action='forged-stale'").get(), 'stale request leaves no audit');
    sql.close();
  } finally { globalThis.Date = RealDate; }
}
{
  const { sql, call } = api();
  eq((await call('POST', '', base('rollback'), 'pv@example.test')).status, 201, 'rollback case create');
  sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON ae_audit WHEN NEW.action='must-rollback' BEGIN SELECT RAISE(ABORT, 'injected'); END");
  const attachment = { id: 'rollback-att', name: 'r.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQKaGVsbG8=' };
  const log = console.log; console.log = () => {};
  let failureResponse;
  try { failureResponse = await call('PATCH', '/rollback', { ...base('rollback'), version: 0, attachments: [attachment], auditTrail: [{ action: 'must-rollback' }] }, 'pv@example.test'); } finally { console.log = log; }
  eq(failureResponse.status, 500, 'audit DB failure is surfaced');
  eq(sql.prepare('SELECT version FROM ae_cases WHERE id=?').get('rollback').version, 0, 'DB failure rolls back case update');
  eq(sql.prepare("SELECT count(*) n FROM ae_audit WHERE action='must-rollback'").get().n, 0, 'DB failure leaves no audit');
  eq(sql.prepare("SELECT count(*) n FROM ae_attachments WHERE id='rollback-att'").get().n, 0, 'DB failure leaves no attachment metadata');
  sql.close();
}

// Work endpoint authorization and input rejection are direct Node/SQLite
// regressions too, rather than assertions that only exist behind Vitest.
{
  const noDb = { DB: { prepare() { throw new Error('DB must not be queried'); } } };
  for (const [method, path, seg] of [
    ['GET', '/demo/work', ['demo', 'work']], ['PUT', '/demo/work', ['demo', 'work']],
    ['GET', '/work-users', ['work-users']], ['PUT', '/work-users', ['work-users']],
  ]) eq((await handleWork(new Request(`https://example.test/api/ae-reports${path}`, { method, body: method === 'PUT' ? JSON.stringify(emptyWork()) : undefined }), noDb, seg, 'rep', 'rep@example.test', {})).status, 403, `rep ${method} ${path} rejects before DB`);
  // A legitimate authorized read is intentionally not expected to reject.
  const readable = { DB: { prepare(query) { const statement = { bind() { return statement; }, async first() { return query.includes('ae_cases') ? { id: 'demo' } : null; }, async all() { return { results: [] }; } }; return statement; } } };
  eq((await handleWork(new Request('https://example.test/api/ae-reports/demo/work'), readable, ['demo', 'work'], 'pv', 'pv@example.test', {})).status, 200, 'PV work GET remains an authorized DB read');

  const writes = [];
  const workEnv = { AE_PV_EMAILS: 'pv@example.test', DB: { prepare(query) { let args = []; const statement = { bind(...values) { args = values; return statement; }, async first() { return query.includes('ae_cases') ? { id: 'demo' } : null; }, async all() { return { results: query.includes('ae_users') ? [{ email: 'pv@example.test' }] : [] }; }, async run() { writes.push({ query, args }); return { meta: { changes: 1 } }; } }; return statement; } } };
  const putWork = body => handleWork(new Request('https://example.test/api/ae-reports/demo/work', { method: 'PUT', body: JSON.stringify(body) }), workEnv, ['demo', 'work'], 'pv', 'pv@example.test', {});
  eq((await putWork({ ...emptyWork(), assignee: 'not-a-pv@example.test' })).status, 400, 'invalid assignee rejected');
  eq((await putWork({ ...emptyWork(), completedAt: 'forged' })).status, 400, 'forged lifecycle at rejected');
  eq((await putWork({ ...emptyWork(), completedBy: 'forged@example.test' })).status, 400, 'forged lifecycle actor rejected');
  eq(writes.length, 0, 'invalid assignee and forged lifecycle make zero persistence writes');

  const aeWrites = [];
  const aeEnv = { AE_PV_EMAILS: '', DB: { prepare(query) { let args = []; const statement = { bind(...values) { args = values; return statement; }, async first() { aeWrites.push({ query, args, kind: 'read' }); return { role: 'rep' }; }, async all() { return { results: [] }; }, async run() { aeWrites.push({ query, args, kind: 'write' }); return { meta: { changes: 1 } }; } }; return statement; } } };
  for (const field of ['workManagement', 'assignee', 'contacts', 'workDueDate']) {
    const value = field === 'contacts' ? [] : field === 'workManagement' ? {} : 'synthetic';
    const req = new Request('https://example.test/api/ae-reports', { method: 'POST', body: JSON.stringify({ id: `internal-${field}`, [field]: value }) });
    eq((await handleAeRequest(req, aeEnv, new URL(req.url), { email: 'rep@example.test' }, {})).status, 400, `AE POST rejects internal ${field}`);
  }
  eq(aeWrites.filter(entry => entry.kind === 'write').length, 0, 'general AE POST internal fields make zero persistence writes');
  for (const patch of [{ items: {} }, { items: 'not-array' }, { items: null }, { contacts: {} }, { contacts: 'not-array' }, { contacts: null }]) {
    assert.throws(() => validateWork({ ...emptyWork(), ...patch }), /INVALID_WORK/); checks++;
  }
}

const runner = join(root, 'worker/ae/migrations/run-local.mjs');
const run = file => execFileSync(process.execPath, [runner, file], { stdio: 'pipe' });
const fails = (file, pattern, message) => { assert.throws(() => run(file), pattern, message); checks++; };
const temp = mkdtempSync(join(tmpdir(), 'pv-sec-migration-'));
try {
  const fresh = join(temp, 'fresh.sqlite'); new DatabaseSync(fresh).exec(schema); run(fresh); run(fresh);
  let db = new DatabaseSync(fresh); for (const id of ['001_case_work','002_case_version','003_work_status_notifications','004_case_mutation_token']) ok(db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(id), `fresh ledger ${id}`); eq(db.prepare("SELECT count(*) n FROM pragma_table_info('ae_cases') WHERE name='version'").get().n, 1, 'fresh has one version'); eq(db.prepare("SELECT count(*) n FROM pragma_table_info('ae_cases') WHERE name='last_mutation_id'").get().n, 1, 'fresh has one token'); ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='ae_work_assignment_notification_update'").get(), '003 trigger exists'); db.close();
  const legacy = join(temp, 'legacy.sqlite'); db = new DatabaseSync(legacy); db.exec(schema.replace(/\n  version\s+INTEGER NOT NULL DEFAULT 0,/,'').replace(/\n  -- Request-unique[\s\S]*?last_mutation_id\s+TEXT,/, '')); db.close(); run(legacy); db = new DatabaseSync(legacy); ok(db.prepare("SELECT 1 FROM pragma_table_info('ae_cases') WHERE name='version'").get(), 'legacy version added'); ok(db.prepare("SELECT 1 FROM pragma_table_info('ae_cases') WHERE name='last_mutation_id'").get(), 'legacy token added'); db.close();
  const badLedger = join(temp, 'bad-ledger.sqlite'); db = new DatabaseSync(badLedger); db.exec(schema.replace(/\n  version\s+INTEGER NOT NULL DEFAULT 0,/,'').replace(/\n  -- Request-unique[\s\S]*?last_mutation_id\s+TEXT,/, '') + "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES('002_case_version','x');"); db.close(); fails(badLedger, /fail closed/, 'ledgered missing column fails closed');
  const wrongLedger = join(temp, 'wrong-ledger.sqlite'); db = new DatabaseSync(wrongLedger); db.exec(schema + "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT); INSERT INTO schema_migrations VALUES('001_case_work','x');"); db.close(); fails(wrongLedger, /schema_migrations definition differs/, 'wrong ledger definition fails before writing');
  const missing003 = join(temp, 'missing-003.sqlite'); db = new DatabaseSync(missing003); db.exec(schema + readFileSync(join(root, 'worker/ae/migrations/001_case_work.sql'), 'utf8') + "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES('001_case_work','x'); INSERT INTO schema_migrations VALUES('002_case_version','x'); INSERT INTO schema_migrations VALUES('003_work_status_notifications','x'); INSERT INTO schema_migrations VALUES('004_case_mutation_token','x');"); db.close(); fails(missing003, /003_work_status_notifications: ledger says applied/, 'ledgered missing 003 fails closed');
  const partial = join(temp, 'partial.sqlite'); db = new DatabaseSync(partial); db.exec(schema + readFileSync(join(root, 'worker/ae/migrations/001_case_work.sql'), 'utf8') + "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES('001_case_work','x'); INSERT INTO schema_migrations VALUES('002_case_version','x'); ALTER TABLE ae_case_work ADD COLUMN status TEXT;"); db.close(); fails(partial, /partial.*schema/, 'unledgered partial 003 fails closed');
  const globalPreflight = join(temp, 'global-preflight.sqlite'); db = new DatabaseSync(globalPreflight); db.exec(schema + readFileSync(join(root, 'worker/ae/migrations/001_case_work.sql'), 'utf8') + 'ALTER TABLE ae_case_work ADD COLUMN status TEXT;'); db.close(); fails(globalPreflight, /partial.*schema/, 'global preflight rejects drift before creating ledger'); db = new DatabaseSync(globalPreflight); eq(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get().n, 0, 'failed global preflight writes no ledger'); db.close();

  // Drift must fail regardless of whether a ledger row was written.  Every DB
  // begins as a verified normal schema so a rejection cannot be hidden by a
  // separate missing-footprint failure.
  const drift = (name, mutate, ledger = true) => {
    const file = join(temp, `${name}.sqlite`); const d = new DatabaseSync(file); d.exec(schema); d.close(); run(file);
    const altered = new DatabaseSync(file); altered.exec(mutate); if (!ledger) altered.exec("DELETE FROM schema_migrations WHERE id='003_work_status_notifications'"); altered.close();
    fails(file, /(?:001_case_work|003_work_status_notifications): .*?(definition differs|partial or drifted schema)/, `${name} rejects definition drift`);
  };
  drift('wrong-trigger-same-name', "DROP TRIGGER ae_work_assignment_notification_update; CREATE TRIGGER ae_work_assignment_notification_update AFTER INSERT ON ae_cases BEGIN SELECT 1; END");
  drift('wrong-trigger-target', "DROP TRIGGER ae_work_assignment_notification_update; CREATE TRIGGER ae_work_assignment_notification_update AFTER UPDATE OF assignee ON ae_notifications BEGIN SELECT 1; END");
  drift('wrong-index-columns-order', 'DROP INDEX idx_ae_case_work_workbench; CREATE INDEX idx_ae_case_work_workbench ON ae_case_work(assignee, work_due_date, status, case_id)');
  drift('wrong-index-unique', 'DROP INDEX idx_ae_case_work_workbench; CREATE UNIQUE INDEX idx_ae_case_work_workbench ON ae_case_work(status, work_due_date, assignee, case_id)');
  drift('wrong-index-partial', "DROP INDEX idx_ae_case_work_workbench; CREATE INDEX idx_ae_case_work_workbench ON ae_case_work(status, work_due_date, assignee, case_id) WHERE assignee <> ''");
  drift('wrong-column-type', 'DROP TRIGGER ae_work_created; DROP TRIGGER ae_work_updated; ALTER TABLE ae_case_work DROP COLUMN audit_action; ALTER TABLE ae_case_work ADD COLUMN audit_action INTEGER NOT NULL DEFAULT 0');
  drift('wrong-column-default', "DROP TRIGGER ae_work_created; DROP TRIGGER ae_work_updated; ALTER TABLE ae_case_work DROP COLUMN audit_action; ALTER TABLE ae_case_work ADD COLUMN audit_action TEXT NOT NULL DEFAULT 'wrong'");
  drift('wrong-column-notnull', "DROP TRIGGER ae_work_created; DROP TRIGGER ae_work_updated; ALTER TABLE ae_case_work DROP COLUMN audit_action; ALTER TABLE ae_case_work ADD COLUMN audit_action TEXT");
  drift('wrong-column-check', "DROP INDEX idx_ae_case_work_workbench; DROP TRIGGER ae_work_created; DROP TRIGGER ae_work_updated; ALTER TABLE ae_case_work DROP COLUMN status; ALTER TABLE ae_case_work ADD COLUMN status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo')); CREATE INDEX idx_ae_case_work_workbench ON ae_case_work(status, work_due_date, assignee, case_id)");
  drift('unledgered-wrong-trigger', "DROP TRIGGER ae_work_assignment_notification_update; CREATE TRIGGER ae_work_assignment_notification_update AFTER INSERT ON ae_cases BEGIN SELECT 1; END", false);
  const legacy001 = join(temp, 'legacy-001-replaced.sqlite'); db = new DatabaseSync(legacy001); db.exec(schema + readFileSync(join(root, 'worker/ae/migrations/001_case_work.sql'), 'utf8') + readFileSync(join(root, 'worker/ae/migrations/003_work_status_notifications.sql'), 'utf8') + "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES('001_case_work','x'); INSERT INTO schema_migrations VALUES('002_case_version','x');"); db.close(); run(legacy001); run(legacy001); db = new DatabaseSync(legacy001); ok(db.prepare("SELECT 1 FROM schema_migrations WHERE id='003_work_status_notifications'").get(), 'verified 003 replacements allow legacy 001 rerun'); db.close();
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`PASS ${checks} SQLite security/migration assertions`);
