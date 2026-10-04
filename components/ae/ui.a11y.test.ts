// 無障礙底線的回歸測試（從 PV-Link tests/a11y.test.ts 搬入）。這些斷言守的是會靜默退化的東西：
// 拿掉 aria-labelledby 畫面一模一樣，只有讀屏使用者會突然聽不到欄位名稱。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Field, TextInput, TextArea, ChipGroup, CheckGroup } from './ui';

const OPTIONS = [
  { value: 'm', zh: '男', en: 'Male' },
  { value: 'f', zh: '女', en: 'Female' },
] as const;
const labelId = (html: string) => html.match(/<label id="([^"]+)"/)?.[1];
const attr = (html: string, tag: string, name: string) => html.match(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`))?.[1];
const h = React.createElement;

describe('form accessibility contract', () => {
  it('associates the field label with the input it labels', () => {
    const html = renderToStaticMarkup(h(Field, { label: '病人姓名縮寫' }, h(TextInput, { value: '', onChange: () => {} })));
    expect(labelId(html)).toBeTruthy();
    expect(attr(html, 'input', 'aria-labelledby')).toBe(labelId(html));
  });

  it('points aria-describedby at the hint and marks required fields', () => {
    const html = renderToStaticMarkup(h(Field, { label: '獲知日', required: true, hint: '法定 15 日時鐘的起算日' },
      h(TextInput, { type: 'date', value: '', onChange: () => {} })));
    const hintId = html.match(/<p id="([^"]+)"/)?.[1];
    expect(hintId).toBeTruthy();
    expect(attr(html, 'input', 'aria-describedby')).toBe(hintId);
    expect(attr(html, 'input', 'aria-required')).toBe('true');
  });

  it('lets two controls share one label without colliding ids', () => {
    const html = renderToStaticMarkup(h(Field, { label: '治療期間' }, h('div', null,
      h(TextInput, { type: 'date', value: '', onChange: () => {} }),
      h(TextInput, { type: 'date', value: '', onChange: () => {} }))));
    const refs = [...html.matchAll(/<input[^>]*aria-labelledby="([^"]*)"/g)].map(m => m[1]);
    expect(refs).toEqual([labelId(html), labelId(html)]);
    expect(html).not.toMatch(/<input[^>]*\sid="/);
  });

  it('keeps the caller’s own aria wiring when one is supplied', () => {
    const html = renderToStaticMarkup(h(Field, { label: '不該被用到' },
      h(TextArea, { 'aria-labelledby': 'caller-owned', value: '', onChange: () => {} })));
    expect(attr(html, 'textarea', 'aria-labelledby')).toBe('caller-owned');
  });

  it('groups chips under the field label, on the chip container only', () => {
    const html = renderToStaticMarkup(h(Field, { label: '性別' }, h(ChipGroup, { options: OPTIONS, value: '', onChange: () => {}, lang: 'zh' })));
    expect(html.match(/^<div[^>]*>/)?.[0]).not.toContain('role=');
    expect(html).toContain(`role="group" aria-labelledby="${labelId(html)}"`);
  });

  it('groups checkboxes and hides the decorative tick from assistive tech', () => {
    const html = renderToStaticMarkup(h(Field, { label: '嚴重性準則' }, h(CheckGroup, { options: OPTIONS, values: ['m'], onChange: () => {}, lang: 'zh' })));
    expect(html).toContain(`role="group" aria-labelledby="${labelId(html)}"`);
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/<span aria-hidden="true"/);
  });

  it('does not suppress the focus ring on inputs', () => {
    expect(renderToStaticMarkup(h(TextInput, { value: '', onChange: () => {} }))).not.toContain('outline-none');
  });
});

describe('AE accessibility floor in index.css', () => {
  const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
  const ae = css.slice(css.indexOf('/* ══ AE 畫面'));

  it('defines a two-tone focus-visible ring for every interactive element inside .ae-theme', () => {
    expect(ae).toMatch(/\.ae-theme :is\([^)]*button[^)]*input[^)]*\[role='checkbox'\]\):focus-visible/);
    expect(ae).toMatch(/box-shadow:\s*0 0 0 2px var\(--fv-inner\), 0 0 0 5px var\(--fv-outer\) !important/);
  });

  it('keeps a forced-colors fallback so the ring survives high contrast mode', () => {
    expect(ae).toContain('@media (forced-colors: active)');
    expect(ae).toContain('outline-color: Highlight');
  });

  it('honours prefers-reduced-motion but keeps loading spinners spinning', () => {
    const reduced = ae.slice(ae.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(reduced).toMatch(/\.ae-theme \.animate-spin\s*\{[^}]*animation-iteration-count:\s*infinite/);
  });

  it('tells the browser about dark mode so native controls are drawn light-on-dark', () => {
    expect(ae).toMatch(/\.ae-theme\.dark\s*\{[^}]*color-scheme:\s*dark/);
  });

  it('scopes every AE rule so the host app is untouched', () => {
    // 去掉註解、@theme 區塊與 @custom-variant 後，剩下的每條選擇器都要以 .ae-theme 開頭
    const rules = ae.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@theme(?: inline)? \{[^}]*\}/g, '').replace(/@custom-variant[^;]*;/g, '');
    const selectors = [...rules.matchAll(/(^|[{}])\s*([^\s{}@][^{}]*)\{/g)].map(m => m[2].trim())
      .filter(s => !/^(animation|transition|outline|box-shadow|color-scheme|--|font)/.test(s));
    expect(selectors.length).toBeGreaterThan(3);
    for (const sel of selectors) for (const part of sel.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/^\.ae-theme\b/);
  });
});
