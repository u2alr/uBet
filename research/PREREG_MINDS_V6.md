# Pre-registration: the minds, version 6 (frozen before the first v6 decision)

Config `minds-v6`, `CHIEF` in `shared/minds.ts`. Everything in `PREREG_MINDS_V4.md` and `PREREG_MINDS_V5.md` still holds.

## The request, and what was done about it
"Per game make at least 30 bets." The strict and lean tiers have no quota, and that does not change: a quota there would
force bets with no edge. So the request is met with a third tier that is **not for betting**.

## The volume board (paper only)
- For every game, each of a team's **10 players with the most minutes** (18+ minutes, not injured, minutes not falling, a fresh
  projection, 10+ games of history), the best line of each of the **four statistics** among lines **priced 1.50 to 2.60** (a
  main line: far alternates and stale or promotional quotes pay 5x to 30x and would top any ranking by raw value; the first
  version of this board was dominated by 30x quotes) (the better side if both are posted; a
  ladder of lines on one player and statistic counts once). At most 10 x 4 = 40 per team-game.
- Ranked by the model's raw expected value. **No market check is required**, so lines quoted on one side only are included.
- Stored as tier `volume`, graded like any bet at a paper stake of 1 unit, and **never included in the strict or lean record**
  or in any personality's record.

## Why it is paper
- Most lines have no edge. A book's margin (about 4 to 5% on these markets) means a random line loses. The model's own values for this
  board look positive (about +4% on average on the first day) but are not evidence of an edge: they come from the model alone, with no
  market to check them, and choosing the better side of each line picks up the model's errors. They are an upper bound.
- With no market comparison, the probabilities come from the model alone, and that model is mildly overconfident
  (calibration slopes 0.85 to 0.92). The strict tier's whole purpose is to avoid this.
- Bets on the same game are correlated and ladders are the same outcome, so 30 a game is fewer than 30 independent facts.

## What it is for
Volume gives graded evidence at scale: calibration by statistic and price band over hundreds of lines a day instead of a
handful, and a test of whether the strict and lean filters pick better than the rest. A line on this board is something to
*learn from*, not a recommendation.

## What it cannot do
It cannot guarantee 30 a game. Books post props for only some players, and the model covers only some of those. Where fewer
than 30 qualifying lines exist, that is the number. The app shows how many games reach 30.

## How it will be judged
Calibration of the whole board and of its top-ranked lines, compared with the strict and lean tiers. If the top-ranked
volume lines do not beat the bottom-ranked ones, the model's ranking has no information and that is worth knowing.
