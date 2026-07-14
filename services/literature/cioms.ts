// CIOMS-I / E2B(R3) 草稿產生器。
//
// 由 record.pv_data + 書目資訊「離線」映射出一份可供人工核閱、修訂的個案安全報告草稿。
// 刻意不呼叫 LLM：抽取已在 extractPVData 完成，這裡只做確定性的欄位對映，快速且可重現。
// ⚠️ 產出為草稿骨架，需藥物警戒人員審閱補全後才可提交主管機關。

import { lookupMeddra } from './meddra';

export interface CIOMSDraft {
  // CIOMS-I 表單語意欄位
  reactionOnsetDate: string;
  patientInitials: string;
  ageSex: string;
  suspectDrug: string;
  activeIngredient: string;
  dailyDoseRoute: string;
  reactionVerbatim: string;
  meddraPt: string;
  meddraSoc: string;
  seriousness: string;
  outcome: string;
  causality: string;
  narrative: string;
  literatureReference: string;
  // E2B(R3) 關鍵資料元素對照（data element code → 值）
  e2b: Record<string, string>;
  generatedAt: string;
}

const val = (v: any, dash = 'N/A') => {
  const s = (v == null ? '' : String(v)).trim();
  return s || dash;
};

/** 由一筆 PVRecord 建立 CIOMS 草稿骨架。generatedAt 由呼叫端傳入時間戳（避免測試環境依賴）。 */
export function buildCIOMS(record: any, generatedAt: string = ''): CIOMSDraft {
  const pv = record?.pv_data || {};
  const meddra = lookupMeddra(pv.meddra_pt_candidate);
  const pt = meddra.matched ? meddra.pt : val(pv.meddra_pt_candidate, '');
  const soc = meddra.soc || 'Unclassified (種子詞典未收錄，需人工歸類)';

  const literatureReference = [
    record?.authors?.length ? `${record.authors[0]} et al.` : null,
    val(record?.title, ''),
    val(record?.journal, ''),
    record?.dp ? `(${record.dp})` : null,
    record?.pmid ? `PMID: ${record.pmid}` : null,
  ].filter(Boolean).join('. ');

  const narrative = buildNarrative(record, pv, pt);

  const draft: CIOMSDraft = {
    reactionOnsetDate: val(pv.tto, ''),
    patientInitials: 'N/A (文獻個案)',
    ageSex: val(pv.population, ''),
    suspectDrug: val(pv.product),
    activeIngredient: val(pv.ingredient || record?.original_search_term),
    dailyDoseRoute: val(pv.dosage_route, ''),
    reactionVerbatim: val(pv.ae_verbatim, ''),
    meddraPt: pt || 'N/A',
    meddraSoc: soc,
    seriousness: val(pv.seriousness, ''),
    outcome: val(pv.outcome, ''),
    causality: val(pv.causality, ''),
    narrative,
    literatureReference,
    generatedAt: generatedAt,
    e2b: {
      'C.1.2 (Date of creation)': generatedAt || 'N/A',
      'C.4.r.1 (Literature reference)': literatureReference || 'N/A',
      'D.2 (Age / group)': val(pv.population, ''),
      'E.i.1.1a (Reaction verbatim)': val(pv.ae_verbatim, ''),
      'E.i.2.1b (MedDRA PT)': pt || 'N/A',
      'E.i.3.1 (Seriousness criteria)': val(pv.seriousness, ''),
      'E.i.7 (Outcome)': val(pv.outcome, ''),
      'G.k.2.1.1 (Proprietary product)': val(pv.product),
      'G.k.2.2 (Active substance)': val(pv.ingredient || record?.original_search_term),
      'G.k.4.r (Dosage / route)': val(pv.dosage_route, ''),
      'G.k.9.i.2.r (Causality assessment)': val(pv.causality, ''),
      'H.1 (Case narrative)': narrative,
    },
  };
  return draft;
}

function buildNarrative(record: any, pv: any, pt: string): string {
  const parts: string[] = [];
  const drug = val(pv.ingredient || pv.product || record?.original_search_term, '該藥品');
  const pop = val(pv.population, '一名個案');
  const ae = val(pv.ae_verbatim || pt, '不良事件');
  parts.push(`${pop}於使用 ${drug}（${val(pv.dosage_route, '劑量/途徑未載明')}）後，發生 ${ae}。`);
  if (pt) parts.push(`MedDRA 首選術語(PT)研判為 ${pt}。`);
  if (val(pv.seriousness, '')) parts.push(`嚴重性：${pv.seriousness}。`);
  if (val(pv.tto, '')) parts.push(`發生時間(TTO)：${pv.tto}。`);
  if (val(pv.outcome, '')) parts.push(`結果：${pv.outcome}。`);
  if (val(pv.causality, '')) parts.push(`因果關係研判：${pv.causality}。`);
  if (record?.conclusion_zh) parts.push(`文獻結論：${record.conclusion_zh}`);
  return parts.join(' ');
}

/** 將草稿轉為可複製 / 下載的純文字表單。 */
export function ciomsToText(d: CIOMSDraft): string {
  const line = '─'.repeat(56);
  return [
    'CIOMS-I 個案安全報告草稿（AI 輔助產生，需人工審閱）',
    line,
    `反應發生日期 (Onset)      : ${d.reactionOnsetDate || 'N/A'}`,
    `病患 (Age/Sex)            : ${d.ageSex || 'N/A'}`,
    `懷疑藥品 (Suspect drug)   : ${d.suspectDrug}`,
    `活性成分 (Active substance): ${d.activeIngredient}`,
    `劑量/途徑 (Dose/Route)    : ${d.dailyDoseRoute || 'N/A'}`,
    line,
    `不良反應原文 (Verbatim)   : ${d.reactionVerbatim || 'N/A'}`,
    `MedDRA PT                 : ${d.meddraPt}`,
    `MedDRA SOC                : ${d.meddraSoc}`,
    `嚴重性 (Seriousness)      : ${d.seriousness || 'N/A'}`,
    `結果 (Outcome)            : ${d.outcome || 'N/A'}`,
    `因果關係 (Causality)      : ${d.causality || 'N/A'}`,
    line,
    '個案描述 (Narrative):',
    d.narrative,
    line,
    `文獻出處: ${d.literatureReference || 'N/A'}`,
    d.generatedAt ? `產生時間: ${d.generatedAt}` : '',
    '',
    'E2B(R3) 欄位對照:',
    ...Object.entries(d.e2b).map(([k, v]) => `  ${k}: ${v}`),
  ].filter(l => l !== '').join('\n');
}
