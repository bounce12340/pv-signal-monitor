// @vitest-environment jsdom
// 季度監測頁一律用「目前選的產品」已存的主檔分析，不論從哪裡進來。
// 回歸：從監測總覽點產品進來時只帶 selectedProductId，「執行訊號分析」按不下去；
// 若之前看過別的產品，則會拿上一個產品的主檔分析。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render } from './ae/testRender';
import { db } from '../services/db';
import { MonitorMode } from './MonitorMode';
import type { ExtractedMaster } from '../types';

const master = (name: string, term: string): ExtractedMaster => ({
  product_name: name,
  label_version_date: '2026-01-01',
  ae_master: [{
    soc: 'Gastrointestinal disorders', ae_term_raw: term, ae_terms_split: [term],
    label_frequency_text: 'common', label_threshold_upper_pct: 10, mapping_rule_note: '',
  }],
});

let ui: Awaited<ReturnType<typeof render>> | null = null;
let idA = '';
let idB = '';

beforeEach(() => {
  vi.stubGlobal('indexedDB', undefined);
  localStorage.clear();
  // Fictional products, saved through the same path the 主檔產生 page uses.
  idA = db.saveExtractedMaster(master('Test Product A', 'Nausea'));
  idB = db.saveExtractedMaster(master('Test Product B', 'Oesophageal ulcer'));
});
afterEach(() => { ui?.unmount(); ui = null; vi.unstubAllGlobals(); });

async function mount(selectedProductId: string, setSelectedProductId = vi.fn()) {
  ui = await render(React.createElement(MonitorMode, {
    savedProducts: db.getProducts(),
    selectedProductId,
    setSelectedProductId,
    setDbUpdateTrigger: vi.fn(),
    setActiveMode: vi.fn(),
  }));
  return ui;
}
const runButton = () => ui!.button('執行訊號分析') as HTMLButtonElement | undefined;
const masterTerms = () => [...ui!.host.querySelectorAll('button')]
  .map((b) => b.textContent?.trim() || '')
  .filter((t) => t.startsWith('+ '));

describe('MonitorMode master selection', () => {
  it('enables the analysis when the product arrives preselected (監測總覽 link)', async () => {
    await mount(idB);
    expect(runButton()).toBeDefined();
    expect(runButton()!.disabled).toBe(false);
    expect(masterTerms()).toEqual(['+ Oesophageal ulcer']);
  });

  it('never analyses against another product\'s master', async () => {
    await mount(idA);
    expect(masterTerms()).toEqual(['+ Nausea']);
    ui!.unmount();
    await mount(idB);
    expect(masterTerms()).toEqual(['+ Oesophageal ulcer']);
  });

  it('keeps the button disabled with no product, or one that no longer exists', async () => {
    await mount('');
    expect(runButton()!.disabled).toBe(true);
    ui!.unmount();
    await mount('deleted-product-id');
    expect(runButton()!.disabled).toBe(true);
    expect(masterTerms()).toEqual([]);
  });

  it('still reports a dropdown choice to the app', async () => {
    const setSelected = vi.fn();
    await mount('', setSelected);
    const select = ui!.host.querySelector('select')!;
    await act(async () => {
      select.value = idA;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setSelected).toHaveBeenCalledWith(idA);
  });
});
