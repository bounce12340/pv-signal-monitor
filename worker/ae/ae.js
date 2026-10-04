// PV-Link 不良反應個案（AE）收案 API — Cloudflare Worker 端。
//
// 端點（全部掛在 /api/ae-reports 之下，並由 index.js 先驗過 Cloudflare Access JWT）：
//   GET    /api/ae-reports                          列出個案（不含附件本體）
//   POST   /api/ae-reports                          送出／覆寫個案（業務通報、追蹤報告）
//   GET    /api/ae-reports/:id                      取單一個案（含稽核軌跡）
//   PATCH  /api/ae-reports/:id                      後台判定更新
//   DELETE /api/ae-reports/:id                      軟刪除（標記作廢，軌跡永遠留著）
//   GET    /api/ae-reports/:id/attachments/:attId   取附件本體（R2）
//   GET    /api/me                                  目前登入者的 email、角色與個人檔案
//   PUT    /api/me                                  更新自己的個人檔案（不含角色）
//
// 貫穿全檔的三條規則：
//   1. **actor 一律取自已驗證的 Access JWT，永不採信請求內容。** 前端送來的
//      auditTrail[].actor 一概忽略並改寫。稽核軌跡若能被前端自報身分，就等於沒有軌跡。
//   2. **個案不做實體刪除。** DELETE 只寫 deleted_at；稽核軌跡表另有資料庫層 trigger
//      擋掉任何 UPDATE / DELETE。
//   3. **分權在這裡執行，不在前端。** 業務（rep）只讀得到自己送的個案，
//      藥安人員（pv）讀寫全部。前端的頁面切換只是體驗，不是防線——
//      任何人都能直接打 API，所以每一條路由都自己檢查角色。

import { handleWork } from './work.js';
import { WORK_FIELDS } from '../../services/ae/caseWorkModel.js';

const MAH_SERIOUS_REPORT_DAYS = 15;

// ── 由 payload 推導索引欄位 ─────────────────────────────────────────────
//
// ⚠️ 這裡的嚴重性與到期日規則是 services/aeReport.ts 的鏡像，用途僅為建立
// 查詢／排序索引（個案本體以 payload 為準，前端顯示時會自行重算）。
// 兩邊若漂移，收件匣的時限排序就會失準——tests/worker.test.ts 有交叉比對測試，
// 規則改了而這裡沒跟上，測試會直接失敗。
export function deriveSerious(report) {
  const override = report?.triage?.seriousnessOverride;
  if (override === 'serious') return true;
  if (override === 'non_serious') return false;
  return (report?.events || []).some(
    (e) => Array.isArray(e?.seriousnessCriteria) && e.seriousnessCriteria.length > 0
  );
}

