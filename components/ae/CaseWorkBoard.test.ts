// @vitest-environment jsdom
// 工作台的行為測試（從 PV-Link tests/caseWork.board.test.ts、caseWork.ui.test.ts 搬入）：在 jsdom 裡
// 真的 render、點擊、等 effect 跑完。service 層 mock 掉，元件走完 refresh → 列表 → 開啟 → 儲存。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render, settle } from './testRender';
import { work, workbench } from './caseWorkMocks';

vi.mock('../../services/ae/caseWork', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ae/caseWork')>();
  const m = await import('./caseWorkMocks');
  return {
    ...actual,
    workUsers: vi.fn(async () => ['alice@example.com', 'bob@example.com']),
    getWorkbench: vi.fn(async (scope: string) => m.workbench(scope)),
    getNotifications: vi.fn(async () => ({ notifications: [
      { id: 'n1', kind: 'work_due', caseId: 'c-1', createdAt: '2026-10-03T02:11:00.000Z', readAt: null },
    ] })),
    getCaseWork: vi.fn(async () => ({ work: m.work(), audit: [
      { version: 3, at: '2026-10-02T16:30:00.000Z', actor: 'alice@example.com', action: 'work_saved' },
    ] })),
    saveCaseWork: vi.fn(async () => ({ work: m.work({ version: 4 }), audit: [] })),
    readNotifications: vi.fn(async () => ({})),
  };
});

const { default: CaseWorkBoard } = await import('./CaseWorkBoard');
const { LangProvider } = await import('../../i18n/LangContext');
const svc = await import('../../services/ae/caseWork');

let ui: Awaited<ReturnType<typeof render>>;
const mount = async (props: Record<string, unknown> = {}) => {
  ui = await render(React.createElement(LangProvider, null, React.createElement(CaseWorkBoard, { cases: [], ...props } as any)));
};
beforeEach(async () => { vi.clearAllMocks(); localStorage.clear(); Element.prototype.scrollIntoView = () => {}; await mount(); });
afterEach(() => ui.unmount());

const host = () => ui.host;
const row = (caseNumber: string) => [...host().querySelectorAll('tbody tr')].find(tr => tr.textContent?.includes(caseNumber)) as HTMLTableRowElement;
const openCase = async (caseNumber: string) => { await ui.click(row(caseNumber).querySelector('button')); };
const saveButton = () => [...host().querySelectorAll('button')].find(b => b.textContent === '儲存工作') as HTMLButtonElement;
const typeNextAction = async (text: string) => {
  const nextAction = host().querySelectorAll('fieldset textarea')[0] as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(nextAction, text);
    nextAction.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('work board list', () => {
  it('states that internal work is separate from regulatory status, and sends no email', () => {
    const text = ui.text();
    expect(text).toContain('工作狀態與工作到期日均與法規個案狀態／法規到期日分開');
    expect(text).toContain('不寄信');
    expect(host().querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('renders cases as a table with column headers instead of dot-joined strings', () => {
    expect([...host().querySelectorAll('thead th')].map(th => th.textContent)).toEqual(['個案編號', '內部工作狀態', '負責人', '內部工作到期日']);
    const cells = [...row('AE-2026-0012').querySelectorAll('td')].map(td => td.textContent?.trim());
    expect(cells.slice(0, 3)).toEqual(['AE-2026-0012', '進行中', 'alice@example.com']);
    expect(host().querySelector('tbody')!.textContent).not.toContain(' · ');
  });

  it('marks internal overdue work with a word and caution, keeping danger for regulatory alarms', () => {
    const due = row('AE-2026-0012').querySelectorAll('td')[3];
    expect(due.textContent).toContain('逾期');
    expect(due.innerHTML).toContain('caution');
    expect(due.innerHTML).not.toContain('danger');
    expect(row('AE-2026-0013').querySelectorAll('td')[3].textContent).not.toContain('逾期');
  });

  it('shows unassigned work explicitly', () => {
    expect(row('AE-2026-0013').querySelectorAll('td')[2].textContent).toBe('未分派');
  });

  it('exposes one real, unbreakable button per row, named by the case number', () => {
    const buttons = row('AE-2026-0012').querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('AE-2026-0012');
    expect(buttons[0].className).toContain('whitespace-nowrap');
  });

  it('makes the selected scope visually distinct, not only aria-pressed', () => {
    const scopeButtons = [...host().querySelectorAll('button[aria-pressed]')] as HTMLButtonElement[];
    const pressed = scopeButtons.filter(b => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.map(b => b.textContent)).toEqual(['今日']);
    scopeButtons.filter(b => b !== pressed[0]).forEach(b => expect(b.className).not.toBe(pressed[0].className));
  });

  it('shows notification time in Asia/Taipei rather than raw ISO', () => {
    const li = host().querySelector('section li')!;
    expect(li.textContent).toContain('2026-10-03 10:11');
    expect(li.textContent).not.toContain('T02:11');
  });

  it('carries no local-demo notice', () => {
    expect(ui.text()).not.toContain('本機試用');
  });
});

describe('work board editor', () => {
  it('titles the editor with the human case number and marks the open row', async () => {
    await openCase('AE-2026-0012');
    expect(host().querySelector('legend')!.textContent).toContain('AE-2026-0012');
    expect(row('AE-2026-0012').querySelector('button')!.getAttribute('aria-current')).toBe('true');
  });

  it('labels a cancelled information request in words, not as a raw translation key', async () => {
    await openCase('AE-2026-0012');
    const itemStatus = host().querySelector('select[aria-label="取得狀態 1"]') as HTMLSelectElement;
    expect(itemStatus.value).toBe('cancelled');
    expect(itemStatus.selectedOptions[0].textContent).toBe('已取消');
    expect([...host().querySelectorAll('fieldset option')].map(o => o.textContent).join('|')).not.toContain('work.');
  });

  it('associates editor fields with their visible labels', async () => {
    await openCase('AE-2026-0012');
    const statusSelect = host().querySelector('fieldset select') as HTMLSelectElement;
    expect(document.getElementById(statusSelect.getAttribute('aria-labelledby')!)?.textContent).toBe('內部工作狀態');
  });

  it('shows audit time in Asia/Taipei, crossing midnight correctly', async () => {
    await openCase('AE-2026-0012');
    expect(host().querySelectorAll('[aria-labelledby$="-audit"] table tbody tr')[0].textContent).toContain('2026-10-03 00:30');
  });

  it('names audit actions in words, but shows an unknown action code verbatim', async () => {
    vi.mocked(svc.getCaseWork).mockResolvedValueOnce({ work: work() as any, audit: [
      { version: 3, at: '2026-10-02T16:30:00.000Z', actor: 'alice@example.com', action: 'work_saved' },
      { version: 2, at: '2026-10-01T16:30:00.000Z', actor: 'alice@example.com', action: 'work_archived' },
    ] });
    await openCase('AE-2026-0012');
    const actions = [...host().querySelectorAll('[aria-labelledby$="-audit"] table tbody tr')].map(tr => tr.lastElementChild!.textContent);
    expect(actions).toEqual(['儲存', 'work_archived']);
  });

  it('keeps the saved confirmation visible after the post-save refresh', async () => {
    await openCase('AE-2026-0012');
    await typeNextAction('電話追蹤藥師');
    expect(host().querySelector('legend')!.textContent).toContain('未儲存');
    await ui.click(saveButton());
    expect(host().querySelector('[role="status"][aria-live="polite"]')!.textContent).toBe('已儲存');
    expect(host().querySelector('legend')!.textContent).not.toContain('未儲存');
  });

  it('never natively disables the save button, so keyboard focus survives saving', async () => {
    let finish!: (v: any) => void;
    vi.mocked(svc.saveCaseWork).mockImplementationOnce(() => new Promise(r => { finish = r; }));
    await openCase('AE-2026-0012');
    const save = saveButton();
    expect(save.disabled).toBe(false);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.closest('fieldset')).toBeNull();
    await typeNextAction('改');
    save.focus();
    await act(async () => { save.click(); });
    expect(host().querySelector('fieldset')!.disabled).toBe(true);
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(save);
    await act(async () => { save.click(); });
    expect(vi.mocked(svc.saveCaseWork)).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ work: { ...work(), version: 4 }, audit: [] }); });
    await settle();
    expect(document.activeElement).toBe(save);
  });
});

