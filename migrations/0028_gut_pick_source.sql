-- A pick now has an author: the user ('you') or Claude ('claude'). Same rules for both: saved before tip-off, scored later against the model's pre-game number. The key gains the author.
CREATE TABLE gut_pick_v2 (
  source TEXT NOT NULL DEFAULT 'you' CHECK (source IN ('you', 'claude')),
  date TEXT NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL,
  pick TEXT NOT NULL CHECK (pick IN ('home', 'away')),
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  note TEXT,
  model_home_prob REAL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, date, home, away)
);
INSERT INTO gut_pick_v2 (source, date, home, away, pick, level, note, model_home_prob, saved_at)
  SELECT 'you', date, home, away, pick, level, note, model_home_prob, saved_at FROM gut_pick;
DROP TABLE gut_pick;
ALTER TABLE gut_pick_v2 RENAME TO gut_pick;
