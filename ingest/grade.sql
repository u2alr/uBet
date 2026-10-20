-- Grade logged picks against box scores. Idempotent: only rows still waiting for a result are touched.
-- Run by ingest/sync.py after every sync (and by tests/grade.test.mjs). hit: 1 = won, 0 = lost, 2 = push (tie, refunded).
-- A player with no box-score row for that date (did not play) stays ungraded, which is how a void bet should look.
UPDATE predictions SET actual = (
  SELECT pg.pts FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = predictions.player_id AND g.date = predictions.game_date)
WHERE actual IS NULL AND stat = 'pts' AND game_date IS NOT NULL;
UPDATE predictions SET actual = (
  SELECT pg.reb FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = predictions.player_id AND g.date = predictions.game_date)
WHERE actual IS NULL AND stat = 'reb' AND game_date IS NOT NULL;
UPDATE predictions SET actual = (
  SELECT pg.ast FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = predictions.player_id AND g.date = predictions.game_date)
WHERE actual IS NULL AND stat = 'ast' AND game_date IS NOT NULL;
UPDATE predictions SET actual = (
  SELECT pg.fg3m FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = predictions.player_id AND g.date = predictions.game_date)
WHERE actual IS NULL AND stat = 'fg3m' AND game_date IS NOT NULL;
UPDATE predictions SET actual = (
  SELECT pg.stl FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = predictions.player_id AND g.date = predictions.game_date)
WHERE actual IS NULL AND stat = 'stl' AND game_date IS NOT NULL;
UPDATE predictions SET actual = (
  SELECT pg.blk FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = predictions.player_id AND g.date = predictions.game_date)
WHERE actual IS NULL AND stat = 'blk' AND game_date IS NOT NULL;
UPDATE predictions SET hit = CASE
    WHEN actual = line THEN 2
    WHEN (side = 'over' AND actual > line) OR (side = 'under' AND actual < line) THEN 1
    ELSE 0 END
WHERE actual IS NOT NULL AND hit IS NULL AND side IS NOT NULL;
