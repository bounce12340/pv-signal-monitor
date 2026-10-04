// @vitest-environment jsdom
// 業務通報表單的行為：送出、離線佇列、我的通報紀錄、版面規則。jsdom 沒有 IndexedDB，
// 儲存層會退回 localStorage（與正式環境 IndexedDB 不可用時相同的路徑）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { render } from './testRender';
import { CASE_STATUS_TONE, caseStatusTone } from './caseStatus';
import { emptyAEReport, emptyEvent, emptyDrug, type AEReport } from '../../services/ae/aeReport';

const profile = { displayName: 'Chen', employeeId: 'S1', phone: '0912000000', contactEmail: 'c@example.com', org: 'Example Pharma', territory: 'N' };

function validDraft(): AEReport {
  const base = emptyAEReport('2026-10-01');
  return {
    ...base,
    reportSource: 'health_professional', awarenessDate: '2026-09-30',
    patientInitials: 'W.T.M.', patientSex: 'female', patientAgeValue: '62', patientAgeUnit: 'year',
    events: [{ ...emptyEvent(), id: 'ev1', verbatim: 'generalised rash', onsetDate: '2026-09-28', outcome: 'recovering' }],
    drugs: [{ ...emptyDrug(true), id: 'dr1', brandName: 'Examplol', activeIngredient: 'Exampline', lotNumber: 'A1', dailyDose: '200 mg QD', route: 'oral', indication: 'test', therapyStart: '2026-09-20', dechallenge: 'yes' }],
  } as AEReport;
}

async function mount() {
  const { default: AEReportMobile } = await import('./AEReportMobile');
  const { LangProvider } = await import('../../i18n/LangContext');
  return render(React.createElement(LangProvider, null, React.createElement(AEReportMobile, { profile, onEditProfile: () => {} })));
}

/** Restores a complete draft, then walks to the review step and presses Submit. */
async function submitDraft() {
  localStorage.setItem('ae_draft', JSON.stringify(validDraft()));
  const ui = await mount();
  for (let i = 0; i < 5; i++) await ui.click(ui.button('Next'));
  await ui.click(ui.button('Submit Report'));
  return ui;
}

let ui: Awaited<ReturnType<typeof mount>> | null = null;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', undefined);
  // jsdom 沒有實作捲動；表單換步驟時會捲回頂端。
  Element.prototype.scrollTo = () => {};
  localStorage.clear();
  localStorage.setItem('ae_lang', JSON.stringify('en'));
});
afterEach(() => { ui?.unmount(); ui = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('submitting a report', () => {
  it('delivers to the same-origin API and clears the draft', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: 0, caseNumber: 'PV-2026-0042' }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    ui = await submitDraft();
    expect(fetch).toHaveBeenCalledWith('/api/ae-reports', expect.objectContaining({ method: 'POST' }));
    const sent = JSON.parse((fetch.mock.calls[0] as any)[1].body);
    expect(sent.reporterName).toBe('Chen');
    expect(sent.status).toBe('submitted');
    expect(sent.caseNumber).toBe('');
    expect(ui.text()).toContain('Delivered');
    // The number shown is the one the Worker assigned, not one computed on the phone.
    expect(ui.text()).toContain('Case number: PV-2026-0042');
    expect(localStorage.getItem('ae_draft')).toBeNull();
  });

  it('queues the report when offline, says so, and still clears the draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    ui = await submitDraft();
    const outbox = JSON.parse(localStorage.getItem('ae_outbox') || '[]');
    expect(outbox).toHaveLength(1);
    expect(ui.text()).toMatch(/queue/i);
    expect(ui.text()).not.toContain('Delivered');
    // No number exists yet; showing one would be a number nobody assigned.
    expect(ui.text()).toContain('assigned once delivered');
    expect(ui.text()).not.toMatch(/PV-\d{4}-\d{4}/);
    expect(localStorage.getItem('ae_draft')).toBeNull();
  });

  it('keeps the form and draft when the report could not be saved anywhere', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    localStorage.setItem('ae_draft', JSON.stringify(validDraft()));
    ui = await mount();
    for (let i = 0; i < 5; i++) await ui.click(ui.button('Next'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await ui.click(ui.button('Submit Report'));
    expect(localStorage.getItem('ae_outbox')).toBeNull();
    expect(localStorage.getItem('ae_draft')).not.toBeNull();
    expect(ui.button('Submit Report')).toBeTruthy();
  });
});

describe('My reports list', () => {
  const mk = (n: string, status: string, serious: boolean) => {
    const r = emptyAEReport('2026-09-30') as any;
    r.caseNumber = n; r.status = status;
    r.events[0].verbatim = 'rash'; r.events[0].seriousnessCriteria = serious ? ['hospitalization'] : [];
    return r;
  };

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ cases: [mk('PV-2026-0009', 'follow_up', true), mk('PV-2026-0012', 'triage', false)] }))));
    ui = await mount();
    await ui.click(ui.button('My reports'));
  });
  const badge = (text: string) => [...ui!.host.querySelectorAll('span')].find(s => s.textContent === text)!;

  it('loads the rep’s cases from the API', () => {
    expect(badge('PV-2026-0009')).toBeTruthy();
    expect(badge('PV-2026-0012')).toBeTruthy();
  });

  it('colours each status like the PV console instead of one colour for all', () => {
    expect(badge('Awaiting follow-up').className).toContain('caution');
    expect(badge('In triage').className).toContain('brand');
  });

  it('never truncates the case number, which is how a rep tells cases apart', () => {
    expect(badge('PV-2026-0009').className).toContain('whitespace-nowrap');
    expect(badge('PV-2026-0009').className).not.toContain('truncate');
  });
});

describe('case status colours', () => {
  it('marks "awaiting follow-up" as needing attention and falls back to neutral for unknown states', () => {
    expect(CASE_STATUS_TONE.follow_up).toBe('caution');
    expect(CASE_STATUS_TONE.invalid).toBe('danger');
    expect(caseStatusTone('something_new')).toBe('neutral');
    expect(caseStatusTone('toString')).toBe('neutral');
  });
});

describe('date fields on phones', () => {
  // jsdom 不做版面計算；改從原始碼守住「日期欄不放進固定兩欄」——390px 寬的手機放不下兩個日期欄。
  it('never puts a date or month input in a fixed two-column grid', () => {
    const bad: string[] = [];
    for (const f of ['AEReportMobile.tsx', 'ProfileSetup.tsx']) {
      const lines = readFileSync(new URL(f, import.meta.url), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/className="[^"]*(?<![\w:-])grid-cols-2\b/.test(line)) return;
        const indent = line.length - line.trimStart().length;
        let j = i + 1;
        while (j < lines.length && !(lines[j].trim() === '</div>' && lines[j].length - lines[j].trimStart().length === indent)) j++;
        if (/type="(?:date|month)"/.test(lines.slice(i, j).join('\n'))) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