/** 以 UTC 解析 YYYY-MM-DD；格式不符或日期溢位（如 2026-02-30）回 null。 */
export function parseIsoDate(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function addDays(iso, days) {
  const dt = parseIsoDate(iso);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 法定到期日；無快速通報義務時回 null（非嚴重、缺 Day 0、未帶新資訊的追蹤報告）。 */
export function deriveDueDate(report) {
  if (!deriveSerious(report)) return null;
  if (report?.reportType === 'follow_up' && !report?.hasSignificantNewInfo) return null;
  return addDays(report?.awarenessDate, MAH_SERIOUS_REPORT_DAYS);
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 從個案 payload 取出要落成資料行的索引欄位。 */
export function indexColumns(report) {
  const suspect = (report?.drugs || []).find((d) => d?.isSuspect) || {};
  return {
    case_number: str(report?.caseNumber),
    status: str(report?.status) || 'submitted',
    report_type: report?.reportType === 'follow_up' ? 'follow_up' : 'initial',
    follow_up_of_id: str(report?.followUpOfId) || null,
    awareness_date: str(report?.awarenessDate) || null,
    due_date: deriveDueDate(report),
    serious: deriveSerious(report) ? 1 : 0,
    country: str(report?.country) || null,
    suspect_drug: str(suspect.brandName || suspect.activeIngredient) || null,
    patient_key: str(report?.patientInitials || report?.patientId).toLowerCase().trim() || null,
  };
}

// ── 角色與權限 ──────────────────────────────────────────────────────────
//
// 這一段刻意全是純函式（唯一的 I/O 是 resolveRole 查表），
// 好讓權限規則能被單元測試逐條驗證，而不是只能靠部署後手動點點看。

/** email 比對一律小寫去空白：JWT 的大小寫不保證與資料表一致。 */
export const normalizeEmail = (v) => str(v).trim().toLowerCase();

/**
 * 正規化角色。**任何無法辨識的值都降級為 rep**——包含 null、空字串、拼錯的字串。
 * 這個預設值是刻意選的：設定漏了會讓人「看不到全部個案」（會有人來反映），
 * 而不是「看得到全部個案」（沒人會來反映）。
 */
export const normalizeRole = (v) => (str(v).trim().toLowerCase() === 'pv' ? 'pv' : 'rep');

/**
 * 開機用的藥安人員清單（環境變數 AE_PV_EMAILS，逗號分隔）。
 *
 * 為什麼需要它：ae_users 一開始是空的，若只認資料表，第一個藥安人員永遠設不進去
 * ——沒有人有權限去新增第一個有權限的人。這是典型的開機死結。
 * 請用 `wrangler secret put AE_PV_EMAILS` 設定，別寫進 wrangler.toml（那會進 git）。
 */
export function bootstrapRole(email, listRaw) {
  const target = normalizeEmail(email);
  if (!target) return null;
  const list = str(listRaw).split(',').map(normalizeEmail).filter(Boolean);
  return list.includes(target) ? 'pv' : null;
}

/**
 * rep 只看得到自己送的個案；pv 看全部。
 *
 * 兩邊都必須是非空字串才算相符：否則「沒有 actor」對上「沒有 submitted_by」
 * 會因為 '' === '' 而放行。路由層雖已擋掉空 actor，但這個函式是獨立可測的
 * 權限判斷，不該把安全性押在呼叫端記得先檢查。
 */
export function canReadCase(role, actor, row) {
  if (!row) return false;
  if (role === 'pv') return true;
  if (row.deleted_at) return false;
  const owner = normalizeEmail(row.submitted_by);
  const me = normalizeEmail(actor);
  return Boolean(owner) && Boolean(me) && owner === me;
}

/**
 * rep 是否可以覆寫一筆已存在的個案。
 *
 * 放行的唯一情境是「自己送的、而且藥安還沒動過」：離線 outbox 補送時，
 * 前一次 POST 可能其實已經寫進去只是回應沒收到，重送必須成功而非報錯。
 * 一旦藥安開始處理（狀態離開 draft/submitted），通報者就不能再覆寫——
 * 否則業務按一下重送，就把藥安的判定與編碼整份洗掉。
 */
export function canRepOverwrite(actor, row) {
  if (!row) return true; // 新個案
  const owner = normalizeEmail(row.submitted_by);
  const me = normalizeEmail(actor);
  if (!owner || !me || owner !== me) return false;   // 同上：空字串不算相符
  return row.status === 'submitted' || row.status === 'draft';
}

// ── 通報者個人檔案 ──────────────────────────────────────────────────────
//
// CIOMS 表格裡「誰通報的」那一段，對同一位業務每次都一樣。存在個案裡，
// 等於每通報一次就要重打六個欄位——手機上這是第一屏就讓人放棄的主因。
// 改為首次登入建檔一次，之後由前端自動帶入。
//
// ⚠️ 這是**顯示用**資料，不是身分憑證。「誰送的」永遠以 ae_cases.submitted_by
// （取自 Access JWT）為準；使用者把這裡的姓名改成同事的名字，也動不了那個欄位。

/**
 * 允許使用者自行修改的欄位。**白名單而非黑名單**：
 * 用黑名單的話，日後資料表新增敏感欄位（例如 role）而有人忘了加進排除清單，
 * 就會變成使用者可以自己升級成藥安人員。白名單漏掉的後果只是「某欄位改不了」。
 */
export const PROFILE_FIELDS = ['display_name', 'employee_id', 'phone', 'contact_email', 'org', 'territory'];

/** 從請求內容挑出可寫欄位並修剪空白；未提供的欄位回傳 undefined（代表不更動）。 */
export function sanitizeProfile(input) {
  const out = {};
  for (const key of PROFILE_FIELDS) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) {
      out[key] = str(input[key]).trim().slice(0, 200);
    }
  }
  return out;
}

/**
 * 檔案是否算完成。
 *
 * 只認姓名與電話兩項，因為這正是 validateAEReport 對通報者的硬性要求
 * （四要素之一「可辨識的通報者」＋至少一個聯絡方式）。門檻訂得比驗證規則高，
 * 只會擋住一個其實可以送出通報的人——業務在客戶端遇到不良反應時，
 * 讓他填不完的資料卡住通報，比少一個轄區欄位嚴重得多。
 */
export function isProfileComplete(row) {
  return Boolean(str(row?.display_name).trim()) && Boolean(str(row?.phone).trim());
}

/** 資料列 → 前端要的檔案物件。查無此人時回傳空白檔案，不是 null。 */
export function rowToProfile(row, defaults = {}) {
  return {
    displayName: str(row?.display_name),
    employeeId: str(row?.employee_id),
    phone: str(row?.phone),
    contactEmail: str(row?.contact_email),
    // 公司名稱對全公司都一樣，可由環境變數預設，省下每個人打一次也少一種打錯的方式
    org: str(row?.org) || str(defaults.org),
    territory: str(row?.territory),
  };
}

async function loadUserRow(env, email) {
  try {
    return await env.DB.prepare(`SELECT * FROM ae_users WHERE email = ?`).bind(normalizeEmail(email)).first();
  } catch (e) {
    console.log('loadUserRow failed:', e?.message || e);
    return null;
  }
}

/**
 * 寫入個人檔案。角色**不在**可寫欄位內：既有使用者沿用原角色，
 * 新使用者一律建為 rep。使用者自己建檔永遠不可能建出一個藥安人員。
 */
async function saveProfile(env, email, patch) {
  const key = normalizeEmail(email);
  const now = new Date().toISOString();
  const existing = await loadUserRow(env, key);
  const merged = { ...(existing || {}), ...patch };

  if (existing) {
    const sets = PROFILE_FIELDS.map((f) => `${f} = ?`).join(', ');
    await env.DB.prepare(`UPDATE ae_users SET ${sets}, updated_at = ? WHERE email = ?`)
      .bind(...PROFILE_FIELDS.map((f) => str(merged[f]) || null), now, key).run();
  } else {
    const cols = PROFILE_FIELDS.join(', ');
    const marks = PROFILE_FIELDS.map(() => '?').join(', ');
    await env.DB.prepare(
      `INSERT INTO ae_users (email, role, ${cols}, created_at, created_by, updated_at)
       VALUES (?, 'rep', ${marks}, ?, ?, ?)`
    ).bind(key, ...PROFILE_FIELDS.map((f) => str(merged[f]) || null), now, key, now).run();
  }
  return await loadUserRow(env, key);
}

/** 查角色：bootstrap 清單優先，其次 ae_users，查無此人一律 rep。worker/index.ts 的 LLM 代理也用它。 */
export async function resolveRole(env, email) {
  const boot = bootstrapRole(email, env.AE_PV_EMAILS);
  if (boot) return boot;
  try {
    const row = await env.DB.prepare(`SELECT role FROM ae_users WHERE email = ?`)
      .bind(normalizeEmail(email)).first();
    return normalizeRole(row?.role);
  } catch (e) {
    // ae_users 還沒建（schema 未更新）時不應整個 API 掛掉，但也不能因此放寬權限。
    console.log('resolveRole failed, defaulting to rep:', e?.message || e);
    return 'rep';
  }
}

// ── 附件：把 dataURL 搬到 R2 ─────────────────────────────────────────────

function dataUrlToBytes(dataUrl) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  const [, mime, isB64, data] = m;
  if (isB64) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: mime || 'application/octet-stream', bytes };
  }
  return { mime: mime || 'text/plain', bytes: new TextEncoder().encode(decodeURIComponent(data)) };
}

