-- PV-Link 不良反應個案（AE）收案資料庫 — Cloudflare D1 (SQLite)
--
-- 套用方式：
--   npx wrangler d1 execute pv-link-ae --remote --file=worker/ae/schema.sql
--
-- ── 為什麼個案本體存 JSON 而非完全正規化 ───────────────────────────────────
-- AEReport 是一個會持續長出欄位的巢狀結構（events[]、drugs[]、triage、auditTrail…），
-- 而且前端已經有一整套經過單元測試的領域模型。若拆成十幾張表，就要維護兩份結構定義
-- 與雙向對映，欄位一改就漂移——這是這類系統最常見的長期債。
--
-- 因此：個案本體以 JSON 存於 payload（單一真實來源），只把**實際會查詢／排序／索引**
-- 的欄位展開成資料行。個案量級為一年數百至數千筆，這個取捨在效能上毫無壓力。
--
-- 例外是稽核軌跡：它必須獨立成表且只增不改（見 ae_audit 的說明）。

PRAGMA foreign_keys = ON;

-- ── 個案 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ae_cases (
  id                TEXT PRIMARY KEY,
  case_number       TEXT NOT NULL,
  -- 個案本體（AEReport 的 JSON）。前端寫什麼、讀回什麼，不做欄位對映。
  payload           TEXT NOT NULL,

  -- 以下皆由伺服器從 payload 展開，供查詢與排序使用；不接受前端直接指定。
  status            TEXT NOT NULL,
  report_type       TEXT NOT NULL DEFAULT 'initial',
  follow_up_of_id   TEXT,
  awareness_date    TEXT,              -- Day 0；法定時鐘的起點
  due_date          TEXT,              -- 嚴重個案的法定到期日；非嚴重為 NULL
  serious           INTEGER NOT NULL DEFAULT 0,
  country           TEXT,
  suspect_drug      TEXT,              -- 首個懷疑藥品，供收件匣列表顯示
  patient_key       TEXT,              -- 病人縮寫／代號，供重複偵測初篩

  -- 誰送的：一律取自已驗證的 Access JWT，前端無法指定
  submitted_by      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 0,
  -- Request-unique server token binds a successful case write to dependent SQL.
  -- Never client supplied or time-derived.
  last_mutation_id  TEXT,

  -- 軟刪除：個案不做實體刪除，否則稽核軌跡會跟著消失
  deleted_at        TEXT,
  deleted_by        TEXT,
  deleted_reason    TEXT
);

-- 收件匣的預設排序是「法定時限壓力」，因此索引建在到期日與嚴重性上。
CREATE INDEX IF NOT EXISTS idx_ae_cases_due      ON ae_cases (deleted_at, serious, due_date);
CREATE INDEX IF NOT EXISTS idx_ae_cases_status   ON ae_cases (deleted_at, status);
CREATE INDEX IF NOT EXISTS idx_ae_cases_chain    ON ae_cases (follow_up_of_id);
CREATE INDEX IF NOT EXISTS idx_ae_cases_number   ON ae_cases (case_number);
-- 重複偵測的初篩：先用病人鍵縮小範圍，再交給前端的加權比對
CREATE INDEX IF NOT EXISTS idx_ae_cases_patient  ON ae_cases (deleted_at, patient_key);

