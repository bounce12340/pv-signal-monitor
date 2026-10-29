// 公告 ↔ 監測成分的比對，與「暫停／下市」字樣提示。純函式，前端呼叫；Worker 只存原文。
//
// 比對刻意寬鬆（寧可多列給人看，也不要漏）：
//   • 拉丁字母的詞只要求「詞首」對齊，詞尾不限：theophyllin 能比到 theophylline、
//     pravastatin 能比到 pravastatin sodium；但 phylline 不會比到 theophylline。
//   • 中文、日文沒有空白分詞，直接子字串比對（茶鹼、テオフィリン）。
//   • 大小寫、全形半形、拉丁字母的重音（théophylline）都先正規化。

import type { RegAlert, WatchItem } from './api';

/** Lowercase, NFKC, Latin accents dropped. Japanese dakuten are left alone (NFD would split them). */
export function normalizeText(s: string): string {
  return s.normalize('NFKC').toLowerCase()
    .normalize('NFD').replace(/([a-z])\p{M}+/gu, '$1').normalize('NFC')
    .replace(/\s+/g, ' ').trim();
}

const LATIN = /[a-z]/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `term` occurs in normalized `text` (word-start aligned for Latin terms). */
export function containsTerm(text: string, term: string): boolean {
  const t = normalizeText(term);
  if (t.length < 2) return false;
  if (!LATIN.test(t)) return text.includes(t);
  return new RegExp(`(^|[^a-z0-9])${escapeRe(t)}`).test(text);
}

const alertText = (a: Pick<RegAlert, 'title' | 'summary' | 'substances'>) => normalizeText(`${a.title} ${a.summary} ${a.substances}`);

/** The watchlist ingredients this alert mentions (by name or synonym). */
export function matchAlert(alert: Pick<RegAlert, 'title' | 'summary' | 'substances'>, watchlist: WatchItem[]): string[] {
  const text = alertText(alert);
  return watchlist
    .filter((w) => [w.ingredient, ...w.synonyms].some((term) => containsTerm(text, term)))
    .map((w) => w.ingredient);
}

// 第 6 條第 1 項第 3 款是「因不良反應被暫停使用或下市」。這裡只找字樣提醒人去看，
// 不判斷原因（品質回收也可能出現 withdrawn），所以永遠只是提示、不是結論。
const ACTION_WORDS = [
  'withdrawn', 'withdrawal', 'withdraw', 'suspended', 'suspension', 'suspend', 'revoked', 'revocation',
  'removed from the market', 'marketing authorisation withdrawn',
  'widerruf', 'ruhen der zulassung', 'marktrücknahme', 'rücknahme',
  'retrait', 'suspension d\'amm',
  '販売中止', '承認取消', '使用中止', '販売停止',
  '下市', '暫停', '廢止', '註銷', '撤銷', '停止使用', '停止製造',
];

/** Whether the alert's text mentions suspension or withdrawal (a prompt to assess Art. 6, never a verdict). */
export function mentionsSuspension(alert: Pick<RegAlert, 'title' | 'summary' | 'substances'>): boolean {
  const text = alertText(alert);
  return ACTION_WORDS.some((w) => containsTerm(text, w));
}

/**
 * Parses the watchlist editor: one ingredient per line, synonyms after 「|」,
 * separated by commas (half/full width), 頓號 or semicolons.
 */
export function parseWatchlistText(text: string): WatchItem[] {
  const seen = new Set<string>();
  const out: WatchItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [head, rest = ''] = line.split(/[|｜]/, 2);
    const ingredient = head.trim();
    if (!ingredient || seen.has(ingredient.toLowerCase())) continue;
    seen.add(ingredient.toLowerCase());
    const synonyms = [...new Set(rest.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean))];
    out.push({ ingredient, synonyms });
  }
  return out;
}

export const formatWatchlistText = (items: WatchItem[]) =>
  items.map((w) => (w.synonyms.length ? `${w.ingredient} | ${w.synonyms.join(', ')}` : w.ingredient)).join('\n');
