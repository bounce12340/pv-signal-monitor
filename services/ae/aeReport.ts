// 不良反應（AE / ADR）個案通報領域模型。
//
// 欄位以 **CIOMS Form I "Suspect Adverse Reaction Report"** 為骨架（欄號註記於各欄位後），
// 並補上《嚴重藥物不良反應通報辦法》要求的本地欄位（通報者服務單位、獲知日、批號等），
// 以及 ICH E2B(R3) 的資料元素對照，讓同一份個案可同時產出：
//   1) 業務端手機通報 → 2) 後台審核 → 3) CIOMS-I 紙本 / E2B(R3) 電子送件。
//
// 本檔刻意維持「純函式 + 純資料」：不碰 DOM、不呼叫 API、不依賴 React，
// 所有判定（效度、嚴重性、法定時限、重複個案）都可單元測試且可重現。

// ─────────────────────────────────────────────────────────────
// 列舉與選項
// ─────────────────────────────────────────────────────────────

/** 個案在後台的處理狀態機。業務端只會產生 submitted；其餘由藥安人員推進。 */
export type AECaseStatus =
  | 'draft'      // 業務端本機草稿，尚未送出
  | 'submitted'  // 已送達後台，待收案
  | 'triage'     // 收案中：效度／嚴重性／預期性判定
  | 'follow_up'  // 資料不全，等待業務或原始通報者補件
  | 'coded'      // 已完成 MedDRA 編碼與因果關係評估
  | 'ready'      // 待送主管機關
  | 'reported'   // 已送出並取得回執
  | 'closed'     // 結案
  | 'invalid';   // 不成案（四要素不全且無法補齊／重複個案）

/** 全部狀態值。i18n 需為每個狀態備妥 `ae.status.<value>` 字串（由單元測試把關）。 */
export const AE_CASE_STATUSES: AECaseStatus[] = [
  'draft', 'submitted', 'triage', 'follow_up', 'coded', 'ready', 'reported', 'closed', 'invalid',
];

/** 後台可手動推進的主流程（不含 draft 與 invalid，那兩者由專用按鈕切換）。 */
export const AE_CASE_STATUS_FLOW: AECaseStatus[] = [
  'submitted', 'triage', 'follow_up', 'coded', 'ready', 'reported', 'closed',
];

/**
 * 嚴重性準則。前六項對應《嚴重藥物不良反應通報辦法》所定之嚴重不良反應情形，
 * 同時也是 CIOMS Form I 第 I 節的勾選框（PATIENT DIED / LIFE THREATENING / ...）。
 * 只要勾選任一項，即屬「嚴重」，觸發 15 日快速通報時鐘。
 */
export const SERIOUSNESS_CRITERIA = [
  { value: 'death', zh: '死亡', en: 'Patient died', e2b: 'E.i.3.2a' },
  { value: 'life_threatening', zh: '危及生命', en: 'Life threatening', e2b: 'E.i.3.2b' },
  { value: 'hospitalization', zh: '住院或延長住院期間', en: 'Involved or prolonged inpatient hospitalisation', e2b: 'E.i.3.2c' },
  { value: 'disability', zh: '永久性殘疾或失能', en: 'Involved persistence or significant disability/incapacity', e2b: 'E.i.3.2d' },
  { value: 'congenital_anomaly', zh: '胎兒或嬰兒先天性畸形', en: 'Congenital anomaly/birth defect', e2b: 'E.i.3.2e' },
  { value: 'other_medically_important', zh: '其他可能導致永久性傷害之併發症／具醫學重要性', en: 'Other medically important condition', e2b: 'E.i.3.2f' },
] as const;

export type SeriousnessCriterion = typeof SERIOUSNESS_CRITERIA[number]['value'];

/** 不良反應結果（E2B E.i.7 Outcome of reaction at the time of last observation）。 */
export const OUTCOME_OPTIONS = [
  { value: 'recovered', zh: '已復原', en: 'Recovered/Resolved' },
  { value: 'recovering', zh: '復原中', en: 'Recovering/Resolving' },
  { value: 'not_recovered', zh: '未復原', en: 'Not recovered/Not resolved' },
  { value: 'recovered_with_sequelae', zh: '復原但留有後遺症', en: 'Recovered with sequelae' },
  { value: 'fatal', zh: '死亡', en: 'Fatal' },
  { value: 'unknown', zh: '不明', en: 'Unknown' },
] as const;

/** 給藥途徑（CIOMS 16 / E2B G.k.4.r.10）。取臨床最常見者，另留「其他」自填。 */
export const ROUTE_OPTIONS = [
  { value: 'oral', zh: '口服', en: 'Oral' },
  { value: 'intravenous', zh: '靜脈注射', en: 'Intravenous' },
  { value: 'intramuscular', zh: '肌肉注射', en: 'Intramuscular' },
  { value: 'subcutaneous', zh: '皮下注射', en: 'Subcutaneous' },
  { value: 'topical', zh: '外用／局部', en: 'Topical' },
  { value: 'inhalation', zh: '吸入', en: 'Inhalation' },
  { value: 'ophthalmic', zh: '眼用', en: 'Ophthalmic' },
  { value: 'rectal', zh: '直腸', en: 'Rectal' },
  { value: 'transdermal', zh: '經皮貼片', en: 'Transdermal' },
  { value: 'other', zh: '其他', en: 'Other' },
  { value: 'unknown', zh: '不明', en: 'Unknown' },
] as const;

/** 通報來源（CIOMS 24d REPORT SOURCE）。決定個案的資料品質權重與後續追蹤方式。 */
export const REPORT_SOURCE_OPTIONS = [
  { value: 'health_professional', zh: '醫療專業人員（醫師／藥師／護理師）', en: 'Health professional' },
  { value: 'consumer', zh: '消費者／病人本人或家屬', en: 'Consumer/Patient' },
  { value: 'literature', zh: '文獻', en: 'Literature' },
  { value: 'study', zh: '研究／臨床試驗', en: 'Study' },
  { value: 'regulatory', zh: '主管機關轉知', en: 'Regulatory authority' },
  { value: 'other', zh: '其他', en: 'Other' },
] as const;

/** 是／否／不明／不適用。CIOMS 20、21 的去除用藥與再投與挑戰皆用此組。 */
export const YES_NO_UNK_OPTIONS = [
  { value: 'yes', zh: '是', en: 'Yes' },
  { value: 'no', zh: '否', en: 'No' },
  { value: 'unknown', zh: '不明', en: 'Unknown' },
  { value: 'na', zh: '不適用', en: 'N/A' },
] as const;

export type YesNoUnk = typeof YES_NO_UNK_OPTIONS[number]['value'];

/** 對懷疑藥品採取的措施（E2B G.k.8 Action taken with drug）。 */
export const ACTION_TAKEN_OPTIONS = [
  { value: 'withdrawn', zh: '停藥', en: 'Drug withdrawn' },
  { value: 'dose_reduced', zh: '減量', en: 'Dose reduced' },
  { value: 'dose_increased', zh: '增量', en: 'Dose increased' },
  { value: 'unchanged', zh: '劑量不變', en: 'Dose not changed' },
  { value: 'unknown', zh: '不明', en: 'Unknown' },
  { value: 'na', zh: '不適用', en: 'Not applicable' },
] as const;

/** WHO-UMC 因果關係分級。後台判定用，業務端不填。 */
export const CAUSALITY_OPTIONS = [
  { value: 'certain', zh: '肯定有關 (Certain)', en: 'Certain' },
  { value: 'probable', zh: '很可能有關 (Probable/Likely)', en: 'Probable/Likely' },
  { value: 'possible', zh: '可能有關 (Possible)', en: 'Possible' },
  { value: 'unlikely', zh: '不太可能 (Unlikely)', en: 'Unlikely' },
  { value: 'conditional', zh: '待分類 (Conditional/Unclassified)', en: 'Conditional/Unclassified' },
  { value: 'unassessable', zh: '無法評估 (Unassessable)', en: 'Unassessable/Unclassifiable' },
] as const;

/** 預期性：對照核准仿單判定，決定是否構成需快速通報的非預期嚴重不良反應。 */
export const EXPECTEDNESS_OPTIONS = [
  { value: 'listed', zh: '仿單已載明 (Listed/Expected)', en: 'Listed (Expected)' },
  { value: 'unlisted', zh: '仿單未載明 (Unlisted/Unexpected)', en: 'Unlisted (Unexpected)' },
  { value: 'unknown', zh: '尚未比對', en: 'Not yet assessed' },
] as const;

