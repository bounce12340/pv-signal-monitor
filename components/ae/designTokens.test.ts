// 設計 token 的守門測試（從 PV-Link tests/designTokens.test.ts 搬入，範圍限定在 AE 畫面）。
// 規則都來自 PV-Link 用 axe color-contrast 實測 15 個畫面的結果：修正前亮色 112 處、暗色 113 處對比不足。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const UI_FILES = [
  ...readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.tsx') && !f.includes('.test.')).map(f => `components/ae/${f}`),
  'theme/ThemeContext.tsx',
];
const sources = UI_FILES.map(f => ({ f, s: read(f) }));
const css = read('index.css');

function offenders(pattern: RegExp) {
  const out: string[] = [];
  for (const { f, s } of sources) {
    s.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(new RegExp(pattern.source, 'g'))) out.push(`${f}:${i + 1} ${m[0]}`);
    });
  }
  return out;
}

// WCAG 2.x 相對亮度與對比
const lum = (hex: string) => {
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgbVar = (scope: string, name: string) => {
  const block = css.match(new RegExp(`${scope.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'g'))?.find(b => b.includes(`--${name}:`));
  const m = block?.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!m) throw new Error(`index.css 找不到 ${scope} 的 --${name}`);
  return m.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('');
};

describe('AE colour tokens', () => {
  it('covers the AE screens', () => {
    expect(UI_FILES).toEqual(expect.arrayContaining(['components/ae/AEReportMobile.tsx', 'components/ae/ProfileSetup.tsx', 'components/ae/ui.tsx']));
  });

  it('uses only semantic colour names (and slate as the one neutral)', () => {
    const raw = offenders(/(?<![\w-])(?:[\w-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|from|to|via|divide|fill|stroke|outline|placeholder|accent|decoration|caret|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray|zinc|neutral|stone)-\d{2,3}\b/);
    expect(raw).toEqual([]);
  });

  it('keeps raw hex colours out of class names', () => {
    expect(offenders(/(?:bg|text|border|from|to|via|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/)).toEqual([]);
  });

  it('defines muted text that passes 4.5:1 on every surface it was measured on', () => {
    for (const bg of ['ffffff', rgbVar('.ae-theme', 'canvas'), 'f1f5fd', 'eef2ff', 'f1f5f9']) {
      expect(contrast(rgbVar('.ae-theme', 'muted'), bg)).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of [rgbVar('.ae-theme.dark', 'canvas'), '1e293b', '34385c', '3a4257', '433c51']) {
      expect(contrast(rgbVar('.ae-theme.dark', 'muted'), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('writes secondary text with the muted token rather than light slate shades', () => {
    expect(offenders(/(?<![\w:/-])text-slate-(?:300|400|500)(?![\w/-])/)).toEqual([]);
  });

  it('keeps light-mode semantic text at a shade that is readable on tinted surfaces', () => {
    expect(offenders(/(?<![\w:/-])text-(?:success-(?:[1-6]00|50)|caution-(?:[1-7]00|50)|danger-(?:[1-6]00|50)|brand-(?:[1-5]00|50))(?![\w/-])/)).toEqual([]);
  });

  it('keeps dark-mode semantic text bright enough for lifted dark panels', () => {
    expect(offenders(/(?<![\w/-])dark:text-(?:brand|danger)-(?:[4-9]00|950)(?![\w/-])/)).toEqual([]);
  });

  it('never puts white text on success or caution fills lighter than 700', () => {
    const bad: string[] = [];
    for (const { f, s } of sources) {
      for (const m of s.matchAll(/(['"`])((?:(?!\1)[^\n])*)\1/g)) {
        if (/(?<![\w:-])text-white\b/.test(m[2]) && /(?<![\w:/-])bg-(?:success|caution)-(?:[1-6]00|50)\b/.test(m[2])) bad.push(`${f}: ${m[2].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives the AE scope the canvas background so dark mode never shows a light page', () => {
    expect(read('theme/ThemeContext.tsx')).toMatch(/className=\{`ae-theme[^`]*\bbg-canvas\b/);
  });

  it('maps AE brand to indigo inside .ae-theme only (sky-600 fails 4.5:1 on white)', () => {
    expect(css).toMatch(/\.ae-theme \{[^}]*--color-brand-600: var\(--color-indigo-600\)/);
  });
});

describe('AE type tokens', () => {
  it('never sets text below 12px', () => {
    expect(offenders(/text-\[(?:\d|1[01])(?:\.\d+)?px\]|text-\[0?\.(?:[0-6]\d*|7[0-4]\d*)rem\]/)).toEqual([]);
  });

  it('does not decorate labels with all-caps or wide tracking', () => {
    expect(offenders(/(?<![\w:-])(?:uppercase|tracking-widest|tracking-wider)(?![\w-])/)).toEqual([]);
  });

  it('caps 12px text at bold', () => {
    const bad: string[] = [];
    for (const { f, s } of sources) {
      for (const m of s.matchAll(/(['"`])((?:(?!\1)[^\n])*)\1/g)) {
        const t = m[2].split(/\s+/);
        if (t.includes('text-xs') && t.includes('font-black') && !t.some(x => /^(?:sm|md|lg|xl):text-/.test(x))) bad.push(`${f}: ${m[2].slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('uses system fonts with Traditional Chinese faces listed explicitly, and loads no web fonts', () => {
    expect(css).toMatch(/\.ae-theme \{[^}]*--font-sans:[^;]*"PingFang TC"[^;]*"Microsoft JhengHei"/);
    expect(read('index.html')).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});