/**
 * 把 payload.attachments 裡夾帶的 dataURL 搬進 R2，payload 只留下指標。
 *
 * 這樣做的理由：一張壓縮後的藥盒照 300KB–1.5MB，若留在 payload 裡，
 * 每次讀個案（收件匣列表也算）都會把它一起拖出來，而且 D1 有單列大小限制。
 * 前端不需要為此多送一次請求——送出仍是單一 POST。
 */
async function offloadAttachments(env, caseId, report, actor, nowIso, mutationId, statements) {
  const list = Array.isArray(report?.attachments) ? report.attachments : [];
  if (!list.length) return list;
  if (!env.AE_FILES) {
    if (list.some(a => a?.dataUrl)) throw new HttpError(503, 'attachment storage unavailable');
    return list;
  }

  const kept = [];
  for (const a of list) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new HttpError(400, 'invalid attachment');
    if (!a?.dataUrl) {
      // Only retain a canonical pointer already registered to this exact case.
      if (typeof a.id !== 'string' || !a.id.trim() || a.url !== `/api/ae-reports/${caseId}/attachments/${a.id}`) throw new HttpError(400, 'invalid attachment reference');
      const owned = await env.DB.prepare(`SELECT id FROM ae_attachments WHERE id=? AND case_id=? AND deleted_at IS NULL`).bind(a.id, caseId).first();
      if (!owned) throw new HttpError(400, 'unknown attachment reference');
      kept.push({ ...a, url: `/api/ae-reports/${caseId}/attachments/${a.id}` });
      continue;
    }
    let decoded;
    try { decoded = dataUrlToBytes(a.dataUrl); } catch { /* invalid encoding */ }
    if (!decoded) throw new HttpError(400, 'invalid attachment data');
    if (typeof a.id !== 'string' || !a.id.trim()) throw new HttpError(400, 'missing attachment id');
    const detected = decoded.bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((b,i)=>decoded.bytes[i]===b) ? 'image/png'
      : decoded.bytes[0]===0xff && decoded.bytes[1]===0xd8 && decoded.bytes[2]===0xff ? 'image/jpeg'
      : new TextDecoder().decode(decoded.bytes.slice(0,5)) === '%PDF-' ? 'application/pdf' : '';
    if (!detected || decoded.mime.toLowerCase() !== detected || (a.mime && String(a.mime).toLowerCase() !== detected)) throw new HttpError(400, 'unsupported or mismatched attachment format');
    const owner = await env.DB.prepare(`SELECT case_id FROM ae_attachments WHERE id = ?`).bind(a.id).first();
    if (owner && owner.case_id !== caseId) throw new HttpError(409, 'attachment id already in use');

    // Immutable object key: failed SQL must not overwrite a previously committed file.
    const key = `${caseId}/${a.id}/${crypto.randomUUID()}`;
    await env.AE_FILES.put(key, decoded.bytes, { httpMetadata: { contentType: detected } });
    statements.push(env.DB.prepare(
      `INSERT INTO ae_attachments (id, case_id, r2_key, name, mime, size, added_at, added_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM ae_cases WHERE id=? AND last_mutation_id=?)
       ON CONFLICT(id) DO UPDATE SET r2_key=excluded.r2_key, name=excluded.name, mime=excluded.mime, size=excluded.size
       WHERE ae_attachments.case_id=excluded.case_id`
    ).bind(a.id, caseId, key, str(a.name).replace(/[\\r\\n]/g, '').slice(0,200), detected, decoded.bytes.length, str(a.addedAt) || nowIso, actor, caseId, mutationId));

    kept.push({ id: a.id, name: str(a.name).replace(/[\\r\\n]/g, '').slice(0,200), mime: detected, size: decoded.bytes.length, addedAt: a.addedAt || nowIso, url: `/api/ae-reports/${caseId}/attachments/${a.id}` });
  }
  return kept;
}

