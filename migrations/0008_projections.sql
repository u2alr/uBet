-- Per-player projections for upcoming games, written by research/project.py (boosted model).
-- The Worker reads mean and alpha and turns them into P(over line) with a negative binomial.
CREATE TABLE IF NOT EXISTS projections (
  player_id INTEGER NOT NULL,
  game_date TEXT NOT NULL,          -- Eastern-time date of the game
  stat TEXT NOT NULL,
  mean REAL NOT NULL,
  alpha REAL NOT NULL,              -- negative-binomial dispersion: Var = mean + alpha * mean^2
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, game_date, stat)
);