// 修正「新個案無法建立第一筆內部工作」：工作台只列出已有工作的個案，openRequest 讓個案頁直接打開編輯器。
describe('opening a case’s work from outside the board', () => {
  const NEW_CASE = { id: 'c-new', caseNumber: 'PV-2026-0099' } as any;

  it('opens the editor for a case that is not on the workbench, and saves its first work item', async () => {
    ui.unmount();
    vi.mocked(svc.getCaseWork).mockResolvedValueOnce({ work: { ...work({ version: 0, status: 'todo', assignee: '', workDueDate: '', items: [] }) } as any, audit: [] });
    await mount({ cases: [NEW_CASE], openRequest: { caseId: 'c-new', seq: 1 } });
    expect(vi.mocked(svc.getCaseWork)).toHaveBeenCalledWith('c-new');
    expect((host().querySelector('details') as HTMLDetailsElement).open).toBe(true);
    expect(host().querySelector('legend')!.textContent).toContain('PV-2026-0099');
    expect(host().querySelector('legend')!.textContent).toContain('v0');
    await typeNextAction('請業務補實驗室數據');
    await ui.click(saveButton());
    expect(vi.mocked(svc.saveCaseWork)).toHaveBeenCalledWith('c-new', expect.objectContaining({ version: 0, nextAction: '請業務補實驗室數據' }));
  });

  it('does not throw away unsaved edits when another case is requested', async () => {
    ui.unmount();
    let request!: (r: { caseId: string; seq: number }) => void;
    const Harness = () => {
      const [req, setReq] = React.useState<{ caseId: string; seq: number } | undefined>();
      request = setReq;
      return React.createElement(LangProvider, null, React.createElement(CaseWorkBoard, { cases: [NEW_CASE], openRequest: req }));
    };
    ui = await render(React.createElement(Harness));
    await openCase('AE-2026-0012');
    await typeNextAction('還沒存');
    vi.mocked(svc.getCaseWork).mockClear();
    await act(async () => { request({ caseId: 'c-new', seq: 1 }); });
    await settle();
    expect(vi.mocked(svc.getCaseWork)).not.toHaveBeenCalled();
    expect(host().querySelector('legend')!.textContent).toContain('AE-2026-0012');
    expect(host().querySelector('[role="status"][aria-live="polite"]')!.textContent).toContain('未儲存');
  });
});
