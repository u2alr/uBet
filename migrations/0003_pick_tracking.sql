-- Picks are logged with the book's line/price so they can be graded after the game.
ALTER TABLE predictions ADD COLUMN game_date TEXT;
ALTER TABLE predictions ADD COLUMN side TEXT;
ALTER TABLE predictions ADD COLUMN price REAL;
ALTER TABLE predictions ADD COLUMN book TEXT;

CREATE UNIQUE INDEX idx_pred_unique ON predictions(player_id, stat, game_date, line, side);
