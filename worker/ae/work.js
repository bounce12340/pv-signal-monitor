import { emptyWork, validateWork, normalizeStoredWork, transitionFor, ACTIVE_WORK_STATUSES, validateDate } from '../../services/ae/caseWorkModel.js';

const MAX_BODY = 200000;
const reply = (cors, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const isoDay = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const addDays = (day, days) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export function taipeiRange(now = new Date()) { const today = isoDay(now), weekday = new Date(`${today}T00:00:00Z`).getUTCDay(), monday = addDays(today, weekday === 0 ? -6 : 1 - weekday); return { timezone: 'Asia/Taipei', today, weekStart: monday, weekEnd: addDays(monday, 7) }; }
async function readBody(request, cors) {
  const reader = request.body?.getReader(); if (!reader) return { error: reply(cors, { error: 'invalid body' }, 400) };
  let length = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_BODY) { await reader.cancel(); return { error: reply(cors, { error: 'body too large' }, 413) }; } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return { error: reply(cors, { error: 'INVALID_WORK' }, 400) }; }
}
async function users(env) { const { results } = await env.DB.prepare("SELECT email FROM ae_users WHERE lower(trim(role)) = 'pv' ORDER BY email").all(); return [...new Set([...(results || []).map(r => r.email.trim().toLowerCase()), ...(env.AE_PV_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)])]; }
async function scanDueNotifications(env, today) {
  // One bounded candidate query; unique recipient+dedupe key makes repeated loads/concurrency idempotent.
  const { results } = await env.DB.prepare(`SELECT w.case_id, w.assignee, w.work_due_date FROM ae_case_work w
    JOIN ae_cases c ON c.id=w.case_id AND c.deleted_at IS NULL
    WHERE w.status IN ('todo','in-progress','waiting') AND w.assignee <> '' AND w.work_due_date <> '' AND w.work_due_date <= ? LIMIT 100`).bind(today).all();
  const rows = results || []; if (!rows.length) return;
  const now = new Date().toISOString();
  const statements = rows.map(r => env.DB.prepare(`INSERT INTO ae_notifications(id, recipient, case_id, kind, dedupe_key, created_at)
    VALUES (?, ?, ?, 'work_due', ?, ?) ON CONFLICT(recipient, dedupe_key) DO NOTHING`).bind(crypto.randomUUID(), r.assignee, r.case_id, `work_due:${r.case_id}:${r.work_due_date}`, now));
  if (env.DB.batch) await env.DB.batch(statements); else for (const s of statements) await s.run();
}
async function workbench(request, env, actor, cors) {
  const q = new URL(request.url).searchParams, range = taipeiRange();
  const scope = q.get('scope') || 'today'; let from, to;
  if (scope === 'today') { from = range.today; to = addDays(range.today, 1); }
  else if (scope === 'week') { from = range.weekStart; to = range.weekEnd; }
  else if (scope === 'overdue') { from = '1900-01-01'; to = range.today; }
  else return reply(cors, { error: 'INVALID_SCOPE' }, 400);
  const limitRaw = Number(q.get('limit') || 50), limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
  await scanDueNotifications(env, range.today);
  const { results } = await env.DB.prepare(`SELECT w.case_id, w.version, w.status, w.assignee, w.work_due_date, c.case_number
    FROM ae_case_work w JOIN ae_cases c ON c.id=w.case_id AND c.deleted_at IS NULL
    WHERE w.status IN ('todo','in-progress','waiting') AND w.assignee = ? AND w.work_due_date >= ? AND w.work_due_date < ?
    ORDER BY w.work_due_date ASC, w.case_id ASC LIMIT ?`).bind(actor, from, to, limit).all();
  return reply(cors, { ...range, scope, from, to, items: (results || []).map(r => ({ caseId: r.case_id, caseNumber: r.case_number, version: r.version, status: r.status || 'todo', assignee: r.assignee, workDueDate: r.work_due_date, overdue: r.work_due_date < range.today })) });
}
async function notifications(request, env, actor, cors, seg) {
  if (seg[1] === 'read') {
    if (request.method !== 'POST') return reply(cors, { error: 'method not allowed' }, 405);
    const parsed = await readBody(request, cors); if (parsed.error) return parsed.error;
    const ids = parsed.value?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id))) return reply(cors, { error: 'INVALID_NOTIFICATION_IDS' }, 400);
    const marks = ids.map(() => '?').join(',');
    await env.DB.prepare(`UPDATE ae_notifications SET read_at = ? WHERE recipient = ? AND read_at IS NULL AND id IN (${marks})`).bind(new Date().toISOString(), actor, ...ids).run();
    return reply(cors, { ok: true });
  }
  if (request.method !== 'GET') return reply(cors, { error: 'method not allowed' }, 405);
  const n = Number(new URL(request.url).searchParams.get('limit') || 30), limit = Number.isSafeInteger(n) ? Math.min(Math.max(n, 1), 100) : 30;
  const { results } = await env.DB.prepare(`SELECT id, kind, case_id, created_at, read_at FROM ae_notifications WHERE recipient = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(actor, limit).all();
  // Fixed DTO: never include patient/case payload, assignee, next action or cancellation reason.
  return reply(cors, { notifications: (results || []).map(r => ({ id: r.id, kind: r.kind, caseId: r.case_id, createdAt: r.created_at, readAt: r.read_at || null })), pageLimit: limit });
}
export async function handleWork(request, env, seg, role, actor, cors) {
  if (role !== 'pv') return reply(cors, { error: 'forbidden' }, 403);
  try {
    if (seg.length === 1 && seg[0] === 'work-users') { if (request.method !== 'GET') return reply(cors, { error: 'method not allowed' }, 405); return reply(cors, { users: await users(env) }); }
    if (seg[0] === 'workbench') return request.method === 'GET' ? workbench(request, env, actor, cors) : reply(cors, { error: 'method not allowed' }, 405);
    if (seg[0] === 'notifications') return notifications(request, env, actor, cors, seg);
    const caseId = decodeURIComponent(seg[0]);
    if (seg.length !== 2 || seg[1] !== 'work' || (request.method !== 'GET' && request.method !== 'PUT')) return reply(cors, { error: 'method not allowed' }, 405);
    const row = await env.DB.prepare('SELECT id FROM ae_cases WHERE id = ? AND deleted_at IS NULL').bind(caseId).first(); if (!row) return reply(cors, { error: 'not found' }, 404);
    if (request.method === 'GET') {
      const stored = await env.DB.prepare('SELECT payload, version FROM ae_case_work WHERE case_id = ?').bind(caseId).first();
      const { results } = await env.DB.prepare('SELECT version, at, actor, action FROM ae_work_audit WHERE case_id = ? ORDER BY version DESC LIMIT 100').bind(caseId).all();
      return reply(cors, { work: stored ? normalizeStoredWork(JSON.parse(stored.payload), stored.version) : emptyWork(), audit: results || [] });
    }
    const parsed = await readBody(request, cors); if (parsed.error) return parsed.error;
    let work; try { work = validateWork(parsed.value); } catch { return reply(cors, { error: 'INVALID_WORK' }, 400); }
    if (work.assignee && !(await users(env)).includes(work.assignee)) return reply(cors, { error: 'INVALID_ASSIGNEE' }, 400);
    const old = await env.DB.prepare('SELECT payload, version FROM ae_case_work WHERE case_id = ?').bind(caseId).first();
    const prior = old ? normalizeStoredWork(JSON.parse(old.payload), old.version) : emptyWork();
    if (work.version !== prior.version) return reply(cors, { error: 'WORK_CONFLICT' }, 409);
    let action; try { action = transitionFor(prior.status, work.status, parsed.value?.cancelReason); } catch (e) { return reply(cors, { error: e.message }, 400); }
    const now = new Date().toISOString(), next = { ...work, version: work.version + 1 };
    if (next.status === 'completed') Object.assign(next, { completedAt: now, completedBy: actor });
    if (next.status === 'cancelled') Object.assign(next, { cancelledAt: now, cancelledBy: actor, cancelReason: parsed.value.cancelReason.trim() });
    if (ACTIVE_WORK_STATUSES.includes(next.status)) for (const key of ['completedAt','completedBy','cancelledAt','cancelledBy','cancelReason']) delete next[key];
    const result = await env.DB.prepare(`INSERT INTO ae_case_work(case_id, version, payload, status, assignee, work_due_date, updated_at, updated_by, audit_action)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM ae_cases WHERE id = ? AND deleted_at IS NULL)
      AND (? = 0 OR EXISTS(SELECT 1 FROM ae_case_work WHERE case_id = ?))
      ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,payload=excluded.payload,status=excluded.status,assignee=excluded.assignee,work_due_date=excluded.work_due_date,updated_at=excluded.updated_at,updated_by=excluded.updated_by,audit_action=excluded.audit_action
      WHERE ae_case_work.version = ?`).bind(caseId, next.version, JSON.stringify(next), next.status, next.assignee, next.workDueDate || null, now, actor, action, caseId, work.version, caseId, work.version).run();
    if (!result.meta?.changes) return reply(cors, { error: 'WORK_CONFLICT' }, 409);
    return reply(cors, { work: next, audit: [{ version: next.version, at: now, actor, action }] });
  } catch { return reply(cors, { error: 'work backend unavailable' }, 500); }
}
