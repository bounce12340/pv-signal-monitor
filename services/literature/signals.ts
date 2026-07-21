// 訊號聚合：把正式庫依「(成分 × MedDRA PT)」分組計數，估算潛在安全訊號。
//
// 純前端聚合，不呼叫任何 API。僅涵蓋已完成結構化抽取(pv_data)的文獻；
// 未抽取者會回報在 skipped，提示使用者先做批次抽取。

import { lookupMeddra } from './meddra';

export interface SignalGroup {
  ingredient: string;
  pt: string;           // 標準化後的 MedDRA PT（命中種子詞典時）或原始候選詞
  soc: string;          // 對應 SOC，未歸類為 'Unclassified'
  count: number;        // 該組合的文獻數
  seriousCount: number; // 其中判定為嚴重的筆數
  matched: boolean;     // PT 是否命中種子詞典
  pmids: string[];
}

export interface SignalReport {
  groups: SignalGroup[]; // 依 count 由多到少排序
  totalRecords: number;
  analysedRecords: number; // 有 pv_data 且有 AE/PT 的筆數
  skipped: number;         // 缺 pv_data 或無 PT/AE，無法納入聚合的筆數
}

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

// 判定是否「嚴重」：seriousness 欄位含關鍵字即視為嚴重個案。
function isSerious(seriousness: any): boolean {
  const s = norm(String(seriousness || ''));
  if (!s) return false;
  // 負向優先：含否定語意（not / non-serious / 否 / 無…）一律判為非嚴重，避免 "not hospitalized" 被正向規則誤命中
  if (/(non-?serious|\bnot\b|\bno\b|否|無)/.test(s)) return false;
  return /(serious|死亡|death|life[- ]?threatening|危及生命|住院|hospitali|disab|殘|嚴重|先天|congenital)/.test(s);
}

export function aggregateSignals(records: any[]): SignalReport {
  const map = new Map<string, SignalGroup>();
  let analysed = 0;
  let skipped = 0;

  for (const r of records || []) {
    const pv = r?.pv_data;
    const rawPt = pv?.meddra_pt_candidate || pv?.ae_verbatim || '';
    const ingredient = (pv?.ingredient || r?.original_search_term || '').trim();
    if (!pv || !rawPt.trim() || !ingredient) { skipped++; continue; }

    const look = lookupMeddra(rawPt);
    const pt = look.matched ? look.pt : rawPt.trim();
    const soc = look.soc || 'Unclassified';
    const key = `${norm(ingredient)}||${norm(pt)}`;

    let g = map.get(key);
    if (!g) {
      g = { ingredient, pt, soc, count: 0, seriousCount: 0, matched: look.matched, pmids: [] };
      map.set(key, g);
    }
    g.count++;
    if (isSerious(pv.seriousness)) g.seriousCount++;
    if (r.pmid && !g.pmids.includes(r.pmid)) g.pmids.push(r.pmid);
    analysed++;
  }

  const groups = [...map.values()].sort(
    (a, b) => b.count - a.count || b.seriousCount - a.seriousCount
  );

  return { groups, totalRecords: (records || []).length, analysedRecords: analysed, skipped };
}
