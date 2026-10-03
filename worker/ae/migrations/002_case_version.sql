-- Existing databases only. The controlled local runner verifies the ledger
-- and actual schema before running this intentionally non-self-rerunnable SQL.
ALTER TABLE ae_cases ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
