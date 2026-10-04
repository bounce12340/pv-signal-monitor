// @vitest-environment jsdom
// 後台收案：稽核軌跡顯示（從 PV-Link tests/caseAudit.test.ts 搬入）、收件匣版面，
// 以及 AEIntakePage 的載入／儲存／「內部工作」按鈕。service 層 mock 掉，不打網路。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from './testRender';
import { CASE_AUDIT_ACTION_KEY, caseAuditActionLabel, caseAuditDetailLabel } from './caseAudit';
import { translations } from '../../i18n/translations';
import { emptyAEReport, type AEReport } from '../../services/ae/aeReport';

vi.mock('../../services/ae/caseWork', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ae/caseWork')>();
  const m = await import('./caseWorkMocks');
  return {
    ...actual,
    workUsers: vi.fn(async () => ['pv.lin@example.com']),
    getWorkbench: vi.fn(async (scope: string) => ({ ...m.workbench(scope), items: [] })),
    getNotifications: vi.fn(async () => ({ notifications: [] })),
    getCaseWork: vi.fn(async () => ({ work: m.work({ version: 0, status: 'todo', assignee: '', workDueDate: '', items: [] }), audit: [] })),
    saveCaseWork: vi.fn(),
    readNotifications: vi.fn(),
  };
});
vi.mock('../../services/ae/aeApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/ae/aeApi')>()),
  listAECases: vi.fn(),
  saveAECase: vi.fn(),
  deleteAECase: vi.fn(),
  fetchIdentity: vi.fn(async () => ({ email: 'pv.lin@example.com', role: 'pv', profile: {}, profileComplete: true })),
}));

const zh = (k: any) => (translations.zh as any)[k] ?? k;
const api = await import('../../services/ae/aeApi');
const work = await import('../../services/ae/caseWork');
const { LangProvider } = await import('../../i18n/LangContext');
const { ThemeProvider } = await import('../../theme/ThemeContext');

function sampleCase(over: Partial<AEReport> = {}): AEReport {
  const r = emptyAEReport('2026-09-21');
  r.id = 'c-12'; r.caseNumber = 'PV-2026-0012'; r.status = 'triage';
  r.reporterName = 'Chen'; r.reporterEmail = 'sales.chen@example.com';
  r.events[0].verbatim = 'rash';
  r.auditTrail = [
    // 台北時間 9/22 00:30——照 UTC 字串截取會顯示成 9/21 16:30，差一天
    { at: '2026-09-21T16:30:00.000Z', actor: 'pv.lin@example.com', action: 'status', detail: 'triage' },
    { at: '2026-09-22T02:05:00.000Z', actor: 'pv.lin@example.com', action: 'future_action' },
  ];
  return { ...r, ...over };
}

let ui: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); Element.prototype.scrollIntoView = () => {}; });
afterEach(() => { ui?.unmount(); ui = null; });

async function mountPage(cases: AEReport[]) {
  vi.mocked(api.listAECases).mockResolvedValue(cases);
  const { default: AEIntakePage } = await import('./AEIntakePage');
  ui = await render(React.createElement(LangProvider, null, React.createElement(ThemeProvider, null, React.createElement(AEIntakePage))));
  return ui;
}
const openCase = async (caseNumber: string) => {
  await ui!.click([...ui!.host.querySelectorAll('button')].find(b => b.textContent?.includes(caseNumber)));
};

describe('audit action labels', () => {
  it('turns known action codes into words and leaves unknown ones exactly as stored', () => {
    expect(caseAuditActionLabel('status', zh)).toBe('變更狀態');
    expect(caseAuditActionLabel('received', zh)).toBe('送達後台');
    expect(caseAuditActionLabel('future_action', zh)).toBe('future_action');
    expect(caseAuditActionLabel('toString', zh)).toBe('toString');
  });

  it('translates detail only where it is a known code', () => {
    expect(caseAuditDetailLabel('status', 'triage', zh, 'zh')).toBe('收案中');
    expect(caseAuditDetailLabel('status', 'weird', zh, 'zh')).toBe('weird');
    expect(caseAuditDetailLabel('expectedness', 'unlisted', zh, 'en')).toBe('Unlisted (Unexpected)');
    expect(caseAuditDetailLabel('causality', 'probable', zh, 'zh')).toBe('很可能有關 (Probable/Likely)');
    expect(caseAuditDetailLabel('significant_new_info', 'true', zh, 'zh')).toBe('是');
    expect(caseAuditDetailLabel('awareness_date_changed', '2026-09-21', zh, 'zh')).toBe('2026-09-21');
    expect(caseAuditDetailLabel('mark_duplicate', 'PV-2026-0003', zh, 'zh')).toBe('PV-2026-0003');
  });

  it('has a label for every action code the app or the Worker writes', () => {
    // jsdom 環境下 import.meta.url 不是 file:// 路徑，改以專案根目錄（vitest 的 cwd）定位
    const dir = (d: string, re: RegExp) => readdirSync(resolve(process.cwd(), d)).filter(f => re.test(f) && !f.includes('.test.')).map(f => `${d}/${f}`);
    const files = [...dir('components/ae', /\.tsx?$/), ...dir('services/ae', /\.[jt]s$/), 'worker/ae/ae.js'];
    const found = new Set<string>();
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      for (const m of src.matchAll(/action:\s*'([a-z_]+)'/g)) found.add(m[1]);
      for (const m of src.matchAll(/patchTriage\([^\n]*?\},\s*'([a-z_]+)'/g)) found.add(m[1]);
      for (const m of src.matchAll(/SELECT \?, \?, \?, '([a-z_]+)'/g)) found.add(m[1]);
    }
    found.delete('work_saved'); // 內部工作的稽核在另一張表，由 CaseWorkBoard 自己翻譯
    expect(found.size).toBeGreaterThan(10);
    expect([...found].filter(code => !(code in CASE_AUDIT_ACTION_KEY))).toEqual([]);
  });
});

