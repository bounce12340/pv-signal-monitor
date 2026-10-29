// @vitest-environment jsdom
// 主管機關公告頁：依監測成分過濾、核閱寫回伺服器、來源狀態與未涵蓋國家照實顯示。
// 公告內容皆為虛構（Examplumab、testostatin 不是真實產品）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render } from './ae/testRender';
import type { RegAlertsData } from '../services/regulatory/api';

const api = vi.hoisted(() => ({
  loadRegAlerts: vi.fn(),
  saveReview: vi.fn(),
  saveWatchlist: vi.fn(),
  refreshRegSource: vi.fn(),
}));
vi.mock('../services/regulatory/api', () => api);

import { RegulatoryAlertsMode } from './RegulatoryAlertsMode';

const source = (id: string, over = {}) => ({
  id, name: `Source ${id}`, country: 'GB', homepage: `https://example.test/${id}`, note: '',
  last_attempt: new Date().toISOString(), last_success: new Date().toISOString(), last_error: null, last_count: 3, ...over,
});
const alert = (id: string, title: string, over = {}) => ({
  id, source: 'mhra', title, url: `https://example.test/${id}`, published: '2026-10-20', summary: '', substances: '',
  first_seen: '2026-10-20T10:00:00Z', review: null, ...over,
});

function fixture(over: Partial<RegAlertsData> = {}): RegAlertsData {
  return {
    since: '2026-07-01',
    sources: [source('mhra'), source('tfda', { country: 'TW', last_success: null, last_error: 'HTTP 403 from www.fda.gov.tw' })],
    uncovered: [{ country: 'CH', name: '瑞士 Swissmedic', reason: '非官方來源' }],
    alerts: [
      alert('a1', 'Testostatin: marketing authorisation withdrawn'),
      alert('a2', 'Examplumab: new warning'),
      alert('a3', 'testostatin: earlier note', { review: { status: 'assessed', note: 'ok', actor: 'pv@example.test', at: '2026-10-21T00:00:00Z' } }),
      alert('a4', 'Testostatin (bad link)', { url: 'javascript:alert(1)' }),
    ],
    watchlist: { items: [{ ingredient: 'testostatin', synonyms: [] }], updated_by: 'pv@example.test', updated_at: '2026-10-01T00:00:00Z' },
    ...over,
  };
}

let ui: Awaited<ReturnType<typeof render>> | null = null;
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.loadRegAlerts.mockResolvedValue(fixture());
});
afterEach(() => { ui?.unmount(); ui = null; });

const mount = async () => (ui = await render(React.createElement(RegulatoryAlertsMode)));
const listedIds = () => [...ui!.host.querySelectorAll('[data-alert-id]')].map((li) => li.getAttribute('data-alert-id'));

describe('RegulatoryAlertsMode', () => {
  it('lists unreviewed alerts that mention a monitored ingredient, and flags suspension wording', async () => {
    await mount();
    expect(listedIds()).toEqual(['a1', 'a4']);
    expect(ui!.host.querySelector('[data-testid="open-matched"]')!.textContent).toBe('2');
    const first = ui!.host.querySelector('[data-alert-id="a1"]')!;
    expect(first.textContent).toContain('含暫停／下市字樣');
    expect(ui!.host.querySelector('[data-alert-id="a4"]')!.textContent).not.toContain('含暫停／下市字樣');
  });

  it('never turns a non-http link from a feed into an href', async () => {
    await mount();
    const links = [...ui!.host.querySelectorAll('[data-alert-id="a4"] a')];
    expect(links.every((a) => !a.getAttribute('href'))).toBe(true);
    expect(ui!.host.querySelector('[data-alert-id="a1"] a')!.getAttribute('href')).toBe('https://example.test/a1');
  });

  it('shows failing sources and the countries nobody polls', async () => {
    await mount();
    const table = ui!.host.querySelector('[data-testid="source-table"]')!.textContent!;
    expect(table).toContain('抓取失敗');
    expect(table).toContain('HTTP 403 from www.fda.gov.tw');
    expect(ui!.text()).toContain('瑞士 Swissmedic');
  });

  it('widens to every alert and to reviewed ones on request', async () => {
    await mount();
    const scope = ui!.host.querySelector('select') as HTMLSelectElement;
    await act(async () => { scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(listedIds()).toEqual(['a1', 'a2', 'a4']);
    const openOnly = ui!.host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { openOnly.click(); });
    expect(listedIds()).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('lists everything while no ingredient is monitored', async () => {
    api.loadRegAlerts.mockResolvedValue(fixture({ watchlist: { items: [], updated_by: null, updated_at: null } }));
    await mount();
    expect(ui!.text()).toContain('尚未設定監測成分');
    expect(listedIds()).toEqual(['a1', 'a2', 'a4']);
  });

  it('saves a review with its note and shows who reviewed it', async () => {
    api.saveReview.mockResolvedValue({ status: 'action', note: '評估第 6 條通報', actor: 'pv@example.test', at: '2026-10-22T01:00:00Z' });
    await mount();
    const row = ui!.host.querySelector('[data-alert-id="a1"]')!;
    const note = row.querySelector('input[type="text"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(note, '評估第 6 條通報'); note.dispatchEvent(new Event('input', { bubbles: true })); });
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent === '需後續行動')!;
    await ui!.click(button);
    expect(api.saveReview).toHaveBeenCalledWith('a1', 'action', '評估第 6 條通報');
    // Reviewed → drops out of the default "unreviewed only" view.
    expect(listedIds()).toEqual(['a4']);
  });

  it('keeps the alert listed and says so when a review is refused', async () => {
    api.saveReview.mockRejectedValue(new Error('「需後續行動」須說明行動內容'));
    await mount();
    const row = ui!.host.querySelector('[data-alert-id="a1"]')!;
    await ui!.click([...row.querySelectorAll('button')].find((b) => b.textContent === '需後續行動'));
    expect(ui!.text()).toContain('核閱未儲存：「需後續行動」須說明行動內容');
    expect(listedIds()).toEqual(['a1', 'a4']);
  });

  it('edits the watchlist as text and sends the parsed list', async () => {
    api.saveWatchlist.mockResolvedValue({ items: [{ ingredient: 'examplumab', synonyms: ['エグザンプルマブ'] }], updated_by: 'pv@example.test', updated_at: '2026-10-22T00:00:00Z' });
    await mount();
    await ui!.click(ui!.button('編輯監測成分'));
    const area = ui!.host.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).toBe('testostatin');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(area, 'examplumab | エグザンプルマブ'); area.dispatchEvent(new Event('input', { bubbles: true })); });
    await ui!.click(ui!.button('儲存監測成分'));
    expect(api.saveWatchlist).toHaveBeenCalledWith([{ ingredient: 'examplumab', synonyms: ['エグザンプルマブ'] }]);
    expect(listedIds()).toEqual(['a2']);
  });

  it('explains a load failure instead of showing an empty list', async () => {
    api.loadRegAlerts.mockRejectedValue(new Error('reg_alerts tables missing: apply worker/regfeeds/schema.sql'));
    await mount();
    expect(ui!.text()).toContain('無法載入：reg_alerts tables missing');
  });
});
