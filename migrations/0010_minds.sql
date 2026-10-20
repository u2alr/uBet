-- Frozen daily cards from the rule-based minds. A card is never rewritten once created (INSERT OR IGNORE on bet_key).
CREATE TABLE IF NOT EXISTS mind_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bet_key TEXT NOT NULL UNIQUE,
  day TEXT NOT NULL,
  mind TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  odds REAL NOT NULL,
  prob REAL NOT NULL,
  ev REAL NOT NULL,
  stake REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',   -- open | won | lost | push | void
  profit REAL,
  settled_odds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mind_bets_day ON mind_bets(day, mind);
CREATE TABLE IF NOT EXISTS mind_legs (
  bet_id INTEGER NOT NULL REFERENCES mind_bets(id),
  idx INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  player TEXT NOT NULL,
  stat TEXT NOT NULL,
  side TEXT NOT NULL,
  line REAL NOT NULL,
  price REAL NOT NULL,
  book TEXT,
  odds_id TEXT,
  event_id TEXT,
  game_date TEXT NOT NULL,
  prob REAL NOT NULL,
  model_prob REAL,
  market_prob REAL,
  actual REAL,
  result TEXT,                            -- won | lost | push
  close_price REAL,
  PRIMARY KEY (bet_id, idx)
);