describe('PV intake console', () => {
  beforeEach(async () => { await mountPage([sampleCase()]); await openCase('PV-2026-0012'); });
  const auditHeading = () => [...ui!.host.querySelectorAll('h3')].find(e => e.textContent?.startsWith('稽核軌跡'))!;
  const auditRows = () => [...auditHeading().parentElement!.querySelectorAll('[title]')].map(e => e.textContent).join('|');

  it('shows audit times in Taipei time and says so', () => {
    expect(auditHeading().textContent).toContain('台北時間');
    expect(auditRows()).toContain('2026-09-22 00:30');
    expect(auditRows()).not.toContain('2026-09-21 16:30');
  });

  it('shows audit actions in words, with unknown codes left as stored', () => {
    expect(auditRows()).toContain('變更狀態：收案中');
    expect(auditRows()).not.toContain('status：triage');
    expect(auditRows()).toContain('future_action');
  });

  it('wraps the inbox filters instead of cutting the last one off', () => {
    const row = [...ui!.host.querySelectorAll('button')].find(b => b.textContent?.startsWith('全部'))!.parentElement!;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).not.toContain('overflow-x-auto');
  });

  it('lets an email break after the @ rather than mid-word', () => {
    const value = [...ui!.host.querySelectorAll('span')].find(s => s.textContent === 'sales.chen@example.com')!;
    expect(value.innerHTML).toBe('sales.chen@<wbr>example.com');
  });

  it('is rendered inside the AE styling scope', () => {
    expect(ui!.host.querySelector('.ae-theme')).not.toBeNull();
  });

  // 修正「新個案無法建立第一筆內部工作」
  it('opens this case’s internal work from the case page, even though the workbench lists nothing', async () => {
    expect(ui!.text()).toContain('沒有符合的未完成工作');
    await ui!.click(ui!.button('內部工作'));
    expect(vi.mocked(work.getCaseWork)).toHaveBeenCalledWith('c-12');
    expect(ui!.host.querySelector('legend')!.textContent).toContain('PV-2026-0012');
  });
});

describe('AEIntakePage data handling', () => {
  it('shows an error, not an empty inbox, when the case list cannot be loaded', async () => {
    vi.mocked(api.listAECases).mockRejectedValue(new Error('HTTP 500'));
    const { default: AEIntakePage } = await import('./AEIntakePage');
    ui = await render(React.createElement(LangProvider, null, React.createElement(ThemeProvider, null, React.createElement(AEIntakePage))));
    expect(ui.host.querySelector('[role="alert"]')!.textContent).toContain('讀取個案庫失敗');
    expect(ui.text()).not.toContain('收件匣');
    vi.mocked(api.listAECases).mockResolvedValue([sampleCase()]);
    await ui.click(ui.button('重新讀取'));
    expect(ui.host.querySelector('[role="alert"]')).toBeNull();
    expect(ui.text()).toContain('PV-2026-0012');
  });

  it('keeps the screen unchanged and says so when a save fails', async () => {
    await mountPage([sampleCase()]);
    await openCase('PV-2026-0012');
    vi.mocked(api.saveAECase).mockRejectedValue(new Error('HTTP 409'));
    await ui!.click(ui!.button('建立追蹤報告'));
    expect(ui!.host.querySelector('[role="alert"]')!.textContent).toContain('個案儲存失敗');
    expect(ui!.host.querySelector('[role="alert"]')!.textContent).toContain('HTTP 409');
  });

  it('creates a follow-up with POST and shows the number the Worker assigned', async () => {
    await mountPage([sampleCase()]);
    await openCase('PV-2026-0012');
    // 伺服器知道一筆前端沒看到的追蹤報告，配出 -F2；畫面要顯示伺服器的，而不是前端自己算的 -F1。
    vi.mocked(api.saveAECase).mockImplementation(async (r: AEReport) => ({ ...r, version: 0, caseNumber: 'PV-2026-0012-F2' }));
    await ui!.click(ui!.button('建立追蹤報告'));
    const [sent, opts] = vi.mocked(api.saveAECase).mock.calls[0];
    expect(opts).toEqual({ create: true });
    expect(sent.followUpOfId).toBe('c-12');
    expect(sent.caseNumber).toBe('PV-2026-0012-F1');
    expect(ui!.text()).toContain('PV-2026-0012-F2');
    expect(ui!.text()).not.toContain('PV-2026-0012-F1');
  });
});
