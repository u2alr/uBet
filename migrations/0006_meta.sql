-- Small key/value store; ingest/sync.py records when it last finished.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