// ── 稽核軌跡 ────────────────────────────────────────────────────────────

/**
 * 寫入稽核軌跡。actor 由呼叫端傳入已驗證的身分，**不從 entries 取**。
 * 前端送來的 auditTrail 只借用它的 action/detail/at，身分一律改寫。
 */
function auditStatements(env, caseId, actor, entries) {
  const rows = (entries || []).filter((e) => e && e.action);
  return rows.map((e) => env.DB.prepare(
    `INSERT INTO ae_audit (case_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)`
  ).bind(caseId, str(e.at) || new Date().toISOString(), actor, str(e.action), str(e.detail) || null));
}

async function loadAudit(env, caseId) {
  const { results } = await env.DB.prepare(
    `SELECT at, actor, action, detail FROM ae_audit WHERE case_id = ? ORDER BY seq ASC`
  ).bind(caseId).all();
  return (results || []).map((r) => ({
    at: r.at, actor: r.actor, action: r.action, detail: r.detail || undefined,
  }));
}

// ── 個案的讀寫 ──────────────────────────────────────────────────────────

/** 把資料列還原成前端要的 AEReport；稽核軌跡以資料庫為準覆蓋 payload 裡的版本。 */
function rowToReport(row, audit) {
  let report;
  try {
    report = JSON.parse(row.payload);
    for (const key of WORK_FIELDS) delete report[key];
  } catch {
    return null;
  }
  return {
    ...report,
    id: row.id,
    // 個案編號以欄位為準（由 upsertCase 配發、之後不可改），不信 payload 裡的值。
    caseNumber: row.case_number,
    status: row.status,
    version: Number(row.version || 0),
    auditTrail: audit,
    // 伺服器側事實，前端唯讀
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 列出個案。**過濾寫在 SQL 的 WHERE 裡，不是取出全部再於 JS 篩掉**——
 * 後者只要哪天有人改了迴圈就會整份外洩，而且真的把別人的病人資料讀進了記憶體。
 */
async function listCases(env, url, role, actor) {
  // include_deleted 只對藥安人員有意義；業務端一律看不到已作廢個案。
  const includeDeleted = role === 'pv' && url.searchParams.get('include_deleted') === '1';
  const requestedLimit = Number(url.searchParams.get('limit') || '500');
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit) || 1, 1000) : 500;

  const where = [];
  const binds = [];
  if (!includeDeleted) where.push('deleted_at IS NULL');
  if (role !== 'pv') { where.push('LOWER(submitted_by) = ?'); binds.push(normalizeEmail(actor)); }

  const { results } = await env.DB.prepare(
    `SELECT * FROM ae_cases
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (due_date IS NULL) ASC, due_date ASC, created_at DESC
      LIMIT ?`
  ).bind(...binds, limit).all();

  const cases = [];
  for (const row of results || []) {
    const report = rowToReport(row, await loadAudit(env, row.id));
    if (report) cases.push(report);
  }
  return cases;
}

/**
 * Rebuild a rep payload from the public AEReport contract.  This is a
 * whitelist: unknown keys and all PV adjudication/coding fields cannot enter
 * storage merely because a future client sends them.
 */
