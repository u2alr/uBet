-- Bets the user actually placed (logged from the Slip), graded from box scores. Separate from the app's suggestions and the minds' paper bets.
CREATE TABLE IF NOT EXISTS my_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  placed_at TEXT NOT NULL DEFAULT (datetime('now')),
  stake REAL NOT NULL CHECK (stake > 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open',          -- open | won | lost | push | void
  settled_odds REAL,                            -- combined price after pushed or void legs are dropped
  profit REAL                                   -- in the same currency as the stake; null until settled
);
CREATE TABLE IF NOT EXISTS my_bet_legs (
  bet_id INTEGER NOT NULL REFERENCES my_bets(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  player TEXT NOT NULL,
  stat TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('over', 'under')),
  line REAL NOT NULL,
  price REAL NOT NULL CHECK (price > 1),       -- the decimal odds actually taken
  book TEXT,
  game_date TEXT NOT NULL,
  actual REAL,
  result TEXT,                                  -- won | lost | push | void
  PRIMARY KEY (bet_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_my_bets_status ON my_bets(status);
