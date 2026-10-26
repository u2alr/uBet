-- Point-in-time odds archive. One row per OBSERVED CHANGE of a quote, with the time the system saw it. Nothing here is edited after it is written.
--
-- What it can and cannot say (see shared/oddsArchive.ts):
--  * "opening" is the first price THIS SYSTEM observed for a market, not the bookmaker's true opening line.
--  * "closing proxy" is the last observed price at or before a documented cutoff before the event, and only when an observation was close enough in time.
--    It is never called a closing line, because no provider here marks the market as closed.
--  * An unchanged price is not re-stored; `odds_runs` records that the market was observed, so "price at time T" is the latest row at or before T from a run
--    that covered the event. A market that disappears from a complete run gets a row with market_status = 'unavailable'.
CREATE TABLE IF NOT EXISTS odds_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,                     -- when the provider response was retrieved (UTC ISO)
  source TEXT NOT NULL,                          -- 'theoddsapi' | 'oddsblaze'
  kind TEXT NOT NULL,                            -- 'board' (website), 'daily' (minds runner), 'pre_event' (capture script)
  event_id TEXT NOT NULL,
  event_start TEXT,
  status TEXT NOT NULL,                          -- ok | partial | rate_limited | failed
  quotes_seen INTEGER NOT NULL DEFAULT 0,
  quotes_written INTEGER NOT NULL DEFAULT 0,
  stale_quotes INTEGER NOT NULL DEFAULT 0,       -- quotes older than the freshness limit at capture time
  disagreements INTEGER NOT NULL DEFAULT 0,      -- the same book listed two different prices for one market within the run
  note TEXT,
  UNIQUE (source, event_id, captured_at)
);
CREATE TABLE IF NOT EXISTS odds_quotes (
  event_id TEXT NOT NULL,
  event_start TEXT,
  player_name TEXT NOT NULL,
  player_id INTEGER,
  stat TEXT NOT NULL,
  line REAL NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('over', 'under')),
  book TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  run_id INTEGER REFERENCES odds_runs(id),
  price REAL,                                     -- decimal; null when the market is unavailable
  market_status TEXT NOT NULL DEFAULT 'open',     -- open | unavailable
  quote_updated_at TEXT,                          -- the quote's own time, or the feed's
  timestamp_source TEXT,                          -- quote | feed | unknown
  freshness TEXT NOT NULL DEFAULT 'unknown',      -- fresh | stale | unknown, judged at captured_at
  main INTEGER,                                   -- 1 / 0 / null (unknown)
  PRIMARY KEY (event_id, player_name, stat, line, side, book, source, captured_at)
);
CREATE INDEX IF NOT EXISTS idx_odds_quotes_event_time ON odds_quotes(event_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_odds_runs_event ON odds_runs(event_id, captured_at);
