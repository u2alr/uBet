-- Version 7: every run is recorded with its config and calibration identity, and every candidate (rejected ones too) is frozen before the games.
CREATE TABLE IF NOT EXISTS mind_runs (
  run_id TEXT PRIMARY KEY, day TEXT NOT NULL, version TEXT NOT NULL, config_hash TEXT NOT NULL, config_json TEXT NOT NULL,
  calibration_version TEXT, calibration_hash TEXT, stats_json TEXT NOT NULL, cap_log_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mind_candidates (
  run_id TEXT NOT NULL, key TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT NOT NULL, record_json TEXT NOT NULL,
  PRIMARY KEY (run_id, key)
);
-- The exact input picks, gzip+base64, in chunks small enough for one D1 statement; replaying them with the stored config reproduces the decision.
CREATE TABLE IF NOT EXISTS mind_run_inputs (run_id TEXT NOT NULL, idx INTEGER NOT NULL, chunk TEXT NOT NULL, PRIMARY KEY (run_id, idx));
ALTER TABLE mind_bets ADD COLUMN label TEXT;
ALTER TABLE mind_bets ADD COLUMN run_id TEXT;
ALTER TABLE mind_rejections ADD COLUMN reasons_json TEXT;
ALTER TABLE mind_rejections ADD COLUMN run_id TEXT;
