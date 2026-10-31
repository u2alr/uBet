-- Defensive matchup context for the NEXT games, written by research/defense_snapshot.py and only DISPLAYED (see shared/defense.ts and shared/defense.status.json).
-- Replaced wholesale on every snapshot; history is not kept here (the evaluation uses research/data/matchups.sqlite, which is per game and point in time).
--  * defense_team: each team's prior-only defensive profile (last 10 games and season to date) and where it ranks among the 30 teams (pct_l10 = share of teams with a LOWER value).
--  * defense_matchup: the up-to-three most likely defenders for a player against a team, as an ESTIMATE from history (weight sums to at most 1), with the sample behind each defender.
--  * defense_meta: when it was computed, how far the matchup data runs, and the league distribution used for plain-language labels.
CREATE TABLE IF NOT EXISTS defense_team (
  team TEXT NOT NULL, metric TEXT NOT NULL, value_l10 REAL, value_s2d REAL, pct_l10 REAL,
  PRIMARY KEY (team, metric)
);
CREATE TABLE IF NOT EXISTS defense_matchup (
  player_id INTEGER NOT NULL, player TEXT, opp TEXT NOT NULL, rank INTEGER NOT NULL,
  defender_id INTEGER NOT NULL, defender TEXT, weight REAL, dpoe100 REAL, foul100 REAL, expo REAL, direct_poss REAL, role TEXT,
  conf REAL, herf REAL, direct REAL,
  PRIMARY KEY (player_id, opp, rank)
);
CREATE TABLE IF NOT EXISTS defense_meta (key TEXT PRIMARY KEY, value TEXT);
