
// Provider 無關的 LLM 服務：所有推論走 OpenAI 相容的 Chat Completions 介面，
// 因此 OpenAI 官方、Azure OpenAI、Ollama、OpenRouter、Kimi 等任何 OpenAI-compatible
// 端點都能接，只靠環境變數切換。
//
// 兩種執行模式：
//   1) 有設定 VITE_PV_PROXY_ENDPOINT → 前端只把 prompt 送給後端 proxy，金鑰留在後端（公開/多人用）。
//   2) 未設定 → 前端直連 VITE_LLM_BASE_URL（僅供本機開發，金鑰會進前端）。
const env = (import.meta as any).env || {};
const PROXY_ENDPOINT: string = env.VITE_PV_PROXY_ENDPOINT || '';
const LLM_BASE_URL: string = (env.VITE_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const LLM_API_KEY: string = env.VITE_LLM_API_KEY || '';
const LLM_MODEL: string = env.VITE_LLM_MODEL || 'gpt-4o-mini';
// 部分 OpenAI 相容服務（某些 Ollama/OpenRouter 模型）不支援 response_format，
// 設 VITE_LLM_JSON_MODE=0 可關閉，改由 parseJsonLoose 容錯解析。
const JSON_MODE: boolean = env.VITE_LLM_JSON_MODE !== '0';

// NCBI E-utilities API key（可選）。設定後可放寬速率限制至 10 req/s。
const NCBI_API_KEY: string = env.VITE_NCBI_API_KEY || '';

// 評分/摘要每批文獻數上限，避免單一 prompt 超出 token 上限或漏 pmid。
const BATCH_SIZE = 8;
// 同時進行的批次數上限。並行可大幅縮短總時間，但過高會壓垮上游/觸發速率限制。
const BATCH_CONCURRENCY = 3;
// 單次結構化抽取的並行度（批次抽取整庫用）。
const EXTRACT_CONCURRENCY = 3;
// efetch 單次拉取的 PMID 數上限（分頁抓取用）。
const EFETCH_CHUNK = 100;

/** 進度回呼：done / total 為「已處理 / 總數」。 */
export type ProgressFn = (done: number, total: number) => void;

/** AI 產出語言。 */
export type Lang = 'zh' | 'en';

/** 依語言插入 prompt 的輸出語言指示。 */
const langDirective = (lang: Lang) =>
  lang === 'en'
    ? 'Respond in English. summary and conclusion fields must be in English.'
    : '請以繁體中文回答。summary 與 conclusion 欄位必須是繁體中文。';

/** 併發上限的 map：最多 limit 個工作同時進行，回傳順序與輸入一致。 */
async function mapLimit<A, B>(items: A[], limit: number, fn: (item: A, index: number) => Promise<B>): Promise<B[]> {
  const results: B[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export class PVLLMService {
  /**
   * 統一的 LLM 呼叫入口，回傳解析後的 JSON。
   * 有 PROXY_ENDPOINT → 走後端；否則本機直連 OpenAI 相容端點。
   */
  private async callModel(prompt: string): Promise<any> {
    const raw = PROXY_ENDPOINT ? await this.viaProxy(prompt) : await this.viaDirect(prompt);
    return parseJsonLoose(raw);
  }

  private async viaProxy(prompt: string): Promise<string> {
    // 同源部署 + Cloudflare Access：登入後的 CF_Authorization cookie 隨同源請求自動帶上，
    // 前端不再需要持有任何密鑰。
    const res = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error(`Proxy 回應 ${res.status}`);
    const data = await res.json();
    return data.content ?? '';
  }

  private async viaDirect(prompt: string): Promise<string> {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {})
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        ...(JSON_MODE ? { response_format: { type: 'json_object' } } : {})
      })
    });
    if (!res.ok) throw new Error(`LLM 端點回應 ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  /** 將 items 切成固定大小的批次「並行」處理（併發上限 BATCH_CONCURRENCY），回傳攤平後的結果。
   *  單一批次失敗不影響其他批次；缺漏的 pmid 由上層 reconcile 補上。
   *  onProgress 於每批完成後回報累計處理筆數。 */
  private async runBatched<T>(items: any[], fn: (batch: any[]) => Promise<T[]>, onProgress?: ProgressFn): Promise<T[]> {
    const batches: any[][] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) batches.push(items.slice(i, i + BATCH_SIZE));
    let done = 0;
    const perBatch = await mapLimit(batches, BATCH_CONCURRENCY, async (batch) => {
      try {
        return await fn(batch);
      } catch {
        return [] as T[]; // 該批失敗，reconcile 會以 fallback 補齊
      } finally {
        done += batch.length;
        onProgress?.(Math.min(done, items.length), items.length);
      }
    });
    return perBatch.flat();
  }

  private ncbiFetch(url: string): Promise<Response> {
    return fetch(NCBI_API_KEY ? `${url}&api_key=${NCBI_API_KEY}` : url);
  }

  private ncbiPause() {
    // NCBI 建議：無金鑰 3 req/s、有金鑰 10 req/s。呼叫間補最小間隔。
    return new Promise(r => setTimeout(r, NCBI_API_KEY ? 110 : 350));
  }

  /**
   * 使用 NCBI E-utilities API 進行精確且一致的 PubMed 搜尋。
   * maxResults：最多取回的文獻數（分頁；預設 100，可依需求調高）。
   */
  async performPubMedSearch(query: string, ingredient: string, dateWindow: { from: string, to: string }, maxResults = 100) {
    // 1. 使用 esearch 取得 PMIDs（一次取回至多 maxResults 筆）
    const minDate = dateWindow.from.replace(/-/g, '/');
    const maxDate = dateWindow.to.replace(/-/g, '/');
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&mindate=${minDate}&maxdate=${maxDate}&datetype=pdat&retmode=json&retmax=${maxResults}`;

    const searchRes = await this.ncbiFetch(searchUrl);
    if (!searchRes.ok) throw new Error(`PubMed esearch 失敗 (HTTP ${searchRes.status})`);
    const searchData = await searchRes.json();
    const pmids: string[] = searchData.esearchresult?.idlist || [];
    if (pmids.length === 0) return [];

    // 2. efetch 分頁抓取：PMID 過多時切成多批（每批 EFETCH_CHUNK 筆），逐批補速率間隔
    const results: any[] = [];
    for (let start = 0; start < pmids.length; start += EFETCH_CHUNK) {
      const chunk = pmids.slice(start, start + EFETCH_CHUNK);
      await this.ncbiPause();
      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${chunk.join(',')}&retmode=xml`;
      const fetchRes = await this.ncbiFetch(fetchUrl);
      if (!fetchRes.ok) throw new Error(`PubMed efetch 失敗 (HTTP ${fetchRes.status})`);
      const xmlText = await fetchRes.text();
      results.push(...this.parseArticles(xmlText));
    }
    return results;
  }

  /** 解析 efetch 回傳的 XML，抽出文獻欄位。 */
  private parseArticles(xmlText: string): any[] {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
      throw new Error("PubMed 回傳的 XML 無法解析");
    }
    const articles = xmlDoc.getElementsByTagName("PubmedArticle");

    const results = [];
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const pmid = article.querySelector("PMID")?.textContent?.trim();
      const title = article.querySelector("ArticleTitle")?.textContent?.trim();

      // 組合摘要（有些摘要會分段，保留 label 讓段落更清楚）
      const abstractTexts = article.getElementsByTagName("AbstractText");
      let abstract = "";
      for (let j = 0; j < abstractTexts.length; j++) {
        const label = abstractTexts[j].getAttribute("Label");
        const text = abstractTexts[j].textContent?.trim() || "";
        abstract += (label ? `${label}: ` : "") + text + " ";
      }

      // 期刊名：明確取 Journal > Title，避免抓到 MeSH 等其他 <Title>
      const journal = article.querySelector("Journal > Title")?.textContent?.trim()
        || article.querySelector("MedlineJournalInfo > MedlineTA")?.textContent?.trim()
        || "";

      const date = extractPubDate(article);

      if (pmid && title) {
        results.push({
          pmid,
          title,
          date,
          journal,
          summary: abstract.trim(),
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
        });
      }
    }
    return results;
  }

  async scoreRelevance(records: any[], lang: Lang = 'zh', onProgress?: ProgressFn) {
    const slim = records.map(r => ({ pmid: r.pmid, title: r.title, abstract: r.abstract }));
    try {
      const scored = await this.runBatched(slim, async (batch) => {
        const res = await this.callModel(
          `You are a pharmacovigilance analyst. For each record, evaluate PV relevance (0-100) based on potential adverse events. ` +
          `Return ONLY a JSON object shaped {"items":[{"pmid":string,"score":number,"reason":string}]} with exactly one entry per input pmid. ` +
          `${lang === 'en' ? 'The reason field must be in English.' : 'reason 欄位必須是繁體中文。'} ` +
          `Records: ${JSON.stringify(batch)}`
        );
        const arr = res?.items ?? res;
        return Array.isArray(arr) ? arr : [];
      }, onProgress);
      return reconcile(records, scored, (r) => ({ pmid: r.pmid, score: 50, reason: lang === 'en' ? 'AI returned no score for this record; conservative default applied' : 'AI 未回傳此筆評分，暫給保守分數' }));
    } catch (e) {
      return records.map(r => ({ pmid: r.pmid, score: 50, reason: lang === 'en' ? 'AI scoring temporarily unavailable' : 'AI 評分暫時無法使用' }));
    }
  }

  async generateSummaries(records: any[], lang: Lang = 'zh', onProgress?: ProgressFn) {
    const slim = records.map(r => ({ pmid: r.pmid, title: r.title, abstract: r.abstract }));
    try {
      const summarized = await this.runBatched(slim, async (batch) => {
        const res = await this.callModel(
          `請將以下文獻進行專業藥物警戒(PV)分析。回傳格式必須是 JSON 物件 {"items":[{"pmid":string,"summary_zh":string,"conclusion_zh":string}]}，每個輸入 pmid 對應一筆：\n` +
          `- summary_zh: 摘要，重點放在病例描述或研究方法。\n` +
          `- conclusion_zh: 獨立提煉該文獻的「結論」或「臨床建議」（對藥物安全監測最重要）。\n` +
          `${langDirective(lang)}\n` +
          `只輸出 JSON，不要多餘文字。文獻資料： ${JSON.stringify(batch)}`
        );
        const arr = res?.items ?? res;
        return Array.isArray(arr) ? arr : [];
      }, onProgress);
      return reconcile(records, summarized, (r) => ({ pmid: r.pmid, summary_zh: lang === 'en' ? '(AI returned no summary for this record)' : '（AI 未回傳此筆摘要）', conclusion_zh: lang === 'en' ? 'AI returned no conclusion for this record' : 'AI 未回傳此筆結論' }));
    } catch (e) {
      return records.map(r => ({ pmid: r.pmid, summary_zh: lang === 'en' ? 'Summary generation failed' : '摘要生成失敗', conclusion_zh: lang === 'en' ? 'Pending re-analysis' : '待重新分析' }));
    }
  }

  /** 並行對多筆文獻做結構化抽取（供訊號聚合前的整庫批次抽取用）。
   *  回傳 [{ id, pv_data }]，順序與輸入一致；單筆失敗以 Missing 骨架補上。 */
  async extractPVDataBatch(records: any[], lang: Lang = 'zh', onProgress?: ProgressFn): Promise<{ id: string, pv_data: any }[]> {
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
      const data = await this.callModel(
        `從以下內容抽取結構化 PV 數據，只回傳 JSON 物件，鍵為：` +
        `product, ingredient, ae_verbatim, meddra_pt_candidate, meddra_confidence(0-100 數字), seriousness, population, dosage_route, tto, outcome, causality, completeness(Complete|Partial|Missing)。\n` +
        `${langDirective(lang)}\n` +
        `內容：${record.summary || record.abstract || record.title}`
      );
      return data || { product: "N/A", completeness: "Missing" };
    } catch (e) {
      return { product: "N/A", completeness: "Missing" };
    }
  }
}

/** 從 PubmedArticle 節點解析出版日期，處理 MedlineDate / Season / 數字或英文月份 / 缺日等情況。 */
function extractPubDate(article: Element): string {
  const pubDate = article.querySelector("Article JournalIssue PubDate") || article.querySelector("PubDate");
  if (!pubDate) return "";

  // MedlineDate 例如 "2025 Jan-Feb" 或 "2025 Spring"：只可靠取到年份。
  const medline = pubDate.querySelector("MedlineDate")?.textContent?.trim();
  if (medline) {
    const y = medline.match(/\d{4}/)?.[0];
    return y ? `${y}-01-01` : "";
  }

  const year = pubDate.querySelector("Year")?.textContent?.trim();
  if (!year) return "";
  const monthRaw = pubDate.querySelector("Month")?.textContent?.trim() || "01";
  const dayRaw = pubDate.querySelector("Day")?.textContent?.trim() || "01";

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const month = monthMap[monthRaw.slice(0, 3).toLowerCase()]
    || (/^\d{1,2}$/.test(monthRaw) ? monthRaw.padStart(2, '0') : '01');
  const day = /^\d{1,2}$/.test(dayRaw) ? dayRaw.padStart(2, '0') : '01';

  return `${year}-${month}-${day}`;
}

/** 確保輸出涵蓋每一筆輸入（依 pmid 對映），缺漏者以 fallback 補上，不靜默丟失。 */
export function reconcile(records: any[], results: any[], fallback: (r: any) => any): any[] {
  const byPmid = new Map(results.filter(x => x && x.pmid != null).map(x => [String(x.pmid), x]));
  return records.map(r => byPmid.get(String(r.pmid)) || fallback(r));
}

/** 寬鬆解析 LLM 回傳：去除可能的 ```json 圍欄與前後雜訊。 */
export function parseJsonLoose(raw: string): any {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    // 退而求其次：擷取第一個 { 或 [ 到對應結尾
    const start = s.search(/[{[]/);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    return null;
  }
}
