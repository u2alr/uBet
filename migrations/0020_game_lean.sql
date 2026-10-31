-- Game-winner view for the next games, written by research/game_snapshot.py and only DISPLAYED (see shared/games.ts and shared/games.status.json).
--  * game_lean: the model's chance that the home team wins (home advantage + Elo, research/PREREG_GAMES.md) and the recent-form facts shown beside it. Replaced on every snapshot.
--  * game_lean_log: model and market chances side by side at the time of each snapshot. Never edited; it exists so a forward comparison against the market can be pre-registered later.
CREATE TABLE IF NOT EXISTS game_lean (
  date TEXT NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL,
  model_home_prob REAL NOT NULL, elo_home REAL NOT NULL, elo_away REAL NOT NULL,
  home_net10 REAL, away_net10 REAL, home_off20 REAL, home_def20 REAL, away_off20 REAL, away_def20 REAL,
  as_of TEXT NOT NULL,
  PRIMARY KEY (date, home, away)
);
CREATE TABLE IF NOT EXISTS game_lean_log (
  date TEXT NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL, as_of TEXT NOT NULL,
  model_home_prob REAL NOT NULL, market_home_prob REAL, market_book TEXT,
  PRIMARY KEY (date, home, away, as_of)
);
