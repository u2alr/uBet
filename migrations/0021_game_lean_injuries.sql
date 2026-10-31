-- What the game-winner view assumed about availability, and the injury reports it saw (research/game_snapshot.py).
--  * game_lean.absent_home / absent_away: the rotation players treated as out for the model's number (listed Out at snapshot time), "Name (avg minutes)" separated by semicolons.
--  * injury_log: every Out / Doubtful / Questionable entry of the report for the teams in the snapshot, with the time it was read. Never edited: it exists so the report's accuracy
--    against who actually sat out can be measured going forward.
ALTER TABLE game_lean ADD COLUMN absent_home TEXT;
ALTER TABLE game_lean ADD COLUMN absent_away TEXT;
CREATE TABLE IF NOT EXISTS injury_log (
  as_of TEXT NOT NULL, team TEXT NOT NULL, player TEXT NOT NULL, status TEXT NOT NULL, note TEXT,
  PRIMARY KEY (as_of, team, player)
);