/**
 * 反應發生國別（CIOMS 1a / E2B C.2.r.5）。
 * 藥商對國內、外發生的嚴重不良反應都有蒐集與通報義務，境外個案的判定與送件路徑不同，
 * 因此國別不能沿用預設值——沒有這一欄，原廠轉來的境外個案會被全部記成本國案。
 * 只列常見來源，其餘走 'other' 自填，避免塞進 200 個國家的下拉選單。
 */
export const COUNTRY_OPTIONS = [
  { value: 'TW', zh: '台灣', en: 'Taiwan' },
  { value: 'JP', zh: '日本', en: 'Japan' },
  { value: 'US', zh: '美國', en: 'United States' },
  { value: 'CN', zh: '中國大陸', en: 'China' },
  { value: 'DE', zh: '德國', en: 'Germany' },
  { value: 'other', zh: '其他（自填）', en: 'Other (specify)' },
] as const;

export const SEX_OPTIONS = [
  { value: 'male', zh: '男', en: 'Male' },
  { value: 'female', zh: '女', en: 'Female' },
  { value: 'other', zh: '其他', en: 'Other' },
  { value: 'unknown', zh: '不明', en: 'Unknown' },
] as const;

export const AGE_UNIT_OPTIONS = [
  { value: 'year', zh: '歲', en: 'Years' },
  { value: 'month', zh: '月', en: 'Months' },
  { value: 'day', zh: '天', en: 'Days' },
] as const;

/** 藥商知悉嚴重藥物不良反應後的法定通報期限（日）。 */
export const MAH_SERIOUS_REPORT_DAYS = 15;

// ─────────────────────────────────────────────────────────────
// 資料結構
// ─────────────────────────────────────────────────────────────

/** 一項不良反應事件。一個個案可有多項反應（CIOMS 第 7+13 欄可列多筆）。 */
export interface AEEvent {
  id: string;
  /** CIOMS 7+13：通報者原始描述，**不得改寫**，MedDRA 編碼另存 meddraPt。 */
  verbatim: string;
  /** CIOMS 4-6 REACTION ONSET */
  onsetDate: string;
  endDate: string;
  outcome: string;
  /** 勾選的嚴重性準則；空陣列代表非嚴重。 */
  seriousnessCriteria: SeriousnessCriterion[];
  /** 後台編碼欄位（業務端不填） */
  meddraPt?: string;
  meddraSoc?: string;
  meddraVerified?: boolean;
}

/** 一項用藥。isSuspect 決定它落在 CIOMS 第 II 節（懷疑藥品）或第 III 節（併用藥品）。 */
export interface AEDrug {
  id: string;
  /** true = CIOMS 14 懷疑藥品；false = CIOMS 22 併用藥品 */
  isSuspect: boolean;
  /** CIOMS 14 商品名 */
  brandName: string;
  /** CIOMS 14 (include generic name) 活性成分 */
  activeIngredient: string;
  /** 本地必要欄位：批號與效期是產品品質調查與回收追溯的唯一線索 */
  lotNumber: string;
  expiryDate: string;
  licenseNo: string;
  /** CIOMS 15 DAILY DOSE(S) */
  dailyDose: string;
  /** CIOMS 16 ROUTE(S) OF ADMINISTRATION */
  route: string;
  routeOther: string;
  /** CIOMS 17 INDICATION(S) FOR USE */
  indication: string;
  /** CIOMS 18 THERAPY DATES (from/to) */
  therapyStart: string;
  therapyEnd: string;
  /** CIOMS 19 THERAPY DURATION（未填時由起訖日推算） */
  therapyDuration: string;
  /** CIOMS 20 DID REACTION ABATE AFTER STOPPING DRUG? */
  dechallenge: YesNoUnk | '';
  /** CIOMS 21 DID REACTION REAPPEAR AFTER REINTRODUCTION? */
  rechallenge: YesNoUnk | '';
  /** E2B G.k.8 */
  actionTaken: string;
}

/**
 * 附件（藥盒照片、檢驗報告、病歷摘要）。上傳前已在前端壓縮。
 *
 * 本機模式帶 dataUrl；送到後端後，blob 移入 R2，改帶 url 指標（dataUrl 不再回傳），
 * 否則每次讀取個案都會把幾 MB 的照片一起拖出來。顯示時用 attachmentSrc() 取來源。
 */
export interface AEAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** 本機模式的內嵌資料；遠端模式為 undefined */
  dataUrl?: string;
  /** 遠端模式的附件網址（/api/ae-reports/:id/attachments/:attId） */
  url?: string;
  addedAt: string;
}

/** 稽核軌跡。GxP 要求「誰、何時、把什麼改成什麼、為什麼」四要素齊備。 */
export interface AEAuditEntry {
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

/** 後台處理欄位。業務端送出時為預設值，由藥安人員逐步填寫。 */
export interface AETriage {
  /** 是否經人工確認四要素齊備 */
  validityConfirmed: boolean;
  /** 預期性：對照核准仿單 */
  expectedness: string;
  /** WHO-UMC 因果關係 */
  causality: string;
  /** 後台覆寫的嚴重性判定；'' 表示採用事件勾選的自動判定 */
  seriousnessOverride: '' | 'serious' | 'non_serious';
  /** 承辦人 */
  assignee: string;
  /** 疑似重複的既有個案 id */
  duplicateOfId: string;
  /** 送件時間與主管機關回執編號 */
  submittedToAuthorityAt: string;
  authorityReceiptNo: string;
  /**
   * 轉報原廠（MAH）的日期與原廠給的個案編號。
   *
   * 台灣代理商的通報義務有兩個方向，而它們不是同一件事：
   * 送主管機關（submittedToAuthorityAt）與轉報原廠（transmittedToMahAt）。
   * 主管機關轉知的個案尤其明顯——TFDA 那邊已經有了，代理商真正要做的是轉報原廠。
   * 只留一組送件欄位，這件做過的事就沒有地方記，稽核時等於沒做。
   */
  transmittedToMahAt: string;
  /** 原廠指派的個案編號（CIOMS 24b 在代理商情境下的對應值） */
  mahCaseNumber: string;
  /** 補件請求紀錄 */
  followUpRequestedAt: string;
  notes: string;
}

export interface AEReport {
  id: string;
  /** CIOMS 24b MFR CONTROL NO.：公司內部個案編號 */
  caseNumber: string;
  /** Server-side optimistic concurrency token; omitted for new offline drafts. */
  version?: number;
  status: AECaseStatus;
  /** CIOMS 25a REPORT TYPE */
  reportType: 'initial' | 'follow_up';
  /** 追蹤報告所補充的原始個案編號（人可讀，印在 CIOMS 25a） */
  followUpOf: string;
  /** 追蹤報告指向的原始個案 id（機器可讀的真正連結，供串接追蹤鏈與排除重複偵測） */
  followUpOfId: string;
  /**
   * 本次追蹤報告是否帶來「重要新資訊」（例如非嚴重轉為嚴重、新增死亡結果、補上因果關係關鍵資料）。
   * 這個旗標直接決定 15 日快速通報時鐘要不要重新起算——見 computeRegulatoryClock。
   * 僅在 reportType === 'follow_up' 時有意義。
   */
  hasSignificantNewInfo: boolean;

  // ── 通報者（業務端）──────────────────────────────
  reporterName: string;
  reporterEmployeeId: string;
  reporterPhone: string;
  reporterEmail: string;
  /** CIOMS 26 服務單位；《嚴重藥物不良反應通報辦法》要求通報人服務單位名稱、地址 */
  reporterOrg: string;
  reporterTerritory: string;

  // ── 原始通報來源 ────────────────────────────────
  /** CIOMS 24d REPORT SOURCE */
  reportSource: string;
  primaryReporterName: string;
  primaryReporterProfession: string;
  primaryReporterOrg: string;
  primaryReporterContact: string;
  /** 原始通報者是否同意後續追蹤聯繫；影響補件可行性 */
  primaryReporterConsentFollowUp: boolean;

