-- Raw Odds API responses, kept exactly as received with a capture time. This is the point-in-time
-- material for closing-line-value analysis: the last snapshot before tip-off is the closing line.
CREATE TABLE IF NOT EXISTS odds_raw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  path TEXT NOT NULL,
  params TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_odds_raw_time ON odds_raw(captured_at);