-- ── 稽核軌跡（只增不改）──────────────────────────────────────────────────
--
-- 這張表刻意獨立於 ae_cases.payload 之外，原因有三：
--   1. 個案 payload 每次更新都是整份覆寫；軌跡若混在裡面，一次寫壞就全沒了。
--   2. actor 必須是伺服器從已驗證 JWT 取得的身分。放在 payload 裡等於讓前端自報身分，
--      稽核上完全不成立——這正是先前版本 actor 寫死預設值的那個缺口。
--   3. GxP 要求軌跡不可竄改。應用層一律只 INSERT，永不 UPDATE / DELETE；
--      下方 trigger 把這件事釘死在資料庫層，不依賴應用程式自律。
CREATE TABLE IF NOT EXISTS ae_audit (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    TEXT NOT NULL,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,   -- 來自 Access JWT 的 email
  action     TEXT NOT NULL,
  detail     TEXT,
  FOREIGN KEY (case_id) REFERENCES ae_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_ae_audit_case ON ae_audit (case_id, seq);

-- 資料庫層的不可竄改保證：任何 UPDATE / DELETE 直接中止交易。
-- 即使日後有人寫錯應用程式碼，或有人拿到 DB 憑證想改紀錄，都會被擋下。
CREATE TRIGGER IF NOT EXISTS trg_ae_audit_no_update
BEFORE UPDATE ON ae_audit
BEGIN
  SELECT RAISE(ABORT, 'audit trail is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_ae_audit_no_delete
BEFORE DELETE ON ae_audit
BEGIN
  SELECT RAISE(ABORT, 'audit trail is append-only');
END;

-- ── 附件（metadata 在此，檔案本體在 R2）──────────────────────────────────
--
-- 照片不進資料庫：一張壓縮後的藥盒照約 300KB–1.5MB，塞進 D1 會讓每次讀取個案
-- 都拖著它跑，且 D1 有列大小限制。R2 存 blob、D1 只留指標，是這類資料的正解。
CREATE TABLE IF NOT EXISTS ae_attachments (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  name        TEXT,
  mime        TEXT,
  size        INTEGER,
  added_at    TEXT NOT NULL,
  added_by    TEXT NOT NULL,   -- 同樣取自 JWT
  deleted_at  TEXT,
  FOREIGN KEY (case_id) REFERENCES ae_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_ae_attachments_case ON ae_attachments (case_id, deleted_at);

-- ── 使用者角色 ──────────────────────────────────────────────────────────
--
-- Cloudflare Access 只回答「這個 email 是不是自己人」，不回答「這個人該看到什麼」。
-- 分權必須在應用層做，而且不能靠 hash 路由：`#/report` 的片段依 HTTP 規範
-- 不會送到伺服器，Cloudflare 看不到它，路徑規則分不了權。
--
-- 兩種角色：
--   rep —— 業務。只能新增個案、只讀得到自己送的個案。
--   pv  —— 藥安人員。讀寫全部個案。
--
-- **查無此人時視為 rep**（最小權限）。藥安人員必須被明確列出，
-- 漏設的後果是「某人看不到全部個案」，而不是「某人看得到全部個案」——
-- 預設值選錯邊，出事的方式會完全不同。
CREATE TABLE IF NOT EXISTS ae_users (
  email        TEXT PRIMARY KEY,   -- 一律小寫，與 JWT 的 email 比對前正規化
  role         TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('rep', 'pv')),

  -- ── 通報者個人檔案 ──────────────────────────────────────────────────
  -- CIOMS 表格裡「誰通報的」這一段（26 通報者、24a 藥商名稱）對同一位業務
  -- 每次都一樣。放在個案 payload 裡，等於要求他每通報一次就重打六個欄位；
  -- 手機上這是第一屏就讓人放棄的主因。改為首次登入建檔一次，之後自動帶入。
  --
  -- ⚠️ 這裡存的是**顯示用**資料，不是身分憑證。「誰送的」永遠以 ae_cases.submitted_by
  -- （取自 Access JWT）為準；本表的姓名改掉也動不了那個欄位。
  display_name TEXT,               -- 姓名 → reporterName（CIOMS 26）
  employee_id  TEXT,               -- 員工編號 → reporterEmployeeId
  phone        TEXT,               -- 聯絡電話 → reporterPhone
  contact_email TEXT,              -- 聯絡信箱 → reporterEmail（可與登入信箱不同）
  org          TEXT,               -- 公司／單位 → reporterOrg（CIOMS 24a）
  territory    TEXT,               -- 負責轄區 → reporterTerritory

  created_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_at   TEXT
);
