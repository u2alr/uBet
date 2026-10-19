-- 'regular' or 'playoffs'. Existing rows are all regular season.
ALTER TABLE games ADD COLUMN game_type TEXT NOT NULL DEFAULT 'regular';
