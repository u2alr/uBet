-- The NBA's official injury report (a PDF posted about every 15 minutes), one row per report, team and player, read by research/nba_injury_pdf.py. Never edited after it is written:
-- it exists so the official list can be compared with who actually played, report by report, and so a snapshot can say which report it used.
--  * report_time: the time printed on the report, 'YYYY-MM-DD HH:MM' Eastern.
--  * player is as the PDF prints it ("Last,First" with no spaces); matching to the roster happens when it is read.
--  * a team the report marks "NOT YET SUBMITTED" is a row with status 'NOT_SUBMITTED' and no player, so "has not filed" can be told from "filed with nobody listed".
--  * game_date and matchup ("AWAY@HOME") say which game the row is about; the lineups only ever use the rows of their own game.
CREATE TABLE IF NOT EXISTS nba_injury_report (
  report_time TEXT NOT NULL, team TEXT NOT NULL, player TEXT NOT NULL, status TEXT NOT NULL, reason TEXT,
  game_date TEXT, matchup TEXT,
  PRIMARY KEY (report_time, game_date, team, player)
);
CREATE INDEX IF NOT EXISTS idx_nba_injury_report_game ON nba_injury_report (game_date, team);
