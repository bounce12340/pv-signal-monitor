// Literature-monitoring LLM methods. Transport, batching and JSON repair all
// come from the unified client (services/llm.ts); this file only holds the
// domain-specific prompts (relevance scoring, summaries, PV extraction).
// PubMed retrieval lives in ./pubmed.

import {
  callModel,
  runBatched,
  mapLimit,
  reconcile,
  langDirective,
  type Lang,
  type ProgressFn,
} from '../llm';

// Concurrency for the whole-database structured extraction pass.
const EXTRACT_CONCURRENCY = 3;

export class PVLLMService {
  async scoreRelevance(records: any[], lang: Lang = 'zh', onProgress?: ProgressFn) {
    const slim = records.map((r) => ({ pmid: r.pmid, title: r.title, abstract: r.abstract }));
    try {
      const scored = await runBatched(
        slim,
        async (batch) => {
          const res = await callModel(
            `You are a pharmacovigilance analyst. For each record, evaluate PV relevance (0-100) based on potential adverse events. ` +
              `Return ONLY a JSON object shaped {"items":[{"pmid":string,"score":number,"reason":string}]} with exactly one entry per input pmid. ` +
              `${lang === 'en' ? 'The reason field must be in English.' : 'reason 欄位必須是繁體中文。'} ` +
              `Records: ${JSON.stringify(batch)}`
          );
          const arr = res?.items ?? res;
          return Array.isArray(arr) ? arr : [];
        },
        onProgress
      );
      return reconcile(records, scored, (r) => ({
        pmid: r.pmid,
        score: 50,
        reason:
          lang === 'en'
            ? 'AI returned no score for this record; conservative default applied'
            : 'AI 未回傳此筆評分，暫給保守分數',
      }));
    } catch {
      return records.map((r) => ({
        pmid: r.pmid,
        score: 50,
        reason: lang === 'en' ? 'AI scoring temporarily unavailable' : 'AI 評分暫時無法使用',
      }));
    }
  }

  async generateSummaries(records: any[], lang: Lang = 'zh', onProgress?: ProgressFn) {
    const slim = records.map((r) => ({ pmid: r.pmid, title: r.title, abstract: r.abstract }));
    try {
      const summarized = await runBatched(
        slim,
        async (batch) => {
          const res = await callModel(
            `請將以下文獻進行專業藥物警戒(PV)分析。回傳格式必須是 JSON 物件 {"items":[{"pmid":string,"summary_zh":string,"conclusion_zh":string}]}，每個輸入 pmid 對應一筆：\n` +
              `- summary_zh: 摘要，重點放在病例描述或研究方法。\n` +
              `- conclusion_zh: 獨立提煉該文獻的「結論」或「臨床建議」（對藥物安全監測最重要）。\n` +
              `${langDirective(lang)}\n` +
              `只輸出 JSON，不要多餘文字。文獻資料： ${JSON.stringify(batch)}`
          );
          const arr = res?.items ?? res;
          return Array.isArray(arr) ? arr : [];
        },
        onProgress
      );
      return reconcile(records, summarized, (r) => ({
        pmid: r.pmid,
        summary_zh: lang === 'en' ? '(AI returned no summary for this record)' : '（AI 未回傳此筆摘要）',
        conclusion_zh:
          lang === 'en' ? 'AI returned no conclusion for this record' : 'AI 未回傳此筆結論',
      }));
    } catch {
      return records.map((r) => ({
        pmid: r.pmid,
        summary_zh: lang === 'en' ? 'Summary generation failed' : '摘要生成失敗',
        conclusion_zh: lang === 'en' ? 'Pending re-analysis' : '待重新分析',
      }));
    }
  }

  /** Structured-extract many records in parallel (for pre-aggregation batch runs).
   *  Returns [{ id, pv_data }] in input order; a failed record gets a Missing skeleton. */
  async extractPVDataBatch(
    records: any[],
    lang: Lang = 'zh',
    onProgress?: ProgressFn
  ): Promise<{ id: string; pv_data: any }[]> {
    let done = 0;
    return mapLimit(records, EXTRACT_CONCURRENCY, async (rec) => {
      const pv_data = await this.extractPVData(rec, lang);
      done++;
      onProgress?.(done, records.length);
      return { id: rec.id, pv_data };
    });
  }

  async extractPVData(record: any, lang: Lang = 'zh') {
    try {
      const data = await callModel(
        `從以下內容抽取結構化 PV 數據，只回傳 JSON 物件，鍵為：` +
          `product, ingredient, ae_verbatim, meddra_pt_candidate, meddra_confidence(0-100 數字), seriousness, population, dosage_route, tto, outcome, causality, completeness(Complete|Partial|Missing)。\n` +
          `${langDirective(lang)}\n` +
          `內容：${record.summary || record.abstract || record.title}`
      );
      return data || { product: 'N/A', completeness: 'Missing' };
    } catch {
      return { product: 'N/A', completeness: 'Missing' };
    }
  }
}
