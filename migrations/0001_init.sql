CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  team TEXT,
  position TEXT
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  season INTEGER NOT NULL,
  home_team_id INTEGER NOT NULL,
  visitor_team_id INTEGER NOT NULL
);

CREATE TABLE player_games (
  player_id INTEGER NOT NULL REFERENCES players(id),
  game_id INTEGER NOT NULL REFERENCES games(id),
  team_id INTEGER NOT NULL,
  minutes REAL NOT NULL DEFAULT 0,
  pts INTEGER NOT NULL DEFAULT 0,
  reb INTEGER NOT NULL DEFAULT 0,
  ast INTEGER NOT NULL DEFAULT 0,
  fg3m INTEGER NOT NULL DEFAULT 0,
  stl INTEGER NOT NULL DEFAULT 0,
  blk INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, game_id)
);
CREATE INDEX idx_pg_player ON player_games(player_id);

-- Every prediction we make is logged so it can be graded and backtested later.
CREATE TABLE predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id),
  stat TEXT NOT NULL,
  line REAL NOT NULL,
  predicted REAL NOT NULL,
  p_over REAL NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  game_id INTEGER,
  actual REAL,
  hit INTEGER
);
