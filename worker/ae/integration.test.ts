// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAeRequest } from './ae.js';

// Run the actual schema/SQL with foreign keys, constraints and transactional batch semantics.
let sql: DatabaseSync;
let env: any;
let files: Map<string, Uint8Array>;
const report = (id = 'case1', extra = {}) => ({ id, caseNumber: id, status: 'submitted', events: [], drugs: [], ...extra });
const photo = { id: 'photo1', name: 'photo.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQKaGVsbG8=' };
const changedPdf = 'data:application/pdf;base64,JVBERi0xLjQKY2hhbmdlZA==';
const blank = (id:string) => ({ id, caseNumber:id,status:'submitted',reportType:'initial',followUpOfId:'',awarenessDate:'',country:'',patientInitials:'',patientId:'',drugs:[],events:[],attachments:[],triage:{} });
function request(method: string, path = '', body?: unknown, actor = 'rep@example.test') {
  const url = new URL(`https://example.test/api/ae-reports${path}`);
  return handleAeRequest(new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, url, { email: actor }, {});
}
beforeEach(() => {
  sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  files = new Map();
  const prepare = (query: string) => ({ bind: (...args: any[]) => ({
    first: async () => sql.prepare(query).get(...args) || null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => ({ meta: sql.prepare(query).run(...args) }),
  }) });
  env = { AE_PV_EMAILS: 'pv@example.test', DB: { prepare, batch: async (statements: any[]) => {
    sql.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; }
    catch (e) { sql.exec('ROLLBACK'); throw e; }
  } }, AE_FILES: {
    put: vi.fn(async (key: string, bytes: Uint8Array) => { files.set(key, bytes); }),
    get: vi.fn(async (key: string) => files.has(key) ? { body: files.get(key) } : null),
  } };
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { sql.close(); vi.restoreAllMocks(); });

