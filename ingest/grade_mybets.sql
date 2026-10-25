-- Grade the bets the user actually placed. Idempotent: only unresolved legs and open bets are touched.
-- A pushed or void leg is dropped from a parlay and the price recomputed, as books do. A single that pushes returns the stake.
UPDATE my_bet_legs SET actual = (
  SELECT CASE my_bet_legs.stat WHEN 'pts' THEN pg.pts WHEN 'reb' THEN pg.reb WHEN 'ast' THEN pg.ast
                               WHEN 'fg3m' THEN pg.fg3m WHEN 'stl' THEN pg.stl WHEN 'blk' THEN pg.blk WHEN 'pra' THEN pg.pts + pg.reb + pg.ast END
  FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = my_bet_legs.player_id AND g.date = my_bet_legs.game_date)
WHERE actual IS NULL;
UPDATE my_bet_legs SET result = CASE
    WHEN actual = line THEN 'push'
    WHEN (side = 'over' AND actual > line) OR (side = 'under' AND actual < line) THEN 'won'
    ELSE 'lost' END
WHERE result IS NULL AND actual IS NOT NULL;
-- No box-score row two days on, while other games that date are in: the player did not play, so the leg is void.
UPDATE my_bet_legs SET result = 'void'
WHERE result IS NULL AND actual IS NULL AND game_date < date('now', '-2 days')
  AND EXISTS (SELECT 1 FROM games g WHERE g.date = my_bet_legs.game_date);
-- A lost leg loses the bet at once.
UPDATE my_bets SET status = 'lost', profit = -stake
WHERE status = 'open' AND EXISTS (SELECT 1 FROM my_bet_legs l WHERE l.bet_id = my_bets.id AND l.result = 'lost');
-- Every leg resolved and none lost: the price is the product of the legs that won (a recursive product: SQLite and D1 have no product aggregate, and the math functions are not guaranteed).
UPDATE my_bets SET
  settled_odds = (WITH RECURSIVE r(i, p) AS (
      SELECT -1, 1.0
      UNION ALL SELECT l.idx, r.p * CASE WHEN l.result = 'won' THEN l.price ELSE 1 END FROM r JOIN my_bet_legs l ON l.bet_id = my_bets.id AND l.idx = r.i + 1)
    SELECT p FROM r ORDER BY i DESC LIMIT 1),
  status = CASE WHEN EXISTS (SELECT 1 FROM my_bet_legs l WHERE l.bet_id = my_bets.id AND l.result = 'won') THEN 'won'
                WHEN EXISTS (SELECT 1 FROM my_bet_legs l WHERE l.bet_id = my_bets.id AND l.result = 'push') THEN 'push' ELSE 'void' END
WHERE status = 'open' AND NOT EXISTS (SELECT 1 FROM my_bet_legs l WHERE l.bet_id = my_bets.id AND l.result IS NULL);
UPDATE my_bets SET profit = CASE status WHEN 'won' THEN stake * (settled_odds - 1) ELSE 0 END
WHERE profit IS NULL AND status IN ('won', 'push', 'void');
