-- Apply AFTER schema.sql, BEFORE deploying work-management code. No remote execution in development.
CREATE TABLE IF NOT EXISTS ae_case_work (
 case_id TEXT PRIMARY KEY REFERENCES ae_cases(id),
 version INTEGER NOT NULL,
 payload TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ae_work_audit (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 case_id TEXT NOT NULL REFERENCES ae_cases(id),
 version INTEGER NOT NULL,
 at TEXT NOT NULL,
 actor TEXT NOT NULL,
 action TEXT NOT NULL,
 payload TEXT NOT NULL,
 UNIQUE(case_id, version)
);
CREATE TRIGGER IF NOT EXISTS ae_work_audit_no_update BEFORE UPDATE ON ae_work_audit BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS ae_work_audit_no_delete BEFORE DELETE ON ae_work_audit BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
CREATE TRIGGER IF NOT EXISTS ae_work_created AFTER INSERT ON ae_case_work BEGIN
 INSERT INTO ae_work_audit(case_id,version,at,actor,action,payload) VALUES(NEW.case_id,NEW.version,NEW.updated_at,NEW.updated_by,'work_saved',NEW.payload);
END;
CREATE TRIGGER IF NOT EXISTS ae_work_updated AFTER UPDATE ON ae_case_work BEGIN
 INSERT INTO ae_work_audit(case_id,version,at,actor,action,payload) VALUES(NEW.case_id,NEW.version,NEW.updated_at,NEW.updated_by,'work_saved',NEW.payload);
END;
