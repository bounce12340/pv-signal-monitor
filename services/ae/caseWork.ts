// 個案的內部工作管理（指派、內部到期日、待辦、聯絡紀錄）、工作台與站內提醒。
// 從 PV-Link 的 services/caseWork.ts 搬入；去掉了直接開 IndexedDB 的「本機展示」模式
// （見 aeApi.ts 開頭的說明），一律走同源 Worker。
//
// 內部工作與法規個案狀態／法規到期日是兩回事：這裡的 workDueDate 只是內部排程，
// 不影響 aeReport.ts 算出的 15 日通報期限。
import { validateWork } from './caseWorkModel.js';
import { AE_API_BASE } from './aeApi';

export type WorkStatus = 'todo' | 'in-progress' | 'waiting' | 'completed' | 'cancelled';
export type CaseWork = { version: number; status: WorkStatus | string; assignee: string; nextAction: string; workDueDate: string; items: { id: string; title: string; status: string }[]; contacts: { id: string; date: string; method: string; result: string; nextFollowUp: string }[]; completedAt?: string; completedBy?: string; cancelledAt?: string; cancelledBy?: string; cancelReason?: string };
export type WorkInput = Omit<CaseWork, 'completedAt' | 'completedBy' | 'cancelledAt' | 'cancelledBy'> & { cancelReason?: string };
export type WorkResult = { work: CaseWork; audit: { version: number; at: string; actor: string; action: string }[] };
export type Workbench = { timezone: 'Asia/Taipei'; today: string; weekStart: string; weekEnd: string; scope: 'today'|'week'|'overdue'; from: string; to: string; items: { caseId: string; caseNumber: string; version: number; status: WorkStatus; assignee: string; workDueDate: string; overdue: boolean }[] };
export type InAppNotification = { id: string; kind: 'work_assigned'|'work_due'; caseId: string; createdAt: string; readAt: string|null };

async function api(path: string, body?: unknown, method?: string) {
  const res = await fetch(AE_API_BASE + path, {
    credentials: 'same-origin',
    method: method || (body ? 'PUT' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(res.status === 409 ? 'WORK_CONFLICT' : res.status === 400 ? 'INVALID_WORK' : `HTTP ${res.status}`);
  return res.json();
}

export const workUsers = async (): Promise<string[]> => (await api('/work-users')).users;
export const getCaseWork = (id: string): Promise<WorkResult> => api(`/${encodeURIComponent(id)}/work`);
export async function saveCaseWork(id: string, input: WorkInput): Promise<WorkResult> {
  // Do not echo server lifecycle metadata back; it is deliberately rejected by Worker validation.
  const clean: WorkInput = { version: input.version, status: input.status, assignee: input.assignee, nextAction: input.nextAction, workDueDate: input.workDueDate, items: input.items, contacts: input.contacts, ...(input.cancelReason !== undefined ? { cancelReason: input.cancelReason } : {}) };
  // Same validator the Worker runs: an invalid edit fails here, before any request.
  validateWork(clean);
  return api(`/${encodeURIComponent(id)}/work`, clean);
}
// 工作台與後台個案稽核軌跡共用同一個時間顯示規則（見 ./taipeiTime.ts）
export { formatTaipeiDateTime } from './taipeiTime';

export const getWorkbench = (scope: 'today'|'week'|'overdue'): Promise<Workbench> => api(`/workbench?scope=${scope}`);
export const getNotifications = (): Promise<{notifications: InAppNotification[]}> => api('/notifications');
export const readNotifications = (ids: string[]) => api('/notifications/read', { ids }, 'POST');
