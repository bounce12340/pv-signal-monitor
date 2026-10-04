import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { translations, TransKey } from './translations';
import { workZh, workEn } from './work';
import { AE_ISSUE_CODES, AE_CASE_STATUSES, AE_DUPLICATE_REASONS, CLOCK_BASES } from '../services/ae/aeReport';

describe('AE translations', () => {
  it('zh and en have identical key sets', () => {
    expect(Object.keys(translations.en).sort()).toEqual(Object.keys(translations.zh).sort());
  });
  it('no empty values in either language', () => {
    (['zh', 'en'] as const).forEach(lang => {
      Object.entries(translations[lang]).forEach(([k, v]) => expect(v, `${lang}.${k} is empty`).toBeTruthy());
    });
  });
  // 鍵數一致只保證「有翻」，保證不了「翻對語言」：把中文貼進 en 區塊照樣通過上面兩個測試。
  it('no CJK characters in any English value', () => {
    Object.entries(translations.en).forEach(([k, v]) => expect(v, `en.${k} contains CJK text`).not.toMatch(/[一-鿿]/));
  });
  it('carries no leftover strings for the removed local mode', () => {
    expect(Object.keys(translations.zh).filter(k => /local/i.test(k))).toEqual([]);
    expect(Object.entries(translations.zh).filter(([, v]) => /本機試用|本機模式|本機個案/.test(v))).toEqual([]);
    expect(Object.entries(translations.en).filter(([, v]) => /\bdemo\b|local (mode|case)/i.test(v))).toEqual([]);
  });
});

// PV-Link 的 tests/aeReport.test.ts「i18n 動態鍵覆蓋率」，PR #1 搬後端時因為還沒有 i18n 而暫時拿掉。
// UI 以 `ae.issue.<code>`、`ae.status.<value>` 這類動態鍵取字串，型別檢查抓不到漏譯。
describe('dynamic key coverage', () => {
  const has = (key: string) => (['zh', 'en'] as const).every(lang => Boolean(translations[lang][key as TransKey]));
  it.each([
    ['ae.issue', AE_ISSUE_CODES],
    ['ae.status', AE_CASE_STATUSES],
    ['ae.console.dupReason', AE_DUPLICATE_REASONS],
    ['ae.console.basis', CLOCK_BASES],
  ] as const)('every %s.<value> has zh and en text', (prefix, values) => {
    expect(values.filter(v => !has(`${prefix}.${v}`))).toEqual([]);
  });
});

// PV-Link tests/caseWork.test.ts 的雙語鍵完整性，PR #1 搬後端時因為還沒有 i18n 而暫時拿掉。
describe('work board strings', () => {
  it('have complete, non-empty bilingual keys and are part of the AE translations', () => {
    expect(Object.keys(workEn).sort()).toEqual(Object.keys(workZh).sort());
    expect(Object.values(workZh).every(Boolean) && Object.values(workEn).every(Boolean)).toBe(true);
    for (const k of Object.keys(workZh)) expect(translations.en[k as TransKey]).toBe((workEn as any)[k]);
  });
});

describe('submission outcome messages', () => {
  // 「版本衝突」是唯一代表「其實沒送達」的完成狀態。送出就開始跑法定 15 日時鐘，英文使用者若讀不懂，
  // 會以為通報已經送出。
  it('states plainly in English that a conflicted submission was not delivered', () => {
    expect(translations.en['ae.submit.conflict']).toMatch(/not delivered/i);
    expect(translations.zh['ae.submit.conflict']).toContain('尚未送達');
  });
  it('renders the conflict message through t() instead of a hardcoded literal', () => {
    const src = readFileSync(new URL('../components/ae/AEReportMobile.tsx', import.meta.url), 'utf8');
    expect(src).toContain("t('ae.submit.conflict')");
    expect(src).not.toContain('版本衝突');
  });
});
