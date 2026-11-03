-- A shadow prediction: a candidate model's number stored beside the shipped one before every game, never displayed, so the candidate can be scored later on games nobody has looked at
-- (research/PREREG_GAMES_V3.md: the returning-players feature).
ALTER TABLE game_lean_log ADD COLUMN shadow_prob REAL;
ALTER TABLE game_lean_log ADD COLUMN shadow_name TEXT;
