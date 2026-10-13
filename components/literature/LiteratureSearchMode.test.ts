// @vitest-environment jsdom
// 文獻檢索頁：分隔符號容錯、執行前顯示檢索式、結果交代每一筆的去向（含已存在而略過的）。
// 回歸：用全形逗號或頓號分隔成分時，整串被當成一個藥名送出，PubMed 回 0 筆且沒有任何提示。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render, settle } from '../ae/testRender';
import { PENDING_KEY, saveRecords } from '../../services/literature/storage';
import { db } from '../../services/db';
import { DEFAULT_LIT_SEARCH, settings } from '../../services/settings';
import { buildPubMedQuery, parseTermList } from '../../services/literature/pubmed';
import { LiteratureSearchMode } from './LiteratureSearchMode';

vi.mock('../../services/literature/llmService', () => ({
  PVLLMService: class {
    scoreRelevance = async (recs: { pmid: string }[]) => recs.map((r) => ({ pmid: r.pmid, score: 80, reason: '' }));
    generateSummaries = async (recs: { pmid: string }[]) =>
      recs.map((r) => ({ pmid: r.pmid, summary_zh: '摘要', conclusion_zh: '' }));
  },
}));

// Fictional PubMed records: PubMed reports 7 hits but only 3 come back (the 最多取回筆數 cap).
const article = (pmid: string) =>
  `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><Journal><Title>Test Journal</Title>` +
  `<JournalIssue><PubDate><Year>2026</Year><Month>Aug</Month></PubDate></JournalIssue></Journal>` +
  `<ArticleTitle>Test article ${pmid}</ArticleTitle></Article></MedlineCitation></PubmedArticle>`;
const requested: string[] = [];
function stubPubMed() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('esearch.fcgi')) {
      return new Response(JSON.stringify({ esearchresult: {
        count: '7', idlist: ['1', '2', '3'],
        warninglist: { quotedphrasesnotfound: ['"Fenofibrate/adverse effects"[MeSH Terms]'] },
      } }));
    }
    return new Response(`<PubmedArticleSet>${['1', '2', '3'].map(article).join('')}</PubmedArticleSet>`);
  }));
}

async function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// The search pauses between NCBI calls (rate limit), so wait in real time for the outcome.
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) {
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  await settle();
}

let ui: Awaited<ReturnType<typeof render>> | null = null;
const setActiveMode = vi.fn();

beforeEach(() => {
  vi.stubGlobal('indexedDB', undefined);
  localStorage.clear();
  requested.length = 0;
  setActiveMode.mockClear();
  // PMID 2 is already awaiting review from an earlier round.
  saveRecords(PENDING_KEY, [{ id: '2', pmid: '2', source: 'pubmed', title: 'Earlier', relevance_score: 50 }] as any);
  stubPubMed();
  // storage.ts keeps an in-memory cache across tests; start every test from the default criteria.
  settings.saveLitSearch({ ...DEFAULT_LIT_SEARCH });
});
afterEach(() => { ui?.unmount(); ui = null; vi.unstubAllGlobals(); });

async function mount() {
  ui = await render(React.createElement(LiteratureSearchMode, { setActiveMode, setDbUpdateTrigger: vi.fn() }));
  return ui.host.querySelector('input[type="text"]') as HTMLInputElement; // 目標成分
}
const preview = () => ui!.host.querySelector('[data-testid="query-preview"]')?.textContent || '';
const summary = () => ui!.host.querySelector('[data-testid="search-summary"]')?.textContent || '';

describe('LiteratureSearchMode', () => {
  it('treats full-width commas and 頓號 as separators, and shows the query before running', async () => {
    const ingredients = await mount();
    await type(ingredients, 'Pravastatin，Fenofibrate、Diltiazem');
    expect(preview()).toContain('("Pravastatin") OR ("Fenofibrate") OR ("Diltiazem")');
    expect(ui!.text()).toContain('已辨識 3 個成分');
  });

  it('adds MeSH by default, and the checkbox takes it out of the query', async () => {
    const ingredients = await mount();
    await type(ingredients, 'Pravastatin');
    expect(preview()).toContain('"Pravastatin/adverse effects"[MeSH Terms]');
    expect(preview()).toContain('"adverse event*"');
    const mesh = [...ui!.host.querySelectorAll('input[type="checkbox"]')]
      .find((c) => c.closest('label')?.textContent?.includes('MeSH')) as HTMLInputElement;
    expect(mesh.checked).toBe(true);
    await act(async () => { mesh.click(); });
    expect(preview()).not.toContain('[MeSH Terms]');
  });

  it('accounts for every record, keeps the sent query on screen and logs it', async () => {
    const ingredients = await mount();
    await type(ingredients, 'Pravastatin，Fenofibrate');
    await ui!.click(ui!.button('執行檢索與 AI 評分'));
    await until(() => summary() !== '');

    const esearch = decodeURIComponent(requested.find((u) => u.includes('esearch.fcgi'))!);
    expect(esearch).toContain('("Pravastatin") OR ("Fenofibrate")');

    expect(summary()).toBe(
      'PubMed 共 7 筆；⚠️ 只取回前 3 筆（受「最多取回筆數」限制），其餘未納入；已在待核閱 1 筆（略過）；新增 2 筆至待核閱；' +
      'PubMed 查無下列詞、已略過："Fenofibrate/adverse effects"[MeSH Terms]（成分不是 MeSH 主題詞時屬正常，仍以關鍵字比對）。'
    );
    expect(ui!.text()).toContain('本次送出的檢索式');
    const sent = buildPubMedQuery({
      ingredients: ['Pravastatin', 'Fenofibrate'],
      aeTerms: parseTermList(DEFAULT_LIT_SEARCH.aeTerms),
      exclusions: parseTermList(DEFAULT_LIT_SEARCH.exclusions),
      useMesh: true,
    });
    expect(esearch).toContain(sent);
    expect(db.getLogs()[0].description).toContain(`檢索式 ${sent}；`);

    // No automatic jump: the summary stays visible until the user chooses to go.
    expect(setActiveMode).not.toHaveBeenCalled();
    await ui!.click(ui!.button('前往核閱（新增 2 筆）'));
    expect(setActiveMode).toHaveBeenCalledWith('litReview');
  });

  it('explains a run where everything retrieved is already pending', async () => {
    saveRecords(PENDING_KEY, ['1', '2', '3'].map((p) => ({ id: p, pmid: p, source: 'pubmed', title: p })) as any);
    const ingredients = await mount();
    await type(ingredients, 'Fenofibrate');
    await ui!.click(ui!.button('執行檢索與 AI 評分'));
    await until(() => summary() !== '');
    expect(summary()).toContain('已在待核閱 3 筆（略過）；沒有新文獻需要核閱');
    expect(ui!.button('前往核閱（新增 0 筆）')).toBeUndefined();
  });
});