const REP_STRING_FIELDS = [
  'id','caseNumber','reportType','followUpOf','followUpOfId','reporterName','reporterEmployeeId',
  'reporterPhone','reporterEmail','reporterOrg','reporterTerritory','reportSource','primaryReporterName',
  'primaryReporterProfession','primaryReporterOrg','primaryReporterContact','awarenessDate','sourceAwarenessDate','reportDate',
  'country','countryOther','patientInitials','patientId','patientBirthDate','patientAgeValue','patientAgeUnit',
  'patientSex','patientWeightKg','patientHeightCm','pregnancy','lastMenstrualPeriod','labData','narrative',
  'deathDate','causeOfDeath','autopsyDone','medicalHistory','allergies',
];
const REP_EVENT_STRING_FIELDS = ['id','verbatim','onsetDate','endDate','outcome'];
const REP_DRUG_STRING_FIELDS = ['id','brandName','activeIngredient','lotNumber','expiryDate','licenseNo','dailyDose','route','routeOther','indication','therapyStart','therapyEnd','therapyDuration','dechallenge','rechallenge','actionTaken'];
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const repString = (value, max = 20000) => str(value).trim().slice(0, max);

export function sanitizeRepReport(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!source) throw new HttpError(400, 'invalid report');
  if (!Array.isArray(source.events) || !Array.isArray(source.drugs)) throw new HttpError(400, 'invalid report collections');
  const out = { status: 'submitted', triage: {} };
  for (const key of REP_STRING_FIELDS) if (own(source, key)) out[key] = repString(source[key]);
  // These booleans are reporter facts, not PV adjudication. Preserve false as
  // well as true; truthiness would silently discard a legitimate "no" answer.
  if (own(source, 'hasSignificantNewInfo')) out.hasSignificantNewInfo = source.hasSignificantNewInfo === true;
  if (own(source, 'primaryReporterConsentFollowUp')) out.primaryReporterConsentFollowUp = source.primaryReporterConsentFollowUp === true;
  out.events = source.events.slice(0, 100).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new HttpError(400, 'invalid event');
    const event = {};
    for (const key of REP_EVENT_STRING_FIELDS) if (own(entry, key)) event[key] = repString(entry[key]);
    event.seriousnessCriteria = Array.isArray(entry.seriousnessCriteria)
      ? entry.seriousnessCriteria.filter(v => typeof v === 'string').slice(0, 20) : [];
    return event;
  });
  const eventIds = out.events.map(event => event.id);
  if (eventIds.some(id => !id) || new Set(eventIds).size !== eventIds.length) throw new HttpError(400, 'event ids must be unique');
  out.drugs = source.drugs.slice(0, 100).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new HttpError(400, 'invalid drug');
    const drug = { isSuspect: entry.isSuspect === true };
    for (const key of REP_DRUG_STRING_FIELDS) if (own(entry, key)) drug[key] = repString(entry[key]);
    return drug;
  });
  out.attachments = Array.isArray(source.attachments) ? source.attachments : [];
  out.auditTrail = Array.isArray(source.auditTrail) ? source.auditTrail : [];
  // Version is a transport-only CAS token and must never be persisted.
  if (own(source, 'version')) out.version = source.version;
  return out;
}

/** Rep retries may edit uncoded reporter facts, but cannot remove, rename or
 * change the reporter meaning of an event that PV has coded. */
function preserveCodedRepEvents(prior, proposed) {
  const oldEvents = Array.isArray(prior?.events) ? prior.events : [];
  const nextById = new Map((proposed || []).map(event => [event.id, event]));
  for (const oldEvent of oldEvents) {
    if (!oldEvent || typeof oldEvent !== 'object') continue;
    const coded = own(oldEvent, 'meddraPt') || own(oldEvent, 'meddraSoc') || own(oldEvent, 'meddraVerified');
    if (!coded) continue;
    const next = nextById.get(String(oldEvent.id));
    if (!next) throw new HttpError(409, 'coded event cannot be removed or renamed by reporter retry');
    for (const field of [...REP_EVENT_STRING_FIELDS, 'seriousnessCriteria']) {
      if (JSON.stringify(next[field] ?? '') !== JSON.stringify(oldEvent[field] ?? '')) {
        throw new HttpError(409, 'coded event meaning cannot be changed by reporter retry');
      }
    }
    next.meddraPt = oldEvent.meddraPt;
    next.meddraSoc = oldEvent.meddraSoc;
    next.meddraVerified = oldEvent.meddraVerified;
  }
  return proposed;
}

// ── 個案編號 ─────────────────────────────────────────────────────────────
//
// 由這裡配號，前端送來的 caseNumber 一律不採用。PV-Link 原本在前端以「看得到的個案」算下一號，
// 但業務手機看不到別人的個案，等於每次從空清單起算，業務送出的個案都會配到 PV-<年>-0001。
//
//   • 新個案：PV-<台北年>-<該年最大號 +1，4 位數>。取最大號與寫入在**同一個 INSERT 敘述**裡，
//     SQLite／D1 單一敘述是原子的，兩筆同時送出也不會拿到同一號。
//   • PV 建立的追蹤報告（followUpOfId 指向既有個案）：<母案編號>-F<既有追蹤數 +1>，沿用後台原本的慣例。
//     業務送出的不採用 followUpOfId 配號：否則業務可以把個案掛到別人的母案上、從回應讀到別人的編號。
//   • 既有個案：編號不可改（UPDATE 不寫 case_number）。編號可能已經寫進送主管機關的報告。
//
// 既有的重號資料不在這裡處理：改號會讓已送出的報告對不上，要由藥安人員逐案決定（見 docs/ae-integration-plan.md）。
// 新號取「該年最大號 +1」，所以不會再跟既有的 0001 撞號。
export const CASE_NUMBER_PREFIX = 'PV';

