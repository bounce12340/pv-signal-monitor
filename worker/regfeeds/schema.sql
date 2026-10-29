-- 主管機關安全性公告（worker/regfeeds/）。建在 DB（pv-signal-monitor），不在 AE_DB：
-- 這裡只有公開資料與 PV 人員的核閱紀錄，沒有個案資料。
--
-- 套用（手動，CI 不跑 migration）：先備份，再
--   npx wrangler d1 export pv-signal-monitor --remote --output=backup-before-regfeeds.sql
--   npx wrangler d1 execute pv-signal-monitor --remote --file=worker/regfeeds/schema.sql
-- 全部是 IF NOT EXISTS，重跑無害。

-- 抓到的公告。id = 來源:網址，同一則重抓不會重複；first_seen 是本系統第一次取得的時間，
-- 是「何時可得知」的紀錄，之後不再改動。
CREATE TABLE IF NOT EXISTS reg_alerts (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  published   TEXT,                       -- 主管機關標示的日期 YYYY-MM-DD；沒有則 NULL
  summary     TEXT NOT NULL DEFAULT '',
  substances  TEXT NOT NULL DEFAULT '',
  first_seen  TEXT NOT NULL,              -- ISO 8601，第一次存入
  updated_at  TEXT NOT NULL               -- 內容最後一次因來源變動而更新
);
CREATE INDEX IF NOT EXISTS idx_reg_alerts_published ON reg_alerts (published);
CREATE INDEX IF NOT EXISTS idx_reg_alerts_first_seen ON reg_alerts (first_seen);

-- 每個來源最近一次抓取的結果，讓畫面能顯示「哪個來源已經多久沒成功」。
CREATE TABLE IF NOT EXISTS reg_sources (
  source        TEXT PRIMARY KEY,
  last_attempt  TEXT,
  last_success  TEXT,
  last_error    TEXT,
  last_count    INTEGER
);

-- 核閱、監測成分清單變更、手動更新的稽核軌跡。actor 一律來自已驗證的 Access JWT。
-- 目前的核閱狀態 = 該公告最新一筆 review；目前的監測成分 = 最新一筆 watchlist。
-- 只 INSERT，trigger 擋下 UPDATE / DELETE。
CREATE TABLE IF NOT EXISTS reg_audit (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL CHECK (action IN ('review', 'watchlist', 'refresh')),
  target  TEXT NOT NULL,                  -- review: 公告 id；watchlist: 'watchlist'；refresh: 來源 id
  detail  TEXT NOT NULL DEFAULT '{}'      -- JSON
);
CREATE INDEX IF NOT EXISTS idx_reg_audit_target ON reg_audit (action, target, seq);

CREATE TRIGGER IF NOT EXISTS trg_reg_audit_no_update
BEFORE UPDATE ON reg_audit
BEGIN
  SELECT RAISE(ABORT, 'audit trail is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_reg_audit_no_delete
BEFORE DELETE ON reg_audit
BEGIN
  SELECT RAISE(ABORT, 'audit trail is append-only');
END;
