// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleAeRequest } from './ae.js';
import { emptyWork } from '../../services/ae/caseWorkModel.js';
let db: DatabaseSync; let env: any;
async function call(method: string, path: string, body?: any, actor = 'pv@example.test') {
 const url = new URL('https://example.test/api/ae-reports' + path);
 return handleAeRequest(new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, url, { email: actor }, {});
}
beforeEach(async () => {
 db = new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
 const migration = readFileSync(new URL('./migrations/001_case_work.sql', import.meta.url), 'utf8'); db.exec(migration); db.exec(migration);
 const upgrade = readFileSync(new URL('./migrations/003_work_status_notifications.sql', import.meta.url), 'utf8'); db.exec(upgrade);
 const prepare = (query: string) => {
   let args: any[] = [];
   return { bind(...v: any[]) { args = v; return this; }, async first() { return db.prepare(query).get(...args) || null; }, async all() { return { results: db.prepare(query).all(...args) }; }, async run() { return { meta: db.prepare(query).run(...args) }; } };
 };
 env = { AE_PV_EMAILS: 'pv@example.test', DB: { prepare, async batch(statements: any[]) { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; } catch(e) { db.exec('ROLLBACK'); throw e; } } } };
 await call('POST', '', { id: 'demo', caseNumber: 'SYNTHETIC', events: [], drugs: [] }, 'rep@example.test');
});
afterEach(() => db.close());
describe('work real SQLite persistence and audit', () => {
 it('persists separate work without disclosing it in rep GET/list/audit', async () => {
   expect((await call('PUT', '/demo/work', { ...emptyWork(), nextAction: 'PRIVATE_SYNTHETIC', assignee: 'pv@example.test' }))?.status).toBe(200);
   expect((await (await call('GET', '/demo/work'))?.json()).work.nextAction).toBe('PRIVATE_SYNTHETIC');
   for (const path of ['', '/demo']) expect(await (await call('GET', path, undefined, 'rep@example.test'))?.text()).not.toContain('PRIVATE_SYNTHETIC');
   expect((await call('GET', '/demo/work', undefined, 'rep@example.test'))?.status).toBe(403);
   expect((await call('GET', '/work-users', undefined, 'rep@example.test'))?.status).toBe(403);
   expect(db.prepare('SELECT payload FROM ae_cases').get()?.payload).not.toContain('PRIVATE_SYNTHETIC');
 });
 it('conditional writes prevent stale first creation and subsequent overwrite; failed writes add no audit', async () => {
   expect((await call('PUT', '/demo/work', { ...emptyWork(), version: 2 }))?.status).toBe(409);
   expect((await call('PUT', '/demo/work', emptyWork()))?.status).toBe(200);
   expect((await call('PUT', '/demo/work', emptyWork()))?.status).toBe(409);
   expect((await call('PUT', '/demo/work', { ...emptyWork(), version: 1, nextAction: 'second' }))?.status).toBe(200);
   expect((await call('PUT', '/demo/work', { ...emptyWork(), version: 1, nextAction: 'lost' }))?.status).toBe(409);
   expect(db.prepare('SELECT COUNT(*) n FROM ae_work_audit').get()?.n).toBe(2);
   expect(db.prepare('SELECT version FROM ae_case_work').get()?.version).toBe(2);
 });
 it('audit is server attributed, immutable and atomic with work update', async () => {
   await call('PUT', '/demo/work', emptyWork());
   expect(db.prepare('SELECT actor FROM ae_work_audit').get()?.actor).toBe('pv@example.test');
   expect(() => db.exec('DELETE FROM ae_work_audit')).toThrow('immutable audit');
   expect(() => db.exec("UPDATE ae_work_audit SET actor='fake'")).toThrow('immutable audit');
   db.exec("CREATE TRIGGER fail_work_audit BEFORE INSERT ON ae_work_audit BEGIN SELECT RAISE(ABORT,'injected'); END;");
   expect((await call('PUT', '/demo/work', { ...emptyWork(), version: 1 }))?.status).toBe(500);
   expect(db.prepare('SELECT version FROM ae_case_work').get()?.version).toBe(1);
 });
 it('rejects deleted or absent cases and unauthenticated identity', async () => {
   expect((await call('PUT', '/absent/work', emptyWork()))?.status).toBe(404);
   await call('DELETE', '/demo');
   expect((await call('PUT', '/demo/work', emptyWork()))?.status).toBe(404);
   expect((await call('GET', '/demo/work'))?.status).toBe(404);
   expect((await call('GET', '/work-users', undefined, ''))?.status).toBe(401);
 });
 it('normal case updates cannot overwrite independent work', async () => {
   const workSaved = await call('PUT', '/demo/work', { ...emptyWork(), nextAction: 'keep' });
   expect(workSaved?.status).toBe(200);
   const caseUpdate = await call('PATCH', '/demo', { id: 'demo', version: 0, caseNumber: 'SYNTHETIC-UPDATED', events: [], drugs: [] });
   expect(caseUpdate?.status).toBe(200);
   expect((await caseUpdate?.json()).version).toBe(1);
   // Case numbers are server-assigned and immutable: the client's 'SYNTHETIC-UPDATED' is ignored.
   expect((db.prepare('SELECT case_number FROM ae_cases WHERE id=?').get('demo') as any).case_number).toMatch(/^PV-\d{4}-0001$/);
   expect((await (await call('GET', '/demo/work'))?.json()).work.nextAction).toBe('keep');
 });
 it('persists server lifecycle audit, workbench filtering and recipient-isolated notification reads', async () => {
   const completed = await call('PUT', '/demo/work', { ...emptyWork(), status: 'completed' });
   expect(completed?.status).toBe(200);
   const closed: any = await completed?.json(); expect(closed.work.completedBy).toBe('pv@example.test');
   const reopen = await call('PUT', '/demo/work', { ...emptyWork(), version: 1, status: 'todo', assignee: 'other@example.test', workDueDate: '2026-09-01' });
   expect(reopen?.status).toBe(400); // assignee must be a PV user
   await call('PUT', '/demo/work', { ...emptyWork(), version: 1, status: 'todo', assignee: 'pv@example.test', workDueDate: '2026-09-01' });
   expect(db.prepare("SELECT action FROM ae_work_audit ORDER BY version DESC LIMIT 1").get()?.action).toBe('work_reopened');
   const board = await call('GET', '/workbench?scope=overdue'); const data: any = await board?.json(); expect(data.timezone).toBe('Asia/Taipei'); expect(data.items).toHaveLength(1);
   const own = await call('GET', '/notifications'); const ownData: any = await own?.json(); const id = ownData.notifications[0]?.id; if (id) { await call('POST', '/notifications/read', { ids: [id] }); expect(db.prepare('SELECT read_at FROM ae_notifications WHERE id=?').get(id)?.read_at).toBeTruthy(); }
 });
 it('isolates workbench rows and notification read state to the verified PV actor', async () => {
   db.prepare("INSERT INTO ae_users(email, role, created_at) VALUES('other@example.test', 'pv', '2026-09-01T00:00:00.000Z')").run();
   await call('PUT', '/demo/work', { ...emptyWork(), assignee: 'other@example.test', workDueDate: '2026-09-01' }, 'pv@example.test');
   expect((await (await call('GET', '/workbench?scope=overdue'))?.json()).items).toHaveLength(0);
   expect((await (await call('GET', '/workbench?scope=overdue', undefined, 'other@example.test'))?.json()).items).toHaveLength(1);
   const notices: any = await (await call('GET', '/notifications', undefined, 'other@example.test'))?.json(); const id = notices.notifications[0].id;
   await call('POST', '/notifications/read', { ids: [id] }); expect(db.prepare('SELECT read_at FROM ae_notifications WHERE id=?').get(id)?.read_at).toBeNull();
   await call('POST', '/notifications/read', { ids: [id] }, 'other@example.test'); expect(db.prepare('SELECT read_at FROM ae_notifications WHERE id=?').get(id)?.read_at).toBeTruthy();
 });
});
