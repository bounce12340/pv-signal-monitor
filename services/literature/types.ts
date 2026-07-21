// Literature-monitoring domain types, ported from PV-Link
// (bounce12340/PV-Link-Pharmacovigilance-Agent-System, root types.ts).
// Kept alongside the services that use them so this module stays self-contained
// within services/literature/ until the two platforms' layers are unified.

export interface PVInput {
  company_product_names: string[];
  active_ingredients: string[];
  date_window: { from: string; to: string };
  date_logic: 'dp' | 'edat' | 'both';
  ae_strings: string[];
  optional_ae_focus_terms: string[];
  exclusions: string[];
  db_mode: 'insert-only' | 'upsert';
  max_results?: number; // 每次檢索最多取回筆數（分頁上限），預設 100
}

export interface PVRecord {
  id: string;
  source: 'pubmed' | 'web';
  pmid?: string;
  doi?: string;
  title: string;
  authors?: string[];
  journal?: string;
  year?: string;
  dp?: string;
  edat?: string;
  abstract?: string;
  full_text?: string;
  primary_link: string;
  pubmed_url?: string;
  journal_url?: string;
  quality_flags: string[];
  relevance_score: number;
  relevance_reason: string;
  summary_zh?: string;
  conclusion_zh?: string; // 新增：文獻結論摘要
  is_excluded: boolean;
  exclusion_reason?: string;
  pv_data?: PVStructuredData;
  original_search_term?: string;
  cioms_draft?: import('./cioms').CIOMSDraft;
}

export interface PVStructuredData {
  product: string;
  ingredient: string;
  ae_verbatim: string;
  meddra_pt_candidate: string;
  meddra_confidence: number;
  seriousness: string;
  population: string;
  dosage_route: string;
  tto: string;
  outcome: string;
  causality: string;
  completeness: 'Complete' | 'Partial' | 'Missing';
}

export enum WorkflowStep {
  IDLE = "閒置",
  QUERY_GEN = "查詢式生成",
  RSS_FETCH = "RSS 獲取",
  EFETCH_FILTER = "嚴格篩選與去重",
  WEB_SEARCH = "網路來源補強",
  RELEVANCE_SCORING = "PV 相關性評分",
  SUMMARIZATION = "繁中摘要生成",
  PV_EXTRACTION = "結構化抽取",
  DB_EXPORT = "資料庫匯入"
}
