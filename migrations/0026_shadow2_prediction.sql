-- A second shadow prediction (player importance, research/PREREG_GAMES_V4.md): stored beside the shipped number before every game, never displayed, scored later on games nobody has looked at.
ALTER TABLE game_lean_log ADD COLUMN shadow2_prob REAL;
ALTER TABLE game_lean_log ADD COLUMN shadow2_name TEXT;
