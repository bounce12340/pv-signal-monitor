-- Work status + workbench + in-app notifications upgrade.
-- Apply AFTER 001_case_work.sql and 002_case_version.sql, BEFORE this Worker/UI.
-- This migration is intentionally for existing databases only; fresh databases run 001 then this file.
-- Do not run remotely from development. Backup and apply through the authorized deployment process.
ALTER TABLE ae_case_work ADD COLUMN status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in-progress','waiting','completed','cancelled'));
ALTER TABLE ae_case_work ADD COLUMN assignee TEXT NOT NULL DEFAULT '';
ALTER TABLE ae_case_work ADD COLUMN work_due_date TEXT;
ALTER TABLE ae_case_work ADD COLUMN audit_action TEXT NOT NULL DEFAULT 'work_saved';
CREATE INDEX IF NOT EXISTS idx_ae_case_work_workbench ON ae_case_work(status, work_due_date, assignee, case_id);

CREATE TABLE IF NOT EXISTS ae_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  recipient TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES ae_cases(id),
  kind TEXT NOT NULL CHECK(kind IN ('work_assigned','work_due')),
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(recipient, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_ae_notifications_recipient ON ae_notifications(recipient, read_at, created_at DESC);

-- Audit trigger uses the server-selected action included in the same conditional write.
DROP TRIGGER IF EXISTS ae_work_created;
DROP TRIGGER IF EXISTS ae_work_updated;
CREATE TRIGGER IF NOT EXISTS ae_work_created AFTER INSERT ON ae_case_work BEGIN
 INSERT INTO ae_work_audit(case_id,version,at,actor,action,payload) VALUES(NEW.case_id,NEW.version,NEW.updated_at,NEW.updated_by,NEW.audit_action,NEW.payload);
END;
CREATE TRIGGER IF NOT EXISTS ae_work_updated AFTER UPDATE ON ae_case_work BEGIN
 INSERT INTO ae_work_audit(case_id,version,at,actor,action,payload) VALUES(NEW.case_id,NEW.version,NEW.updated_at,NEW.updated_by,NEW.audit_action,NEW.payload);
END;
-- Assignment notifications are created by the same SQLite write/transaction as work and audit.
-- Fixed kind + internal case reference only: no patient or work text is copied.
CREATE TRIGGER IF NOT EXISTS ae_work_assignment_notification_insert AFTER INSERT ON ae_case_work
WHEN NEW.assignee <> '' AND NEW.assignee <> NEW.updated_by
BEGIN
 INSERT OR IGNORE INTO ae_notifications(id,recipient,case_id,kind,dedupe_key,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.assignee,NEW.case_id,'work_assigned','work_assigned:' || NEW.case_id || ':' || NEW.version || ':' || NEW.assignee,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS ae_work_assignment_notification_update AFTER UPDATE OF assignee ON ae_case_work
WHEN NEW.assignee <> '' AND NEW.assignee <> OLD.assignee AND NEW.assignee <> NEW.updated_by
BEGIN
 INSERT OR IGNORE INTO ae_notifications(id,recipient,case_id,kind,dedupe_key,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.assignee,NEW.case_id,'work_assigned','work_assigned:' || NEW.case_id || ':' || NEW.version || ':' || NEW.assignee,NEW.updated_at);
END;