/** Asia/Taipei 的西元年。1/1 台北凌晨 0–8 點（UTC 還是前一年）送出的個案也要算新年度。 */
export function taipeiYear(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(date);
}

/** INSERT 用的配號運算式與它的參數（依 ? 出現順序）。 */
function caseNumberSql(parentId, year) {
  const head = `${CASE_NUMBER_PREFIX}-${year}-`;
  return {
    sql: `COALESCE(
      (SELECT p.case_number || '-F' || ((SELECT COUNT(*) FROM ae_cases c WHERE c.follow_up_of_id = p.id) + 1)
         FROM ae_cases p WHERE p.id = ? AND p.case_number <> ''),
      ? || printf('%04d', COALESCE((SELECT MAX(CAST(substr(case_number, ?) AS INTEGER)) FROM ae_cases WHERE case_number GLOB ?), 0) + 1)
    )`,
    binds: [parentId, head, head.length + 1, `${head}[0-9]*`],
  };
}

async function upsertCase(env, report, actor, { role = 'pv', expectedVersion }) {
  const now = new Date().toISOString();
  const mutationId = crypto.randomUUID();
  const id = str(report?.id);
  if (!id) throw new HttpError(400, 'missing case id');
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new HttpError(400, 'invalid report');
  for (const field of ['events', 'drugs', 'attachments', 'auditTrail']) if (report[field] !== undefined && !Array.isArray(report[field])) throw new HttpError(400, `invalid ${field}`);

  const existing = await env.DB.prepare(`SELECT id, deleted_at, payload, case_number FROM ae_cases WHERE id=?`).bind(id).first();
  if (existing?.deleted_at) throw new HttpError(409, 'case is deleted');
  const { auditTrail, version: _clientVersion, ...rest } = report;
  let persisted = { ...rest };
  if (role !== 'pv') {
    let prior = {};
    try { prior = existing ? JSON.parse(existing.payload) : {}; } catch { throw new HttpError(409, 'existing report cannot be safely retried'); }
    persisted = {
      ...persisted,
      status: 'submitted',
      triage: existing && prior.triage && typeof prior.triage === 'object' && !Array.isArray(prior.triage) ? prior.triage : {},
      events: preserveCodedRepEvents(prior, persisted.events),
    };
  }
  // 新個案先放空字串，寫入後由同一批次的 json_set 填入配發的編號；既有個案沿用原編號。
  persisted = { ...persisted, caseNumber: existing ? str(existing.case_number) : '' };
  const attachmentStatements = [];
  const attachments = await offloadAttachments(env, id, persisted, actor, now, mutationId, attachmentStatements);
  persisted = { ...persisted, attachments };
  const payload = JSON.stringify(persisted);
  const col = indexColumns(persisted);
  let caseStatement;
  if (existing) {
    const where = role === 'pv'
      ? `id=? AND deleted_at IS NULL AND version=?`
      : `id=? AND deleted_at IS NULL AND LOWER(submitted_by)=? AND status IN ('draft','submitted') AND version=?`;
    // case_number 刻意不在 SET 裡：編號一經配發就不可改。
    const binds = [payload,col.status,col.report_type,col.follow_up_of_id,col.awareness_date,col.due_date,col.serious,col.country,col.suspect_drug,col.patient_key,now,mutationId,id];
    if (role !== 'pv') binds.push(normalizeEmail(actor));
    binds.push(expectedVersion);
    caseStatement = env.DB.prepare(`UPDATE ae_cases SET payload=?,status=?,report_type=?,follow_up_of_id=?,awareness_date=?,due_date=?,serious=?,country=?,suspect_drug=?,patient_key=?,updated_at=?,last_mutation_id=?,version=version+1 WHERE ${where}`).bind(...binds);
  } else {
    // A concurrent id collision changes zero rows and returns 409; it never becomes an overwrite.
    const number = caseNumberSql(role === 'pv' ? str(persisted.followUpOfId) : '', taipeiYear(new Date(now)));
    caseStatement = env.DB.prepare(`INSERT OR IGNORE INTO ae_cases (id,payload,case_number,status,report_type,follow_up_of_id,awareness_date,due_date,serious,country,suspect_drug,patient_key,submitted_by,created_at,updated_at,last_mutation_id)
      SELECT ?,?,${number.sql},?,?,?,?,?,?,?,?,?,?,?,?,?`).bind(id,payload,...number.binds,col.status,col.report_type,col.follow_up_of_id,col.awareness_date,col.due_date,col.serious,col.country,col.suspect_drug,col.patient_key,actor,now,now,mutationId);
  }
  // 新個案：把剛配發的編號寫回 payload，讓 payload 與欄位一致（只動這次寫入的那一列）。
  const numberStatements = existing ? [] : [env.DB.prepare(
    `UPDATE ae_cases SET payload = json_set(payload, '$.caseNumber', case_number) WHERE id=? AND last_mutation_id=?`
  ).bind(id, mutationId)];
  const entries = [...(auditTrail || [])];
  if (!existing) entries.push({ at: now, action: 'received', detail: `由 ${actor} 送達後台` });
  const audits = entries.filter(e => e && e.action).map(e => env.DB.prepare(
    `INSERT INTO ae_audit (case_id,at,actor,action,detail)
     SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ae_cases WHERE id=? AND last_mutation_id=?)`
  ).bind(id,str(e.at)||now,actor,str(e.action),str(e.detail)||null,id,mutationId));
  const result = await env.DB.batch([caseStatement, ...numberStatements, ...attachmentStatements, ...audits]);
  if (!result?.[0]?.meta?.changes) throw new HttpError(409, 'case write conflict; reload and retry');
  const caseNumber = existing
    ? str(existing.case_number)
    : str((await env.DB.prepare(`SELECT case_number FROM ae_cases WHERE id=?`).bind(id).first())?.case_number);
  return { id, version: existing ? expectedVersion + 1 : 0, caseNumber };
}

