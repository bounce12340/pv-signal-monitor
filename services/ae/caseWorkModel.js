// Shared strict schema: internal work is never part of AEReport.
export const WORK_FIELDS = ['workManagement', 'assignee', 'nextAction', 'workDueDate', 'items', 'contacts', 'workVersion', 'completedAt', 'completedBy', 'cancelledAt', 'cancelledBy', 'cancelReason'];
export const WORK_STATUSES = ['todo', 'in-progress', 'waiting', 'completed', 'cancelled'];
export const ACTIVE_WORK_STATUSES = ['todo', 'in-progress', 'waiting'];
const lifecycle = ['completedAt', 'completedBy', 'cancelledAt', 'cancelledBy', 'cancelReason'];
export function emptyWork() { return { version: 0, status: 'todo', assignee: '', nextAction: '', workDueDate: '', items: [], contacts: [] }; }
export function isActiveWork(work) { return ACTIVE_WORK_STATUSES.includes(work?.status || 'todo'); }
export function validateDate(value, required = false) {
  if (typeof value !== 'string' || value.length > 10 || (required && !value.trim())) throw new Error('INVALID_WORK');
  const v = value.trim();
  if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '1900-01-01' || v > '9999-12-31' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new Error('INVALID_WORK');
  return v;
}
/** Input contract deliberately excludes server-owned lifecycle fields. */
export function validateWork(input) {
  const fail = () => { throw new Error('INVALID_WORK'); };
  const object = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail(); };
  const text = (v, max, required = false) => { if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(); return v.trim(); };
  object(input, ['version', 'status', 'assignee', 'nextAction', 'workDueDate', 'items', 'contacts', 'cancelReason']);
  if (!Number.isSafeInteger(input.version) || input.version < 0 || !WORK_STATUSES.includes(input.status)) fail();
  if (!Array.isArray(input.items) || input.items.length > 50 || !Array.isArray(input.contacts) || input.contacts.length > 100) fail();
  const ids = new Set();
  const id = v => { text(v, 80, true); if (!/^[a-zA-Z0-9_-]+$/.test(v) || ids.has(v)) fail(); ids.add(v); return v; };
  return {
    version: input.version, status: input.status,
    assignee: text(input.assignee, 254).toLowerCase(), nextAction: text(input.nextAction, 1000), workDueDate: validateDate(input.workDueDate),
    items: input.items.map(v => { object(v, ['id', 'title', 'status']); const itemId = id(v.id); return { id: itemId, title: text(v.title, 300, true), status: v.status }; }).map(item => { if (!['pending', 'received', 'cancelled'].includes(item.status)) fail(); return item; }),
    contacts: input.contacts.map(v => { object(v, ['id', 'date', 'method', 'result', 'nextFollowUp']); if (!['phone', 'email', 'visit', 'other'].includes(v.method)) fail(); return { id: id(v.id), date: validateDate(v.date, true), method: v.method, result: text(v.result, 1000, true), nextFollowUp: validateDate(v.nextFollowUp) }; }),
  };
}
export function normalizeStoredWork(payload, version) {
  const parsed = payload && typeof payload === 'object' ? payload : {};
  // Legacy rows never infer completion from empty fields/items/regulatory status.
  const work = { ...emptyWork(), ...parsed, version, status: WORK_STATUSES.includes(parsed.status) ? parsed.status : 'todo' };
  for (const key of lifecycle) if (typeof work[key] !== 'string') delete work[key];
  return work;
}
export function transitionFor(previous, next, cancelReason) {
  const before = WORK_STATUSES.includes(previous) ? previous : 'todo';
  if (!WORK_STATUSES.includes(next)) throw new Error('INVALID_TRANSITION');
  if (ACTIVE_WORK_STATUSES.includes(before) && ACTIVE_WORK_STATUSES.includes(next)) return 'work_saved';
  if (ACTIVE_WORK_STATUSES.includes(before) && next === 'completed') return 'work_completed';
  if (ACTIVE_WORK_STATUSES.includes(before) && next === 'cancelled') {
    if (typeof cancelReason !== 'string' || !cancelReason.trim() || cancelReason.trim().length > 500) throw new Error('INVALID_CANCEL_REASON');
    return 'work_cancelled';
  }
  if (['completed', 'cancelled'].includes(before) && ACTIVE_WORK_STATUSES.includes(next)) return 'work_reopened';
  if (before === next) return 'work_saved';
  throw new Error('INVALID_TRANSITION');
}
export function matchesWork(work, filter, actor, today) {
  if (!isActiveWork(work)) return false;
  if (filter === 'mine') return !!actor && work.assignee === actor.trim().toLowerCase();
  if (filter === 'unassigned') return !work.assignee;
  if (filter === 'overdue') return !!work.workDueDate && work.workDueDate < today;
  return true;
}
