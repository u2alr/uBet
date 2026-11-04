-- The user's own "gut feeling" pick for a game, saved before tip-off (shared/gut.ts). It never changes a displayed number; it is only scored later against the model on finished games.
-- model_home_prob is the model's own pre-game number at the time of the last save, so a disagreement is judged against what the model said then.
CREATE TABLE IF NOT EXISTS gut_pick (
  date TEXT NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL,
  pick TEXT NOT NULL CHECK (pick IN ('home', 'away')),
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  note TEXT,
  model_home_prob REAL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, home, away)
);
