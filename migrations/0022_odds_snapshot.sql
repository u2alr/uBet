-- The odds the site shows, stored by the local odds sync (scripts/sync_odds.mjs) so a page load never calls the odds provider.
-- 'games': one row per game, body = the books' moneyline/spread/total (part is empty).
-- 'props': one row per game and market (part = the market key), body = the books' Over/Under quotes. Split by market to keep each row small.
CREATE TABLE odds_snapshot (
  kind TEXT NOT NULL,
  event_id TEXT NOT NULL,
  part TEXT NOT NULL DEFAULT '',
  commence_time TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,      -- ms since the epoch: when the provider answered
  body TEXT NOT NULL,
  PRIMARY KEY (kind, event_id, part)
);
CREATE INDEX idx_odds_snapshot_start ON odds_snapshot (commence_time);
