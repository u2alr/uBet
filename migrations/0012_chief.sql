-- Version 4: bets are chosen by a Chief from candidates proposed by the personalities, with evidence recorded.
ALTER TABLE mind_bets ADD COLUMN proposed_by TEXT;     -- comma-separated personalities that proposed it (null before v4)
ALTER TABLE mind_bets ADD COLUMN p_cons REAL;          -- conservative win chance (whole bet)
ALTER TABLE mind_bets ADD COLUMN ev_cons REAL;         -- conservative expected profit per unit
ALTER TABLE mind_bets ADD COLUMN rationale TEXT;       -- JSON array of sentences: Quant, Market, Matchup, Skeptic
ALTER TABLE mind_bets ADD COLUMN research INTEGER NOT NULL DEFAULT 0;   -- 1 = tracked and graded, not part of the staked portfolio
ALTER TABLE mind_legs ADD COLUMN p_cons REAL;
ALTER TABLE mind_legs ADD COLUMN matchup_score INTEGER;
ALTER TABLE mind_legs ADD COLUMN skeptic_flags TEXT;

-- Candidates a personality proposed and the Chief turned down, and why. Nothing is deleted: a "no bet" day is data.
CREATE TABLE IF NOT EXISTS mind_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  player TEXT NOT NULL,
  stat TEXT NOT NULL,
  side TEXT NOT NULL,
  line REAL NOT NULL,
  price REAL NOT NULL,
  game TEXT,
  tip_off TEXT,
  reason TEXT NOT NULL,
  detail TEXT,
  p_cons REAL,
  ev_cons REAL
);
CREATE INDEX IF NOT EXISTS idx_mind_rej_day ON mind_rejections(version, day);
