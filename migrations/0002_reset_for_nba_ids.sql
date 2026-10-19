-- Player/game ids switched from ESPN to NBA.com ids; drop the old rows.
DELETE FROM player_games;
DELETE FROM games;
DELETE FROM players;
DELETE FROM predictions;