  /** CIOMS 24c DATE RECEIVED BY MANUFACTURER —— **法定 15 日時鐘的 Day 0**，最關鍵的單一欄位 */
  awarenessDate: string;
  /**
   * 原始通報者或主管機關獲知／通報該事件的日期。
   *
   * 為什麼要和 awarenessDate 分開存：主管機關轉知的個案，表單上最顯眼的日期是
   * **來源端**的日期，而法定時鐘要從**公司**獲知日起算。兩者混為一談，時鐘就從
   * 錯的那天開始跑——這是轉知個案最容易犯、也最難事後察覺的錯。
   *
   * ⚠️ 本欄位**不影響**法定時鐘，純粹留存來源端的時序供覆核與稽核對照。
   * 只有 awarenessDate 決定 Day 0。
   */
  sourceAwarenessDate: string;
  /** DATE OF THIS REPORT */
  reportDate: string;
  /** CIOMS 1a COUNTRY（反應發生國別） */
  country: string;
  /** country === 'other' 時的自填國別 */
  countryOther: string;

  // ── 病人（CIOMS 第 I 節）────────────────────────
  /** CIOMS 1 PATIENT INITIALS。避免蒐集全名：個資最小化原則 */
  patientInitials: string;
  patientId: string;
  /** CIOMS 2 DATE OF BIRTH */
  patientBirthDate: string;
  /** CIOMS 2a AGE */
  patientAgeValue: string;
  patientAgeUnit: string;
  /** CIOMS 3 SEX */
  patientSex: string;
  patientWeightKg: string;
  patientHeightCm: string;
  pregnancy: string;
  lastMenstrualPeriod: string;

  // ── 反應（CIOMS 第 I 節）────────────────────────
  events: AEEvent[];
  /** CIOMS 7+13 的檢驗數據部分 */
  labData: string;
  /** E2B H.1 個案描述 */
  narrative: string;
  deathDate: string;
  causeOfDeath: string;
  autopsyDone: string;

  // ── 用藥（CIOMS 第 II、III 節）──────────────────
  drugs: AEDrug[];
  /** CIOMS 23 OTHER RELEVANT HISTORY */
  medicalHistory: string;
  allergies: string;

  attachments: AEAttachment[];

