// Test-only: synthetic workbench data shared by the CaseWorkBoard and intake-console tests.
export const work = (over: Record<string, unknown> = {}) => ({
  version: 3, status: 'in-progress', assignee: 'alice@example.com', nextAction: '', workDueDate: '2026-09-30',
  items: [{ id: 'i1', title: '補實驗室數據', status: 'cancelled' }], contacts: [], ...over,
});

export const workbench = (scope: string) => ({
  timezone: 'Asia/Taipei', today: '2026-10-03', weekStart: '2026-09-28', weekEnd: '2026-10-04', scope,
  from: '2026-10-03', to: '2026-10-03',
  items: [
    { caseId: 'c-1', caseNumber: 'AE-2026-0012', version: 3, status: 'in-progress', assignee: 'alice@example.com', workDueDate: '2026-09-30', overdue: true },
    { caseId: 'c-2', caseNumber: 'AE-2026-0013', version: 1, status: 'todo', assignee: '', workDueDate: '2026-10-05', overdue: false },
  ],
});
