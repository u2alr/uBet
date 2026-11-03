-- Game model v2 (research/PREREG_GAMES_V2.md): a logistic model on opponent-adjusted ratings, talent-weighted availability, a common-opponent tally and rest, passed its
-- pre-registered rule and replaced v1 as the number behind "our chance". Everything is still only DISPLAYED.
--  * model_version: which model produced model_home_prob. model_v1_prob keeps the old model's number beside it so the two can be compared on the live stream.
--  * srs_home / srs_away: opponent-adjusted margin ratings (points per game against an average team, 60-day memory); pred_margin: the home team's predicted margin including home court.
--  * co_diff: common-opponent tally, -1 (away team did better against shared opponents) to +1 (home team did).
ALTER TABLE game_lean ADD COLUMN model_version TEXT;
ALTER TABLE game_lean ADD COLUMN model_v1_prob REAL;
ALTER TABLE game_lean ADD COLUMN srs_home REAL;
ALTER TABLE game_lean ADD COLUMN srs_away REAL;
ALTER TABLE game_lean ADD COLUMN pred_margin REAL;
ALTER TABLE game_lean ADD COLUMN co_diff REAL;
ALTER TABLE game_lean_log ADD COLUMN model_version TEXT;
ALTER TABLE game_lean_log ADD COLUMN model_v1_prob REAL;