  triage: AETriage;
  auditTrail: AEAuditEntry[];
  createdAt: string;
  updatedAt: string;
  /**
   * 送出者，由後端從已驗證的 Access JWT 填入，前端唯讀。
   * 本機模式沒有這個欄位——本機模式本來就沒有可信身分。
   */
  submittedBy?: string;
}

// ─────────────────────────────────────────────────────────────
// 建構子
// ─────────────────────────────────────────────────────────────

/** 產生本機唯一 id。crypto.randomUUID 不可用時退回時間戳＋亂數。 */
export function newId(prefix = ''): string {
  const g: any = typeof globalThis !== 'undefined' ? globalThis : {};
  const uuid = g.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export function emptyEvent(): AEEvent {
  return { id: newId('ev'), verbatim: '', onsetDate: '', endDate: '', outcome: '', seriousnessCriteria: [] };
}

export function emptyDrug(isSuspect = true): AEDrug {
  return {
    id: newId('dr'), isSuspect,
    brandName: '', activeIngredient: '', lotNumber: '', expiryDate: '', licenseNo: '',
    dailyDose: '', route: '', routeOther: '', indication: '',
    therapyStart: '', therapyEnd: '', therapyDuration: '',
    dechallenge: '', rechallenge: '', actionTaken: '',
  };
}

/**
 * 產生空白個案。
 * @param todayIso 由呼叫端傳入 YYYY-MM-DD，避免在測試中依賴系統時鐘。
 */
export function emptyAEReport(todayIso = ''): AEReport {
  return {
    id: newId('ae'),
    caseNumber: '',
    status: 'draft',
    reportType: 'initial',
    followUpOf: '', followUpOfId: '', hasSignificantNewInfo: false,
    reporterName: '', reporterEmployeeId: '', reporterPhone: '', reporterEmail: '',
    reporterOrg: '', reporterTerritory: '',
    reportSource: '', primaryReporterName: '', primaryReporterProfession: '',
    primaryReporterOrg: '', primaryReporterContact: '', primaryReporterConsentFollowUp: false,
    awarenessDate: todayIso, sourceAwarenessDate: '', reportDate: todayIso, country: 'TW', countryOther: '',
    patientInitials: '', patientId: '', patientBirthDate: '',
    patientAgeValue: '', patientAgeUnit: 'year', patientSex: '',
    patientWeightKg: '', patientHeightCm: '', pregnancy: '', lastMenstrualPeriod: '',
    events: [emptyEvent()],
    labData: '', narrative: '', deathDate: '', causeOfDeath: '', autopsyDone: '',
    drugs: [emptyDrug(true)],
    medicalHistory: '', allergies: '',
    attachments: [],
    triage: {
      validityConfirmed: false, expectedness: 'unknown', causality: '',
      seriousnessOverride: '', assignee: '', duplicateOfId: '',
      submittedToAuthorityAt: '', authorityReceiptNo: '',
      transmittedToMahAt: '', mahCaseNumber: '',
      followUpRequestedAt: '', notes: '',
    },
    auditTrail: [],
    createdAt: todayIso, updatedAt: todayIso,
  };
}

/**
 * 依「年份-流水號」規則產生公司內部個案編號（CIOMS 24b）。
 * 流水號取自同年度既有個案的最大序號 +1，避免刪除個案後編號重複。
 */
export function nextCaseNumber(existing: AEReport[], todayIso: string, prefix = 'PV'): string {
  const year = (todayIso || '').slice(0, 4) || String(new Date().getFullYear());
  const head = `${prefix}-${year}-`;
  let max = 0;
  for (const r of existing || []) {
    if (typeof r?.caseNumber === 'string' && r.caseNumber.startsWith(head)) {
      const n = parseInt(r.caseNumber.slice(head.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${head}${String(max + 1).padStart(4, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// 判定邏輯
// ─────────────────────────────────────────────────────────────

const has = (s: any) => typeof s === 'string' && s.trim().length > 0;

export interface MinimumCriteria {
  identifiablePatient: boolean;
  identifiableReporter: boolean;
  suspectProduct: boolean;
  adverseEvent: boolean;
  valid: boolean;
  missing: string[];
}

/**
 * ICSR 四要素效度檢核。四者缺一即非有效個案，不得逕行送件，需先補件。
 * 這是國際藥物警戒的共同底線，也是後台第一道關卡。
 */
export function checkMinimumCriteria(r: AEReport): MinimumCriteria {
  const identifiablePatient =
    has(r.patientInitials) || has(r.patientId) || has(r.patientBirthDate) ||
    has(r.patientAgeValue) || (has(r.patientSex) && r.patientSex !== 'unknown');

  const identifiableReporter = has(r.reporterName) || has(r.primaryReporterName);

  const suspectProduct = (r.drugs || []).some(
    d => d.isSuspect && (has(d.brandName) || has(d.activeIngredient))
  );

  const adverseEvent = (r.events || []).some(e => has(e.verbatim));

  const missing: string[] = [];
  if (!identifiablePatient) missing.push('identifiablePatient');
  if (!identifiableReporter) missing.push('identifiableReporter');
  if (!suspectProduct) missing.push('suspectProduct');
  if (!adverseEvent) missing.push('adverseEvent');

  return {
    identifiablePatient, identifiableReporter, suspectProduct, adverseEvent,
    valid: missing.length === 0,
    missing,
  };
}

export interface SeriousnessAssessment {
  serious: boolean;
  criteria: SeriousnessCriterion[];
  /** 是否由後台人工覆寫（而非事件勾選推導） */
  overridden: boolean;
}

/**
 * 嚴重性判定：任一事件勾選任一法定準則 → 嚴重。
 * 後台可覆寫（例如業務漏勾住院、或誤勾）；覆寫會標記 overridden 供稽核。
 */
export function assessSeriousness(r: AEReport): SeriousnessAssessment {
  const set = new Set<SeriousnessCriterion>();
  for (const e of r.events || []) {
    for (const c of e.seriousnessCriteria || []) set.add(c);
  }
  const criteria = [...set];
  const auto = criteria.length > 0;
  const ov = r.triage?.seriousnessOverride;
  if (ov === 'serious') return { serious: true, criteria, overridden: !auto };
  if (ov === 'non_serious') return { serious: false, criteria, overridden: auto };
  return { serious: auto, criteria, overridden: false };
}

/** 以 UTC 解析 YYYY-MM-DD；格式不符回 null（不接受 Date 建構子的寬鬆解析，以免時區位移）。 */
export function parseIsoDate(s: string): Date | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // 拒絕 2026-02-30 這類溢位日期
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function addDays(iso: string, days: number): string {
  const dt = parseIsoDate(iso);
  if (!dt) return '';
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 兩個 YYYY-MM-DD 相差幾天（b - a）。任一無效回 null。 */
export function daysBetween(a: string, b: string): number | null {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 為什麼有／沒有快速通報期限。讓 UI 能說明理由，而不是只顯示一個空白的到期日。 */
export type ClockBasis =
  | 'expedited'              // 嚴重個案，15 日快速通報
  | 'non_serious'            // 非嚴重，併入定期安全性報告
  | 'followup_no_new_info'   // 追蹤報告但未帶來重要新資訊，不重啟時鐘
  | 'no_day0';               // 未填首次獲知日，無法起算

/** 全部依據值。UI 以 `ae.console.basis.<value>` 取字串，覆蓋率由單元測試把關。 */
export const CLOCK_BASES: ClockBasis[] = ['expedited', 'non_serious', 'followup_no_new_info', 'no_day0'];

export interface RegulatoryClock {
  serious: boolean;
  /** Day 0：首次獲知日（追蹤報告為「獲知新資訊日」） */
  day0: string;
  /** 法定應通報期限；無快速通報義務時為 ''（見 basis） */
  dueDate: string;
  /** 距到期日剩餘天數；負數代表逾期。無到期日時為 null */
  daysRemaining: number | null;
  overdue: boolean;
  /** 已送出者不再倒數 */
  submitted: boolean;
  /** 期限（或沒有期限）的依據 */
  basis: ClockBasis;
}

/**
 * 法定時限計算。
 * 嚴重個案：藥商應於得知之日起 15 日內完成通報 →  dueDate = 獲知日 + 15 天。
 * 非嚴重個案：無個案別快速通報期限，收錄於定期安全性報告（PSUR/PBRER）。
 * @param todayIso 由呼叫端注入今日日期，維持函式純度。
 */
export function computeRegulatoryClock(r: AEReport, todayIso: string): RegulatoryClock {
  const { serious } = assessSeriousness(r);
  const day0 = r.awarenessDate || '';
  const submitted = has(r.triage?.submittedToAuthorityAt);
  const none = (basis: ClockBasis): RegulatoryClock =>
    ({ serious, day0, dueDate: '', daysRemaining: null, overdue: false, submitted, basis });

  if (!serious) return none('non_serious');
  if (!parseIsoDate(day0)) return none('no_day0');
  // 追蹤報告只有在帶來「重要新資訊」時才重啟 15 日時鐘；純補件的追蹤報告
  // 沒有新的快速通報義務，收錄於定期安全性報告即可。誤把每一份追蹤報告都當成
  // 新的 15 日案件，會讓真正該急的案子淹沒在假期限裡。
  if (r.reportType === 'follow_up' && !r.hasSignificantNewInfo) return none('followup_no_new_info');

  const dueDate = addDays(day0, MAH_SERIOUS_REPORT_DAYS);
  const daysRemaining = daysBetween(todayIso, dueDate);
  return {
    serious, day0, dueDate, daysRemaining,
    overdue: !submitted && daysRemaining !== null && daysRemaining < 0,
    submitted,
    basis: 'expedited',
  };
}

// ─────────────────────────────────────────────────────────────
// 追蹤報告（Follow-up）
// ─────────────────────────────────────────────────────────────

/**
 * 找出一筆個案所屬追蹤鏈的根（初始報告）id。
 * 沿 followUpOfId 往上走，並以已訪問集合擋住資料損毀造成的環，避免無限迴圈。
 */
export function chainRootId(report: AEReport, pool: AEReport[]): string {
  const byId = new Map((pool || []).map(r => [r.id, r]));
  const seen = new Set<string>();
  let cur: AEReport | undefined = report;
  while (cur && has(cur.followUpOfId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent: AEReport | undefined = byId.get(cur.followUpOfId);
    if (!parent) break;
    cur = parent;
  }
  return cur ? cur.id : report.id;
}

/** 取得某筆個案的所有追蹤報告（直接子代），依獲知日排序。 */
export function followUpsOf(report: AEReport, pool: AEReport[]): AEReport[] {
  return (pool || [])
    .filter(r => r.followUpOfId === report.id)
    .sort((a, b) => (a.awarenessDate || '').localeCompare(b.awarenessDate || ''));
}

/**
 * 由原案建立一份追蹤報告。
 *
 * 刻意「複製」而非「就地修改原案」：主管機關收到的是一份份獨立報告，
 * 原案送出時的內容必須保持原樣以供稽核比對，追蹤報告是另一份文件。
 *
 * awarenessDate 設為 todayIso —— 對追蹤報告而言，Day 0 是**獲知新資訊的日期**，
 * 不是原案的首次獲知日。這是最容易搞錯、也最有法律後果的一點。
 *
 * 附件不複製：原案已保存，複製 dataURL 會讓儲存量隨追蹤次數線性膨脹。
 */
export function createFollowUp(
  parent: AEReport,
  pool: AEReport[],
  todayIso: string,
  actor = 'pv-officer',
): AEReport {
  const existing = followUpsOf(parent, pool).length;
  const base = parent.caseNumber || parent.id.slice(0, 12);
  const now = new Date().toISOString();
  return {
    ...parent,
    id: newId('ae'),
    caseNumber: `${base}-F${existing + 1}`,
    status: 'triage',
    reportType: 'follow_up',
    followUpOf: parent.caseNumber,
    followUpOfId: parent.id,
    hasSignificantNewInfo: true,
    awarenessDate: todayIso,
    reportDate: todayIso,
    // 深拷貝可變的子結構，避免與原案共用參考而互相污染
    events: (parent.events || []).map(e => ({ ...e, id: newId('ev'), seriousnessCriteria: [...(e.seriousnessCriteria || [])] })),
    drugs: (parent.drugs || []).map(d => ({ ...d, id: newId('dr') })),
    attachments: [],
    triage: {
      ...parent.triage,
      validityConfirmed: false,
      submittedToAuthorityAt: '',
      authorityReceiptNo: '',
      followUpRequestedAt: '',
      duplicateOfId: '',
    },
    auditTrail: [{
      at: now,
      actor,
      action: 'follow_up_created',
      detail: `由原案 ${base} 建立追蹤報告；Day 0 設為獲知新資訊日 ${todayIso}`,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 所有檢核碼。UI 以 `ae.issue.<code>` 取翻譯字串，
 * 因此新增檢核時必須同步補上 zh/en 兩份字串——tests/aeReport.test.ts 會逐一驗證，漏補即測試失敗。
 */
export const AE_ISSUE_CODES = [
  'reporterRequired', 'reporterContactRequired', 'awarenessDateRequired', 'awarenessDateFuture',
  'sourceAwarenessFuture', 'sourceAwarenessAfterAwareness',
  'reportSourceRequired', 'countryRequired', 'countryOtherRequired',
  'patientRequired', 'patientSexMissing', 'patientAgeMissing',
  'eventRequired', 'onsetDateMissing', 'onsetDateFuture', 'outcomeMissing', 'endBeforeOnset',
  'deathDateMissing',
  'suspectDrugRequired', 'lotNumberMissing', 'doseMissing', 'routeMissing', 'indicationMissing',
  'therapyStartMissing', 'therapyEndBeforeStart', 'dechallengeMissing', 'onsetBeforeTherapy',
] as const;

export type AEIssueCode = typeof AE_ISSUE_CODES[number];

/** 重複個案的比對維度。UI 以 `ae.console.dupReason.<value>` 取翻譯字串。 */
export const AE_DUPLICATE_REASONS = ['patient', 'drug', 'event', 'onset'] as const;
export type AEDuplicateReason = typeof AE_DUPLICATE_REASONS[number];

export interface ValidationIssue {
  /** i18n key 後綴，UI 端以 `ae.issue.${code}` 取字串 */
  code: AEIssueCode;
  level: 'error' | 'warning';
  /** 對應的表單步驟（0-based），供 UI 直接跳轉 */
  step?: number;
  detail?: string;
}

/**
 * 送出前檢核。
 * error 阻擋送出（四要素、獲知日、聯絡方式）；warning 允許送出但列入補件清單，
 * 因為藥物警戒的原則是「先讓個案進系統，再補資料」——擋著不讓通報比資料不全更糟。
 */
export function validateAEReport(r: AEReport, todayIso = ''): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const min = checkMinimumCriteria(r);

  if (!min.identifiableReporter) issues.push({ code: 'reporterRequired', level: 'error', step: 0 });
  if (!has(r.reporterPhone) && !has(r.reporterEmail)) issues.push({ code: 'reporterContactRequired', level: 'error', step: 0 });
  if (!has(r.awarenessDate)) issues.push({ code: 'awarenessDateRequired', level: 'error', step: 0 });
  if (!has(r.reportSource)) issues.push({ code: 'reportSourceRequired', level: 'warning', step: 0 });
  if (!has(r.country)) issues.push({ code: 'countryRequired', level: 'error', step: 0 });
  // 選了「其他」卻沒填國名，等於沒有國別——境外個案的送件路徑就判不出來
  if (r.country === 'other' && !has(r.countryOther)) issues.push({ code: 'countryOtherRequired', level: 'error', step: 0 });

  if (!min.identifiablePatient) issues.push({ code: 'patientRequired', level: 'error', step: 1 });
  if (!has(r.patientSex)) issues.push({ code: 'patientSexMissing', level: 'warning', step: 1 });
  if (!has(r.patientAgeValue) && !has(r.patientBirthDate)) issues.push({ code: 'patientAgeMissing', level: 'warning', step: 1 });

  if (!min.adverseEvent) issues.push({ code: 'eventRequired', level: 'error', step: 2 });
  (r.events || []).forEach(e => {
    if (has(e.verbatim) && !has(e.onsetDate)) issues.push({ code: 'onsetDateMissing', level: 'warning', step: 2, detail: e.verbatim });
    if (has(e.verbatim) && !has(e.outcome)) issues.push({ code: 'outcomeMissing', level: 'warning', step: 2, detail: e.verbatim });
    if (has(e.onsetDate) && has(e.endDate)) {
      const d = daysBetween(e.onsetDate, e.endDate);
      if (d !== null && d < 0) issues.push({ code: 'endBeforeOnset', level: 'error', step: 2, detail: e.verbatim });
    }
  });

  const { serious, criteria } = assessSeriousness(r);
  if (serious && criteria.includes('death') && !has(r.deathDate)) {
    issues.push({ code: 'deathDateMissing', level: 'warning', step: 2 });
  }

  if (!min.suspectProduct) issues.push({ code: 'suspectDrugRequired', level: 'error', step: 3 });
  (r.drugs || []).filter(d => d.isSuspect).forEach(d => {
    const label = d.brandName || d.activeIngredient;
    if (!has(label)) return;
    if (!has(d.lotNumber)) issues.push({ code: 'lotNumberMissing', level: 'warning', step: 3, detail: label });
    if (!has(d.dailyDose)) issues.push({ code: 'doseMissing', level: 'warning', step: 3, detail: label });
    if (!has(d.route)) issues.push({ code: 'routeMissing', level: 'warning', step: 3, detail: label });
    if (!has(d.indication)) issues.push({ code: 'indicationMissing', level: 'warning', step: 3, detail: label });
    if (!has(d.therapyStart)) issues.push({ code: 'therapyStartMissing', level: 'warning', step: 3, detail: label });
    if (has(d.therapyStart) && has(d.therapyEnd)) {
      const dd = daysBetween(d.therapyStart, d.therapyEnd);
      if (dd !== null && dd < 0) issues.push({ code: 'therapyEndBeforeStart', level: 'error', step: 3, detail: label });
    }
    if (!has(d.dechallenge)) issues.push({ code: 'dechallengeMissing', level: 'warning', step: 3, detail: label });
  });

  // 時序合理性：反應發生日不應早於用藥起始日（早於 = 反應先於暴露，因果關係無法成立）
  const firstOnset = (r.events || []).map(e => e.onsetDate).filter(has).sort()[0];
  const firstStart = (r.drugs || []).filter(d => d.isSuspect).map(d => d.therapyStart).filter(has).sort()[0];
  if (firstOnset && firstStart) {
    const d = daysBetween(firstStart, firstOnset);
    if (d !== null && d < 0) issues.push({ code: 'onsetBeforeTherapy', level: 'warning', step: 3 });
  }

  // 來源端不可能比公司更晚獲知——個案是從來源流向公司的。
  // 但只給警告不給錯誤：轉知文件的日期常有落差與筆誤，而擋著不讓通報比日期怪異嚴重得多。
  // 真正的用途是提醒「你可能把來源日期填進了 Day 0」。
  if (has(r.sourceAwarenessDate) && has(r.awarenessDate)) {
    const d = daysBetween(r.awarenessDate, r.sourceAwarenessDate);
    if (d !== null && d > 0) issues.push({ code: 'sourceAwarenessAfterAwareness', level: 'warning', step: 0 });
  }

  // 未來日期一律視為輸入錯誤
  if (todayIso) {
    const future = (iso: string) => {
      const d = daysBetween(todayIso, iso);
      return d !== null && d > 0;
    };
    if (future(r.awarenessDate)) issues.push({ code: 'awarenessDateFuture', level: 'error', step: 0 });
    if (future(r.sourceAwarenessDate)) issues.push({ code: 'sourceAwarenessFuture', level: 'error', step: 0 });
    (r.events || []).forEach(e => {
      if (future(e.onsetDate)) issues.push({ code: 'onsetDateFuture', level: 'error', step: 2, detail: e.verbatim });
    });
  }

  return issues;
}

/** 完整度百分比：以 CIOMS 主要欄位的填答率估算，供後台排定補件優先序。 */
export function computeCompleteness(r: AEReport): number {
  const suspect = (r.drugs || []).find(d => d.isSuspect) || emptyDrug();
  const ev = (r.events || [])[0] || emptyEvent();
  const checks: boolean[] = [
    has(r.reporterName), has(r.reporterPhone) || has(r.reporterEmail), has(r.reporterOrg),
    has(r.reportSource), has(r.awarenessDate),
    has(r.patientInitials) || has(r.patientId),
    has(r.patientSex), has(r.patientAgeValue) || has(r.patientBirthDate), has(r.patientWeightKg),
    has(ev.verbatim), has(ev.onsetDate), has(ev.outcome),
    has(r.narrative), has(r.labData),
    has(suspect.brandName) || has(suspect.activeIngredient),
    has(suspect.lotNumber), has(suspect.dailyDose), has(suspect.route),
    has(suspect.indication), has(suspect.therapyStart),
    has(suspect.dechallenge), has(suspect.rechallenge),
    has(r.medicalHistory),
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

const normKey = (s: any) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');

export interface DuplicateCandidate {
  id: string;
  caseNumber: string;
  score: number;      // 0–100 相似度
  reasons: AEDuplicateReason[];
}

/**
 * 重複個案偵測。同一起事件常由業務、客服、醫院三路湧入，
 * 重複送件會污染訊號偵測的分子（同一案被算成三案）。
 * 用「病人識別 + 懷疑藥品 + 反應詞 + 發生日」四個維度加權比對，不做模糊字串比對以維持可解釋性。
 */
export function findDuplicates(target: AEReport, pool: AEReport[], threshold = 50): DuplicateCandidate[] {
  // 追蹤報告與其原案本來就會在病人／藥品／反應三個維度完全相同，
  // 不排除的話每一份追蹤報告都會被標成重複個案，示警很快就會被無視。
  const targetRoot = chainRootId(target, pool);
  const tPatient = normKey(target.patientInitials || target.patientId);
  const tDrugs = new Set((target.drugs || []).filter(d => d.isSuspect)
    .flatMap(d => [normKey(d.brandName), normKey(d.activeIngredient)]).filter(Boolean));
  const tEvents = new Set((target.events || []).map(e => normKey(e.verbatim)).filter(Boolean));
  const tOnsets = new Set((target.events || []).map(e => e.onsetDate).filter(has));

  const out: DuplicateCandidate[] = [];
  for (const p of pool || []) {
    if (!p || p.id === target.id) continue;
    if (p.status === 'invalid') continue;
    if (chainRootId(p, pool) === targetRoot) continue; // 同一追蹤鏈，不是重複個案
    let score = 0;
    const reasons: AEDuplicateReason[] = [];

    const pPatient = normKey(p.patientInitials || p.patientId);
    if (tPatient && pPatient && tPatient === pPatient) { score += 30; reasons.push('patient'); }

    const pDrugs = (p.drugs || []).filter(d => d.isSuspect)
      .flatMap(d => [normKey(d.brandName), normKey(d.activeIngredient)]).filter(Boolean);
    if (pDrugs.some(d => tDrugs.has(d))) { score += 25; reasons.push('drug'); }

    const pEvents = (p.events || []).map(e => normKey(e.verbatim)).filter(Boolean);
    if (pEvents.some(e => tEvents.has(e))) { score += 30; reasons.push('event'); }

    const pOnsets = (p.events || []).map(e => e.onsetDate).filter(has);
    if (pOnsets.some(o => tOnsets.has(o))) { score += 15; reasons.push('onset'); }

    if (score >= threshold) {
      out.push({ id: p.id, caseNumber: p.caseNumber || p.id, score, reasons });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 附加一筆稽核紀錄（回傳新物件，不變更原輸入）。 */
export function withAudit(r: AEReport, entry: AEAuditEntry): AEReport {
  return { ...r, auditTrail: [...(r.auditTrail || []), entry], updatedAt: entry.at };
}

// ─────────────────────────────────────────────────────────────
// 輸出：CIOMS-I 文字表單 / E2B(R3) 對照 / CSV
// ─────────────────────────────────────────────────────────────

const label = (opts: readonly { value: string; zh: string; en: string }[], v: string, lang: 'zh' | 'en' = 'zh') => {
  const hit = opts.find(o => o.value === v);
  return hit ? hit[lang] : (v || '');
};

export const optionLabel = label;

/** 反應發生國別的可讀字串；'other' 時取自填值。 */
export function countryText(r: AEReport, lang: 'zh' | 'en' = 'zh'): string {
  if (r.country === 'other') return r.countryOther || '';
  return label(COUNTRY_OPTIONS, r.country, lang) || r.country || '';
}

/** 是否為境外個案（非台灣發生）。境外個案的送件路徑與資料來源不同，需在後台標示出來。 */
export function isForeignCase(r: AEReport): boolean {
  const c = (r.country || '').trim();
  if (!c) return false;
  if (c === 'other') return has(r.countryOther) && normKey(r.countryOther) !== 'taiwan' && r.countryOther.trim() !== '台灣';
  return c !== 'TW';
}

/** 病人年齡的可讀字串（優先用填寫的年齡，其次由出生日期推算）。 */
export function patientAgeText(r: AEReport, todayIso = '', lang: 'zh' | 'en' = 'zh'): string {
  if (has(r.patientAgeValue)) {
    return `${r.patientAgeValue}${label(AGE_UNIT_OPTIONS, r.patientAgeUnit, lang)}`;
  }
  // 用日曆年差再回補「今年生日是否已過」，不用 365.25 天的近似值：
  // 近似法在剛好生日當天會少算一歲（22645 / 365.25 = 61.99…），對兒科與老年族群的分層統計是實質誤差。
  const birth = parseIsoDate(r.patientBirthDate);
  const ref = parseIsoDate(todayIso);
  if (!birth || !ref || ref.getTime() < birth.getTime()) return '';
  let years = ref.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthdayThisYear =
    ref.getUTCMonth() < birth.getUTCMonth() ||
    (ref.getUTCMonth() === birth.getUTCMonth() && ref.getUTCDate() < birth.getUTCDate());
  if (beforeBirthdayThisYear) years--;
  return `${years}${label(AGE_UNIT_OPTIONS, 'year', lang)}`;
}

/** 由治療起訖日推算療程長度（天）；使用者已自填時尊重自填值。 */
export function therapyDurationText(d: AEDrug): string {
  if (has(d.therapyDuration)) return d.therapyDuration;
  const n = daysBetween(d.therapyStart, d.therapyEnd);
  return n === null ? '' : `${n + 1} 天`;
}

/**
 * 產生 CIOMS-I 個案安全報告文字表單。
 * 欄號與官方表單一致，方便藥安人員逐欄對照謄寫或貼入電子通報系統。
 */
export function aeToCIOMSText(r: AEReport, todayIso = ''): string {
  const line = '─'.repeat(64);
  const na = (v: string) => (has(v) ? v : 'N/A');
  const { serious, criteria } = assessSeriousness(r);
  const suspects = (r.drugs || []).filter(d => d.isSuspect);
  const concomitant = (r.drugs || []).filter(d => !d.isSuspect);

  const routeText = (d: AEDrug) => d.route === 'other' ? na(d.routeOther) : na(label(ROUTE_OPTIONS, d.route));

  const out: string[] = [
    'CIOMS FORM I — SUSPECT ADVERSE REACTION REPORT（草稿，需藥安人員審閱）',
    `個案編號 (24b MFR CONTROL NO.): ${na(r.caseNumber)}    報告類型 (25a): ${r.reportType === 'follow_up' ? 'FOLLOW-UP' : 'INITIAL'}`,
    line,
    'I. REACTION INFORMATION',
    `1. 病人姓名縮寫 (PATIENT INITIALS)   : ${na(r.patientInitials)}`,
    `1a. 國別 (COUNTRY)                  : ${na(countryText(r))}${isForeignCase(r) ? '  ← 境外個案' : ''}`,
    `2. 出生日期 (DATE OF BIRTH)         : ${na(r.patientBirthDate)}`,
    `2a. 年齡 (AGE)                      : ${na(patientAgeText(r, todayIso))}`,
    `3. 性別 (SEX)                       : ${na(label(SEX_OPTIONS, r.patientSex))}`,
    `4-6. 反應發生日 (REACTION ONSET)    : ${na((r.events || []).map(e => e.onsetDate).filter(has).join(', '))}`,
    '',
    '7+13. 反應描述 (DESCRIBE REACTION(S), including relevant tests/lab data):',
    ...(r.events || []).filter(e => has(e.verbatim)).map((e, i) =>
      `   (${i + 1}) ${e.verbatim}` +
      (has(e.meddraPt) ? `\n        MedDRA PT: ${e.meddraPt}${has(e.meddraSoc || '') ? ` / SOC: ${e.meddraSoc}` : ''}${e.meddraVerified ? '' : '  ⚠ 未經詞典驗證，需人工編碼'}` : '') +
      (has(e.onsetDate) ? `\n        發生日: ${e.onsetDate}${has(e.endDate) ? ` ~ ${e.endDate}` : ''}` : '') +
      (has(e.outcome) ? `\n        結果 (OUTCOME): ${label(OUTCOME_OPTIONS, e.outcome)}` : '')
    ),
    has(r.labData) ? `   檢驗數據: ${r.labData}` : '',
    '',
    `嚴重性 (SERIOUSNESS): ${serious ? '嚴重 SERIOUS' : '非嚴重 NON-SERIOUS'}`,
    ...SERIOUSNESS_CRITERIA.map(c => `   [${criteria.includes(c.value) ? 'X' : ' '}] ${c.en} / ${c.zh}`),
    has(r.deathDate) ? `   死亡日期: ${r.deathDate}    死因: ${na(r.causeOfDeath)}    解剖: ${na(r.autopsyDone)}` : '',
    line,
    'II. SUSPECT DRUG(S) INFORMATION',
  ];

  if (!suspects.length) {
    out.push('   （未填寫懷疑藥品 —— 個案不成立，需補件）');
  }
  suspects.forEach((d, i) => {
    out.push(
      `  [${i + 1}] 14. 懷疑藥品 (SUSPECT DRUG)     : ${na(d.brandName)}${has(d.activeIngredient) ? `（成分 ${d.activeIngredient}）` : ''}`,
      `      批號 / 效期 / 許可證             : ${na(d.lotNumber)} / ${na(d.expiryDate)} / ${na(d.licenseNo)}`,
      `      15. 每日劑量 (DAILY DOSE)        : ${na(d.dailyDose)}`,
      `      16. 給藥途徑 (ROUTE)             : ${routeText(d)}`,
      `      17. 適應症 (INDICATION FOR USE)  : ${na(d.indication)}`,
      `      18. 用藥起訖 (THERAPY DATES)     : ${na(d.therapyStart)} ~ ${na(d.therapyEnd)}`,
      `      19. 療程長度 (THERAPY DURATION)  : ${na(therapyDurationText(d))}`,
      `      20. 停藥後反應是否減輕 (DECHALLENGE): ${na(label(YES_NO_UNK_OPTIONS, d.dechallenge))}`,
      `      21. 再投與後是否再現 (RECHALLENGE) : ${na(label(YES_NO_UNK_OPTIONS, d.rechallenge))}`,
      `      採取措施 (ACTION TAKEN)          : ${na(label(ACTION_TAKEN_OPTIONS, d.actionTaken))}`,
    );
  });

  out.push(
    line,
    'III. CONCOMITANT DRUG(S) AND HISTORY',
    '22. 併用藥品 (CONCOMITANT DRUGS, exclude those used to treat reaction):',
    concomitant.length
      ? concomitant.map(d => `   • ${na(d.brandName || d.activeIngredient)}｜${na(d.dailyDose)}｜${routeText(d)}｜${na(d.therapyStart)} ~ ${na(d.therapyEnd)}`).join('\n')
      : '   無 / None',
    '23. 其他相關病史 (OTHER RELEVANT HISTORY):',
    `   ${na(r.medicalHistory)}`,
    has(r.allergies) ? `   過敏史: ${r.allergies}` : '',
    line,
    'IV. MANUFACTURER INFORMATION',
    `24a. 藥商名稱 / 地址              : ${na(r.reporterOrg)}`,
    `24b. 公司個案編號 (MFR CONTROL NO.): ${na(r.caseNumber)}`,
    ...(has(r.triage?.mahCaseNumber)
      ? [`     原廠個案編號 (MAH CASE NO.)   : ${r.triage.mahCaseNumber}`]
      : []),
    ...(has(r.triage?.transmittedToMahAt)
      ? [`     轉報原廠日                    : ${r.triage.transmittedToMahAt}`]
      : []),
    `24c. 首次獲知日 (DATE RECEIVED)   : ${na(r.awarenessDate)}   ← 法定 ${MAH_SERIOUS_REPORT_DAYS} 日時鐘起算日`,
    ...(has(r.sourceAwarenessDate)
      ? [`     來源端獲知／通報日            : ${r.sourceAwarenessDate}   （非時鐘起算日，僅供時序對照）`]
      : []),
    `24d. 通報來源 (REPORT SOURCE)     : ${na(label(REPORT_SOURCE_OPTIONS, r.reportSource))}`,
    `25a. 報告類型 (REPORT TYPE)       : ${r.reportType === 'follow_up' ? 'FOLLOW-UP' : 'INITIAL'}${has(r.followUpOf) ? `（原案 ${r.followUpOf}）` : ''}` +
      (r.reportType === 'follow_up'
        ? `\n      本次是否帶來重要新資訊       : ${r.hasSignificantNewInfo ? '是 —— 15 日時鐘自本次獲知日重新起算' : '否 —— 不重啟快速通報時鐘，收錄於定期安全性報告'}`
        : ''),
    `26. 通報者 (REPORTER)             : ${na(r.primaryReporterName || r.reporterName)}${has(r.primaryReporterProfession) ? `／${r.primaryReporterProfession}` : ''}`,
    `    服務單位 / 聯絡方式           : ${na(r.primaryReporterOrg || r.reporterOrg)}｜${na(r.primaryReporterContact || r.reporterPhone || r.reporterEmail)}`,
    `    公司內部通報人（業務）        : ${na(r.reporterName)}${has(r.reporterEmployeeId) ? `（工號 ${r.reporterEmployeeId}）` : ''}｜${na(r.reporterTerritory)}`,
    `    本報告日期 (DATE OF THIS REPORT): ${na(r.reportDate)}`,
    line,
    'H.1 個案描述 (CASE NARRATIVE):',
    na(r.narrative) === 'N/A' ? autoNarrative(r, todayIso) : r.narrative,
  );

  return out.filter(l => l !== '').join('\n');
}

/** 未填個案描述時，由結構化欄位自動組一段可讀敘述作為起草基礎。 */
export function autoNarrative(r: AEReport, todayIso = ''): string {
  const suspect = (r.drugs || []).find(d => d.isSuspect);
  const age = patientAgeText(r, todayIso);
  const sex = label(SEX_OPTIONS, r.patientSex);
  const who = [age, sex].filter(Boolean).join(' ') || '一名個案';
  const drug = suspect ? (suspect.brandName || suspect.activeIngredient || '該藥品') : '該藥品';
  const parts: string[] = [];
  const ev = (r.events || []).filter(e => has(e.verbatim));
  parts.push(`${who}因「${suspect?.indication || '未載明適應症'}」使用 ${drug}` +
    (suspect?.dailyDose ? `（${suspect.dailyDose}，${suspect.route === 'other' ? suspect.routeOther : label(ROUTE_OPTIONS, suspect?.route || '')}）` : '') +
    (suspect?.therapyStart ? `，用藥期間 ${suspect.therapyStart}${suspect.therapyEnd ? ` 至 ${suspect.therapyEnd}` : ' 起'}` : '') + '。');
  if (ev.length) {
    parts.push(`後續發生 ${ev.map(e => e.verbatim).join('、')}` +
      (ev[0].onsetDate ? `，發生日期 ${ev[0].onsetDate}` : '') + '。');
    const tto = suspect?.therapyStart && ev[0].onsetDate ? daysBetween(suspect.therapyStart, ev[0].onsetDate) : null;
    if (tto !== null && tto >= 0) parts.push(`用藥至反應發生間隔（TTO）約 ${tto} 天。`);
  }
  const { serious, criteria } = assessSeriousness(r);
  parts.push(serious
    ? `本案符合嚴重不良反應準則：${criteria.map(c => label(SERIOUSNESS_CRITERIA as any, c)).join('、')}。`
    : '本案未勾選任何嚴重性準則，初判為非嚴重個案。');
  if (suspect?.dechallenge) parts.push(`停藥後反應變化（dechallenge）：${label(YES_NO_UNK_OPTIONS, suspect.dechallenge)}。`);
  if (suspect?.rechallenge) parts.push(`再投與結果（rechallenge）：${label(YES_NO_UNK_OPTIONS, suspect.rechallenge)}。`);
  if (has(r.medicalHistory)) parts.push(`相關病史：${r.medicalHistory}。`);
  if (has(r.labData)) parts.push(`檢驗數據：${r.labData}。`);
  return parts.join('');
}

/**
 * ICH E2B(R3) 資料元素對照表。
 * 只映射本表單有蒐集的元素；未蒐集者不硬塞空值，避免電子送件時產生假資料。
 */
export function aeToE2B(r: AEReport, todayIso = ''): Record<string, string> {
  const suspect = (r.drugs || []).find(d => d.isSuspect) || emptyDrug();
  const ev = (r.events || []).find(e => has(e.verbatim)) || emptyEvent();
  const { serious, criteria } = assessSeriousness(r);
  const map: Record<string, string> = {
    'C.1.1 (Sender case number)': r.caseNumber || 'N/A',
    'C.1.2 (Date of creation)': r.reportDate || todayIso || 'N/A',
    'C.1.4 (Date report first received from source)': r.awarenessDate || 'N/A',
    'C.1.7 (Does this case fulfil the local criteria for an expedited report?)': serious ? 'Yes' : 'No',
    'C.1.8.1 (Worldwide unique case identification)': r.id,
    'C.2.r.1 (Reporter name)': r.primaryReporterName || r.reporterName || 'N/A',
    'C.2.r.4 (Reporter organisation)': r.primaryReporterOrg || r.reporterOrg || 'N/A',
    'C.1.5 (Date of most recent information)': r.reportDate || todayIso || 'N/A',
    'C.1.8.2 (First sender of this case)': r.reportType === 'follow_up' ? 'Follow-up' : 'Initial',
    'C.2.r.5 (Reporter country)': countryText(r, 'en') || 'N/A',
    'E.i.9 (Identification of the country where the reaction occurred)': countryText(r, 'en') || 'N/A',
    'C.3.1 (Sender type)': 'Pharmaceutical company',
    'C.3.4.1 (Sender organisation)': r.reporterOrg || 'N/A',
    'D.1 (Patient initials)': r.patientInitials || 'N/A',
    'D.2.1 (Date of birth)': r.patientBirthDate || 'N/A',
    'D.2.2a (Age at time of onset)': patientAgeText(r, todayIso, 'en') || 'N/A',
    'D.5 (Sex)': label(SEX_OPTIONS, r.patientSex, 'en') || 'N/A',
    'D.3 (Body weight, kg)': r.patientWeightKg || 'N/A',
    'D.4 (Height, cm)': r.patientHeightCm || 'N/A',
    'D.7.1.r (Relevant medical history)': r.medicalHistory || 'N/A',
    'E.i.1.1a (Reaction as reported by primary source)': ev.verbatim || 'N/A',
    'E.i.2.1b (Reaction MedDRA PT)': ev.meddraPt || 'N/A（待後台編碼）',
    'E.i.3.1 (Term highlighted by the reporter)': serious ? 'Serious' : 'Non-serious',
    'E.i.4 (Date of start of reaction)': ev.onsetDate || 'N/A',
    'E.i.5 (Date of end of reaction)': ev.endDate || 'N/A',
    'E.i.7 (Outcome of reaction at the time of last observation)': label(OUTCOME_OPTIONS, ev.outcome, 'en') || 'N/A',
    'G.k.1 (Characterisation of drug role)': 'Suspect',
    'G.k.2.2 (Medicinal product name as reported)': suspect.brandName || 'N/A',
    'G.k.2.3.r.1 (Substance name)': suspect.activeIngredient || 'N/A',
    'G.k.2.4 (Batch/lot number)': suspect.lotNumber || 'N/A',
    'G.k.3.1 (Authorisation number)': suspect.licenseNo || 'N/A',
    'G.k.4.r.1a (Dose)': suspect.dailyDose || 'N/A',
    'G.k.4.r.4 (Date of start of drug)': suspect.therapyStart || 'N/A',
    'G.k.4.r.5 (Date of last administration)': suspect.therapyEnd || 'N/A',
    'G.k.4.r.10.2b (Route of administration)': (suspect.route === 'other' ? suspect.routeOther : label(ROUTE_OPTIONS, suspect.route, 'en')) || 'N/A',
    'G.k.7.r.2b (Indication as reported)': suspect.indication || 'N/A',
    'G.k.8 (Action taken with drug)': label(ACTION_TAKEN_OPTIONS, suspect.actionTaken, 'en') || 'N/A',
    'G.k.9.i.2.r.3 (Result of assessment / causality)': label(CAUSALITY_OPTIONS, r.triage?.causality || '', 'en') || 'N/A（待後台評估）',
    'G.k.9.i.4 (Did reaction recur on re-administration?)': label(YES_NO_UNK_OPTIONS, suspect.rechallenge, 'en') || 'N/A',
    'H.1 (Case narrative)': r.narrative || autoNarrative(r, todayIso),
  };
  // 嚴重性準則逐項展開，讓電子送件端可直接對應布林旗標
  for (const c of SERIOUSNESS_CRITERIA) {
    map[`${c.e2b} (${c.en})`] = criteria.includes(c.value) ? 'Yes' : 'No';
  }
  return map;
}

const csvCell = (v: any) => {
  let s = String(v ?? '');
  // 前導 = + - @ 會被 Excel 當公式執行：加單引號中和，防止 CSV 注入
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

/** 匯出後台個案清單為 CSV（稽核與月報用）。 */
export function aeReportsToCSV(reports: AEReport[], todayIso = ''): string {
  const headers = [
    '個案編號', '狀態', '報告類型', '原案編號', '重要新資訊', '期限依據',
    '首次獲知日(Day0)', '法定到期日', '剩餘天數', '嚴重性',
    '嚴重性準則', '預期性', '因果關係', '完整度%', '四要素齊備',
    '病人縮寫', '性別', '年齡', '國別', '境外個案',
    '不良反應(Verbatim)', 'MedDRA PT', 'MedDRA SOC', '發生日', '結果',
    '懷疑藥品', '成分', '批號', '劑量', '途徑', '適應症', '用藥起', '用藥迄', '停藥後改善', '再投與再現',
    '併用藥品', '病史',
    '業務通報人', '工號', '轄區', '通報來源', '原始通報者', '原始通報者單位',
    '來源端獲知日', '送件時間', '主管機關回執', '轉報原廠日', '原廠個案編號', '建立時間', '更新時間',
  ];
  const rows = (reports || []).map(r => {
    const clock = computeRegulatoryClock(r, todayIso);
    const { serious, criteria } = assessSeriousness(r);
    const min = checkMinimumCriteria(r);
    const ev = (r.events || []).find(e => has(e.verbatim)) || emptyEvent();
    const sd = (r.drugs || []).find(d => d.isSuspect) || emptyDrug();
    const con = (r.drugs || []).filter(d => !d.isSuspect).map(d => d.brandName || d.activeIngredient).filter(Boolean).join('; ');
    return [
      r.caseNumber, r.status, r.reportType, r.followUpOf,
      r.reportType === 'follow_up' ? (r.hasSignificantNewInfo ? 'Y' : 'N') : '',
      clock.basis,
      r.awarenessDate, clock.dueDate,
      clock.daysRemaining ?? '', serious ? '嚴重' : '非嚴重',
      criteria.map(c => label(SERIOUSNESS_CRITERIA as any, c)).join('; '),
      label(EXPECTEDNESS_OPTIONS, r.triage?.expectedness || ''),
      label(CAUSALITY_OPTIONS, r.triage?.causality || ''),
      computeCompleteness(r), min.valid ? 'Y' : 'N',
      r.patientInitials, label(SEX_OPTIONS, r.patientSex), patientAgeText(r, todayIso),
      countryText(r), isForeignCase(r) ? 'Y' : 'N',
      ev.verbatim, ev.meddraPt || '', ev.meddraSoc || '', ev.onsetDate, label(OUTCOME_OPTIONS, ev.outcome),
      sd.brandName, sd.activeIngredient, sd.lotNumber, sd.dailyDose,
      sd.route === 'other' ? sd.routeOther : label(ROUTE_OPTIONS, sd.route),
      sd.indication, sd.therapyStart, sd.therapyEnd,
      label(YES_NO_UNK_OPTIONS, sd.dechallenge), label(YES_NO_UNK_OPTIONS, sd.rechallenge),
      con, r.medicalHistory,
      r.reporterName, r.reporterEmployeeId, r.reporterTerritory,
      label(REPORT_SOURCE_OPTIONS, r.reportSource), r.primaryReporterName, r.primaryReporterOrg,
      r.sourceAwarenessDate || '',
      r.triage?.submittedToAuthorityAt || '', r.triage?.authorityReceiptNo || '',
      r.triage?.transmittedToMahAt || '', r.triage?.mahCaseNumber || '',
      r.createdAt, r.updatedAt,
    ].map(csvCell).join(',');
  });
  // BOM 讓 Excel 正確辨識 UTF-8
  return '﻿' + [headers.map(csvCell).join(','), ...rows].join('\n');
}

/**
 * 將 AE 個案轉為訊號聚合層（services/signals.ts）可吃的形狀。
 * 讓自發性通報與文獻個案共用同一套「成分 × MedDRA PT」訊號分析。
 */
export function aeToSignalRecords(reports: AEReport[]): any[] {
  const out: any[] = [];
  for (const r of reports || []) {
    if (r.status === 'invalid' || r.status === 'draft') continue;
    const suspects = (r.drugs || []).filter(d => d.isSuspect);
    const { serious } = assessSeriousness(r);
    for (const d of suspects) {
      const ingredient = (d.activeIngredient || d.brandName || '').trim();
      if (!ingredient) continue;
      for (const e of r.events || []) {
        const term = (e.meddraPt || e.verbatim || '').trim();
        if (!term) continue;
        out.push({
          id: `${r.id}:${d.id}:${e.id}`,
          source: 'spontaneous',
          pmid: r.caseNumber || r.id,
          original_search_term: ingredient,
          pv_data: {
            ingredient,
            product: d.brandName || ingredient,
            ae_verbatim: e.verbatim,
            meddra_pt_candidate: term,
            seriousness: serious ? 'serious' : 'non-serious',
            causality: r.triage?.causality || '',
          },
        });
      }
    }
  }
  return out;
}
