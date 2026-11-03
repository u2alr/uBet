-- What the game model would have said BEFORE each game already played this season (research/game_snapshot.py): the games-v2 model fitted on earlier seasons only, with prior-only features,
-- next to the result and the context of the game, so the season can be reviewed honestly: who was the favourite, who won, and what the upsets had in common. Replaced on every snapshot.
CREATE TABLE IF NOT EXISTS season_review (
  date TEXT NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL,
  p_home REAL NOT NULL,          -- the home team's chance, as the model would have said it before the game
  home_won INTEGER NOT NULL,
  srs_gap REAL,                  -- opponent-adjusted rating, home minus away (points per game)
  talent_diff REAL,              -- talent missing (Game Score of absent rotation players), home minus away
  rest_diff REAL,                -- rest days, home minus away
  b2b_home INTEGER, b2b_away INTEGER,
  PRIMARY KEY (date, home, away)
);