// ── HTTP 處理 ───────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * AE API 路由。回傳 Response，或回傳 null 表示「這個路徑不歸我管」（交還給 LLM proxy）。
 * @param identity 已驗證的 Access JWT payload；未啟用 Access 時為 null（僅本機開發）
 */
export async function handleAeRequest(request, env, url, identity, cors) {
  const path = url.pathname.replace(/\/+$/, '');
  const isMe = path === '/api/me';
  if (!isMe && !path.startsWith('/api/ae-reports')) return null;

  if (!env.DB) {
    return json({ error: 'AE backend not configured: D1 binding "DB" is missing' }, 501, cors);
  }

  // 身分是這個 API 的地基：沒有可信身分，稽核軌跡就沒有意義，寧可整個拒絕服務。
  const actor = identity?.email || identity?.sub;
  if (!actor) {
    return json({ error: 'unauthorized: no verified identity' }, 401, cors);
  }

  const role = await resolveRole(env, actor);
  const forbidden = () => json({ error: 'forbidden: requires PV role' }, 403, cors);

  // /api/me —— 身分、角色與通報者個人檔案。
  // 前端據此決定顯示通報表單還是後台、以及要不要先請他建檔；
  // 真正的守門仍在每一條路由上，這裡回什麼都不影響權限。
  if (isMe) {
    // 自己的 try：這一段在下方個案路由的 try 之外，少了它，readJson 對格式錯誤
    // 丟出的 400 會逃逸成一個沒有內容的 500。
    try {
      const defaults = { org: env.AE_ORG_NAME };
      if (request.method === 'GET') {
        const row = await loadUserRow(env, actor);
        return json({
          email: actor, role,
          profile: rowToProfile(row, defaults),
          profileComplete: isProfileComplete(row),
        }, 200, cors);
      }
      if (request.method === 'PUT') {
        // 只寫自己的檔案：目標 email 取自 JWT，請求內容給不了。
        const patch = sanitizeProfile(await readJson(request));
        const row = await saveProfile(env, actor, patch);
        return json({
          ok: true, email: actor, role,
          profile: rowToProfile(row, defaults),
          profileComplete: isProfileComplete(row),
        }, 200, cors);
      }
      return json({ error: 'method not allowed' }, 405, cors);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.log('me api error:', e?.stack || e);
      return json({ error: 'internal error' }, 500, cors);
    }
  }

  const rest = path.slice('/api/ae-reports'.length);      // '' | '/:id' | '/:id/attachments/:attId'
  const seg = rest.split('/').filter(Boolean);
  if ((seg.length === 1 && ['work-users', 'workbench', 'notifications'].includes(seg[0])) || (seg.length === 2 && (seg[1] === 'work' || (seg[0] === 'notifications' && seg[1] === 'read')))) {
    return handleWork(request, env, seg, role, actor, cors);
  }

  try {
    // /api/ae-reports
    if (seg.length === 0) {
      if (request.method === 'GET') {
        return json({ cases: await listCases(env, url, role, actor) }, 200, cors);
      }
    if (request.method === 'POST') {
        const incoming = await readJson(request);
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return json({ error: 'invalid report' }, 400, cors);
        if (WORK_FIELDS.some(key => Object.prototype.hasOwnProperty.call(incoming, key))) {
          return json({ error: 'internal work requires dedicated endpoint' }, 400, cors);
        }
        let report = incoming;
        if (role !== 'pv') report = sanitizeRepReport(incoming);
        const id = str(report?.id);
        const current = await env.DB.prepare(`SELECT id,submitted_by,status,version,deleted_at FROM ae_cases WHERE id=?`).bind(id).first();
        if (current?.deleted_at) return json({ error: 'case is deleted' }, 409, cors);
        if (role !== 'pv' && current && !canRepOverwrite(actor,current)) return json({ error: 'forbidden: case already exists and is not yours to overwrite' }, 403, cors);
        // A retry is an update, not a server-side "latest version" overwrite.
        const expectedVersion = current ? report?.version : undefined;
        if (current && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) return json({ error: 'case version is required for retry' }, 409, cors);
        const saved = await upsertCase(env, report, actor, { role, expectedVersion });
        return json({ ok: true, id: saved.id, version: saved.version, caseNumber: saved.caseNumber }, current ? 200 : 201, cors);
      }
      return json({ error: 'method not allowed' }, 405, cors);
    }

    const caseId = seg[0];

    // /api/ae-reports/:id/attachments/:attId
    if (seg.length === 3 && seg[1] === 'attachments') {
      if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
      // 先確認這個人讀得到這個「個案」，才談附件——附件的權限跟著個案走。
      const owner = await env.DB.prepare(`SELECT submitted_by, deleted_at FROM ae_cases WHERE id = ?`).bind(caseId).first();
      if (!canReadCase(role, actor, owner)) return json({ error: 'not found' }, 404, cors);
      const row = await env.DB.prepare(
        `SELECT r2_key, mime, name FROM ae_attachments WHERE id = ? AND case_id = ? AND deleted_at IS NULL`
      ).bind(seg[2], caseId).first();
      if (!row || !env.AE_FILES) return json({ error: 'not found' }, 404, cors);
      const obj = await env.AE_FILES.get(row.r2_key);
      if (!obj) return json({ error: 'not found' }, 404, cors);
      return new Response(obj.body, {
        headers: {
          ...cors,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${String(row.name || 'attachment').replace(/[\\r\\n"\\\\]/g, '_').slice(0,120)}"`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
          'Cache-Control': 'no-store',
        },
      });
    }

    // /api/ae-reports/:id
    if (seg.length === 1) {
      if (request.method === 'GET') {
        const row = await env.DB.prepare(`SELECT * FROM ae_cases WHERE id = ?`).bind(caseId).first();
        // 讀不到別人的個案時回 404 而非 403：403 等於告訴對方「這個 id 存在」，
        // 個案編號是可猜的序號，這點差別足以讓人推敲出通報量。
        if (!row || !canReadCase(role, actor, row)) return json({ error: 'not found' }, 404, cors);
        return json({ case: rowToReport(row, await loadAudit(env, caseId)) }, 200, cors);
      }

      if (request.method === 'PATCH') {
        // 判定、編碼、送件都是藥安的工作；通報者送出後就不再改動個案。
        if (role !== 'pv') return forbidden();
        const row = await env.DB.prepare(`SELECT id FROM ae_cases WHERE id = ? AND deleted_at IS NULL`).bind(caseId).first();
        if (!row) return json({ error: 'not found' }, 404, cors);
      const report = await readJson(request);
        if (WORK_FIELDS.some(key => Object.prototype.hasOwnProperty.call(report || {}, key))) {
          return json({ error: 'internal work requires dedicated endpoint' }, 400, cors);
        }
        const saved = await upsertCase(env, { ...report, id: caseId }, actor, { role, expectedVersion: report?.version });
        return json({ ok: true, version: saved.version, caseNumber: saved.caseNumber }, 200, cors);
      }

      if (request.method === 'DELETE') {
        if (role !== 'pv') return forbidden();
        // 軟刪除。個案從收件匣消失，但列與稽核軌跡都留著，日後查核仍看得到發生過什麼。
        const reason = url.searchParams.get('reason') || '';
        const now = new Date().toISOString();
        const mutationId = crypto.randomUUID();
        const [res] = await env.DB.batch([env.DB.prepare(
          `UPDATE ae_cases SET deleted_at=?, deleted_by=?, deleted_reason=?, updated_at=?, last_mutation_id=?
           WHERE id=? AND deleted_at IS NULL`
        ).bind(now, actor, reason || null, now, mutationId, caseId), env.DB.prepare(
          `INSERT INTO ae_audit (case_id, at, actor, action, detail)
           SELECT ?, ?, ?, 'soft_deleted', ?
           WHERE EXISTS (SELECT 1 FROM ae_cases WHERE id=? AND last_mutation_id=?)`
        ).bind(caseId, now, actor, reason || '未填理由', caseId, mutationId)]);
        if (!res.meta?.changes) return json({ error: 'not found or already deleted' }, 404, cors);
        return json({ ok: true }, 200, cors);
      }

      return json({ error: 'method not allowed' }, 405, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
    console.log('ae api error:', e?.stack || e);
    return json({ error: 'internal error' }, 500, cors);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