describe('AE API database regression', () => {
  it('updates same-case attachments without replacing original attribution', async () => {
    await request('POST', '', report('case1', { attachments: [photo] }));
    const first = sql.prepare('SELECT version FROM ae_cases WHERE id=?').get('case1');
    expect((await request('PATCH', '/case1', report('case1', { version:first.version, attachments: [{ ...photo, dataUrl: changedPdf }] }), 'pv@example.test'))?.status).toBe(200);
    expect(await (await request('GET', '/case1/attachments/photo1'))?.text()).toContain('changed');
    expect(sql.prepare('SELECT added_by FROM ae_attachments').get()?.added_by).toBe('rep@example.test');
  });
  it('rejects active HTML and mismatched image/pdf MIME before storage', async () => {
    const html = { id:'bad1', mime:'text/html', dataUrl:'data:text/html;base64,PGh0bWw+PC9odG1sPg==' };
    expect((await request('POST','',report('html',{attachments:[html]})))?.status).toBe(400);
    const mismatch = { id:'bad2', mime:'image/jpeg', dataUrl:photo.dataUrl };
    expect((await request('POST','',report('mismatch',{attachments:[mismatch]})))?.status).toBe(400);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_cases').get()?.n).toBe(0);
  });
  it('rejects fabricated remote URL pointers not registered to the case', async () => {
    const fake = { id:'ghost', url:'https://evil.test/pixel.png', mime:'image/png' };
    expect((await request('POST','',report('fake',{attachments:[fake]})))?.status).toBe(400);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_cases').get()?.n).toBe(0);
  });
  it('sets rep-submitted state on initial report and strips PV-only triage decisions', async () => {
    const r = { ...blank('rep-case'), status:'closed',triage:{validityConfirmed:true,expectedness:'expected',causality:'certain',seriousnessOverride:'non_serious',assignee:'pv',notes:'reporter note'},patientInitials:'X' };
    expect((await request('POST','',r))?.status).toBe(201);
    const caseId = String(sql.prepare('SELECT id FROM ae_cases WHERE id=?').get('rep-case')!.id);
    const saved = JSON.parse(sql.prepare('SELECT payload FROM ae_cases WHERE id=?').get(caseId)!.payload as string);
    expect(sql.prepare('SELECT status FROM ae_cases WHERE id=?').get('rep-case')?.status).toBe('submitted');
    expect(saved.triage).toBeDefined();
    expect(saved.triage.validityConfirmed).toBeUndefined();
    expect(saved.triage.seriousnessOverride).toBeUndefined();
    expect(saved.patientInitials).toBe('X');
  });
  it('keeps the reporter-entered source awareness date but never lets reps set MAH transmission fields', async () => {
    const r = { ...blank('relayed-case'), reportSource:'authority', awarenessDate:'2026-09-20', sourceAwarenessDate:'2026-09-12',
      transmittedToMahAt:'2026-09-21', mahCaseNumber:'MAH-FORGED', triage:{ transmittedToMahAt:'2026-09-21', mahCaseNumber:'MAH-FORGED' } };
    expect((await request('POST','',r))?.status).toBe(201);
    const saved = JSON.parse(sql.prepare('SELECT payload FROM ae_cases WHERE id=?').get('relayed-case')!.payload as string);
    // Reporter fact from the form: must survive the rep allow-list.
    expect(saved.sourceAwarenessDate).toBe('2026-09-12');
    // Day 0 is still the company awareness date, not the source date.
    expect(saved.awarenessDate).toBe('2026-09-20');
    expect(sql.prepare('SELECT awareness_date FROM ae_cases WHERE id=?').get('relayed-case')?.awareness_date).toBe('2026-09-20');
    // MAH transmission is PV work; reps cannot pre-fill it at either level.
    expect(saved.transmittedToMahAt).toBeUndefined();
    expect(saved.mahCaseNumber).toBeUndefined();
    expect(saved.triage.transmittedToMahAt).toBeUndefined();
    expect(saved.triage.mahCaseNumber).toBeUndefined();
  });
  it('rejects rep resubmission after PV workflow transition', async () => {
    await request('POST','',report('locked'));
    const assigned = sql.prepare('SELECT case_number FROM ae_cases WHERE id=?').get('locked')?.case_number;
    sql.prepare("UPDATE ae_cases SET status='triage' WHERE id='locked'").run();
    expect((await request('POST','',report('locked',{caseNumber:'rep-overwrite'})))?.status).toBe(403);
    expect(sql.prepare('SELECT case_number FROM ae_cases WHERE id=?').get('locked')?.case_number).toBe(assigned);
  });
  it('requires a matching version for PV updates and prevents lost update', async () => {
    await request('POST','',report('versioned'));
    const row = sql.prepare('SELECT version FROM ae_cases WHERE id=?').get('versioned')!.version as number;
    expect((await request('PATCH','/versioned',report('versioned',{version:row}), 'pv@example.test'))?.status).toBe(200);
    expect((await request('PATCH','/versioned',report('versioned',{version:row}), 'pv@example.test'))?.status).toBe(409);
    expect(sql.prepare('SELECT version FROM ae_cases WHERE id=?').get('versioned')?.version).toBe(row+1);
  });
  it('a competing create id collision cannot overwrite the other owner', async () => {
    await request('POST','',report('collision'));
    expect((await request('POST','',report('collision',{caseNumber:'overwrite'}),'other@example.test'))?.status).toBe(403);
    expect(sql.prepare('SELECT submitted_by FROM ae_cases WHERE id=?').get('collision')?.submitted_by).toBe('rep@example.test');
  });
  it('does not leave attachment metadata or audit when conditional SQL fails', async () => {
    await request('POST','',report('atomic',{attachments:[photo]}));
    const before=sql.prepare('SELECT count(*) n FROM ae_audit WHERE case_id=?').get('atomic')?.n;
    expect((await request('PATCH','/atomic',report('atomic',{version:99,attachments:[{...photo,dataUrl:'data:application/pdf;base64,JVBERi0xLjQKY2hhbmdlZA=='}]}),'pv@example.test'))?.status).toBe(409);
    expect(sql.prepare('SELECT count(*) n FROM ae_attachments WHERE id=?').get('photo1')?.n).toBe(1);
    expect(sql.prepare('SELECT count(*) n FROM ae_audit WHERE case_id=?').get('atomic')?.n).toBe(before);
  });
  it('rejects null attachment entries without saving a case', async () => {
    expect((await request('POST', '', report('case1', { attachments: [null] })))?.status).toBe(400);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_cases').get()?.n).toBe(0);
  });

  it('does not save SQL state when R2 upload fails', async () => {
    env.AE_FILES.put = async () => { throw new Error('injected upload failure'); };
    expect((await request('POST', '', report('case1', { attachments: [photo] })))?.status).toBe(500);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_cases').get()?.n).toBe(0);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_audit').get()?.n).toBe(0);
  });
  it('creates a new case with attachment under real foreign key enforcement', async () => {
    expect((await request('POST', '', report('case1', { attachments: [photo] })))?.status).toBe(201);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_attachments').get()?.n).toBe(1);
    const res = await request('GET', '/case1/attachments/photo1');
    expect(res?.headers.get('content-disposition')).toContain('attachment');
    expect(res?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res?.headers.get('content-security-policy')).toContain('sandbox');
    expect(res?.headers.get('content-type')).toBe('application/octet-stream');
    expect(await res?.text()).toContain('hello');
    expect(sql.prepare('SELECT actor FROM ae_audit').get()?.actor).toBe('rep@example.test');
  });
  it('rolls back case and attachment metadata if audit insertion fails', async () => {
    sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON ae_audit BEGIN SELECT RAISE(ABORT, 'injected'); END");
    expect((await request('POST', '', report('case1', { attachments: [photo] })))?.status).toBe(500);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_cases').get()?.n).toBe(0);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_attachments').get()?.n).toBe(0);
  });
  it('does not overwrite committed attachment bytes when an update fails', async () => {
    await request('POST', '', report('case1', { attachments: [photo] }));
    sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON ae_audit BEGIN SELECT RAISE(ABORT, 'injected'); END");
    const changed = { ...photo, dataUrl: changedPdf };
    expect((await request('PATCH', '/case1', report('case1', { version:sql.prepare('SELECT version FROM ae_cases WHERE id=?').get('case1').version, attachments: [changed], auditTrail: [{ action: 'update' }] }), 'pv@example.test'))?.status).toBe(500);
    expect(await (await request('GET', '/case1/attachments/photo1'))?.text()).toContain('hello');
  });
  it('rejects cross-case attachment id replacement', async () => {
    await request('POST', '', report('case1', { attachments: [photo] }));
    expect((await request('POST', '', report('case2', { attachments: [photo] }), 'other@example.test'))?.status).toBe(409);
    expect(sql.prepare('SELECT case_id FROM ae_attachments').get()?.case_id).toBe('case1');
  });
  it.each(['invalid', 'data:text/plain;base64,%%%'])('rejects malformed attachment instead of silently dropping it: %s', async (dataUrl) => {
    expect((await request('POST', '', report('case1', { attachments: [{ ...photo, dataUrl }] })))?.status).toBe(400);
    expect(sql.prepare('SELECT count(*) AS n FROM ae_cases').get()?.n).toBe(0);
  });
  it('rejects malformed report collections before mutation', async () => {
    expect((await request('POST', '', report('case1', { events: {} })))?.status).toBe(400);
  });
  it('keeps deletion and audit atomic and does not duplicate deletion audit', async () => {
    await request('POST', '', report());
    sql.exec("CREATE TRIGGER fail_delete_audit BEFORE INSERT ON ae_audit WHEN NEW.action='soft_deleted' BEGIN SELECT RAISE(ABORT, 'injected'); END");
    expect((await request('DELETE', '/case1', undefined, 'pv@example.test'))?.status).toBe(500);
    expect(sql.prepare('SELECT deleted_at FROM ae_cases').get()?.deleted_at).toBeNull();
    sql.exec('DROP TRIGGER fail_delete_audit');
    expect((await request('DELETE', '/case1', undefined, 'pv@example.test'))?.status).toBe(200);
    expect((await request('DELETE', '/case1', undefined, 'pv@example.test'))?.status).toBe(404);
    expect(sql.prepare("SELECT count(*) AS n FROM ae_audit WHERE action='soft_deleted'").get()?.n).toBe(1);
  });
  it('hides deleted cases and attachments from reps, retains PV inspection, rejects writes', async () => {
    await request('POST', '', report('case1', { attachments: [photo] }));
    await request('DELETE', '/case1', undefined, 'pv@example.test');
    expect((await request('GET', '/case1'))?.status).toBe(404);
    expect((await request('GET', '/case1/attachments/photo1'))?.status).toBe(404);
    expect((await request('GET', '/case1', undefined, 'pv@example.test'))?.status).toBe(200);
    expect((await request('PATCH', '/case1', report(), 'pv@example.test'))?.status).toBe(404);
    expect((await request('POST', '', report()))?.status).toBe(409);
  });
  it('does not reveal or overwrite another rep case', async () => {
    await request('POST', '', report());
    expect((await request('GET', '/case1', undefined, 'other@example.test'))?.status).toBe(404);
    expect((await request('POST', '', report(), 'other@example.test'))?.status).toBe(403);
  });
});
