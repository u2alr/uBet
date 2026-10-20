-- Grade the minds' frozen cards against box scores. Idempotent: only unresolved legs / open bets are touched.
-- Leg result: won | lost | push | void. A pushed or void leg is dropped from a combo (odds recomputed), as books do.
UPDATE mind_legs SET actual = (
  SELECT CASE mind_legs.stat WHEN 'pts' THEN pg.pts WHEN 'reb' THEN pg.reb WHEN 'ast' THEN pg.ast
                             WHEN 'fg3m' THEN pg.fg3m WHEN 'stl' THEN pg.stl WHEN 'blk' THEN pg.blk END
  FROM player_games pg JOIN games g ON g.id = pg.game_id
  WHERE pg.player_id = mind_legs.player_id AND g.date = mind_legs.game_date)
WHERE actual IS NULL;
UPDATE mind_legs SET result = CASE
    WHEN actual = line THEN 'push'
    WHEN (side = 'over' AND actual > line) OR (side = 'under' AND actual < line) THEN 'won'
    ELSE 'lost' END
WHERE result IS NULL AND actual IS NOT NULL;
-- No box-score row two days on, while other games that date are in: the player did not play.
UPDATE mind_legs SET result = 'void'
WHERE result IS NULL AND actual IS NULL AND game_date < date('now', '-2 days')
  AND EXISTS (SELECT 1 FROM games g WHERE g.date = mind_legs.game_date);
-- A lost leg loses the bet at once.
UPDATE mind_bets SET status = 'lost', profit = -stake
WHERE status = 'open' AND EXISTS (SELECT 1 FROM mind_legs l WHERE l.bet_id = mind_bets.id AND l.result = 'lost');
-- Every leg resolved and none lost.
UPDATE mind_bets SET
  settled_odds = COALESCE((SELECT price FROM mind_legs WHERE bet_id = mind_bets.id AND idx = 0 AND result = 'won'), 1) * COALESCE((SELECT price FROM mind_legs WHERE bet_id = mind_bets.id AND idx = 1 AND result = 'won'), 1) * COALESCE((SELECT price FROM mind_legs WHERE bet_id = mind_bets.id AND idx = 2 AND result = 'won'), 1) * COALESCE((SELECT price FROM mind_legs WHERE bet_id = mind_bets.id AND idx = 3 AND result = 'won'), 1) * COALESCE((SELECT price FROM mind_legs WHERE bet_id = mind_bets.id AND idx = 4 AND result = 'won'), 1),
  status = CASE WHEN EXISTS (SELECT 1 FROM mind_legs l WHERE l.bet_id = mind_bets.id AND l.result = 'won')
                THEN 'won' WHEN EXISTS (SELECT 1 FROM mind_legs l WHERE l.bet_id = mind_bets.id AND l.result = 'push') THEN 'push' ELSE 'void' END
WHERE status = 'open' AND NOT EXISTS (SELECT 1 FROM mind_legs l WHERE l.bet_id = mind_bets.id AND l.result IS NULL);
UPDATE mind_bets SET profit = CASE status WHEN 'won' THEN stake * (settled_odds - 1) ELSE 0 END
WHERE profit IS NULL AND status IN ('won', 'push', 'void');
