# Pre-registration: does the model add information beyond the sportsbooks' closing line?

Written BEFORE any historical sportsbook lines have been downloaded or analysed. Not to be edited afterwards;
a different design needs a new file.

## Design (fixed)

- Data: `research/backfill_odds.py` on a paid Odds API plan, season 2025-26, a random sample of whole game days
  (default seed 11, about 250 games), markets player_points / player_rebounds / player_assists, region `us`.
  Two snapshots per game: about 180 minutes before tip ("open") and about 20 minutes before tip ("close").
- Model: the candidate `m2` exactly as in `models.HGB`, trained on seasons before 2025-26 only
  (`market_eval.attach_truth_and_model`). Nothing is tuned on this data.
- Market probability: Over/Under de-vigged with the power method per book, averaged across books.
- Props whose result equals the line are dropped (pushes). Unit of resampling: calendar week.
- This is a retrospective test on a sample. It is NOT the forward test in PREREG.md (H3), which still requires
  at least 1,000 graded frozen bets.

## Hypotheses and pass/fail

**H4 (information).** In `y ~ a + b*logit(market close) + c*logit(model)`, the model coefficient `c` has a 95%
week-resampled interval entirely above 0. PASS only if so AND at least 3,000 props were matched. If fewer than
3,000 props matched, no conclusion is allowed in either direction.

**H5 (closing line value).** The fixed policy in `market_eval.evaluate` (weights 0.6 market / 0.4 model, edge
threshold 3%, bet at the best OPEN price) has mean CLV with a 95% week-resampled interval entirely above 0, over
at least 300 bets.

**H6 (profit): reported, not a pass condition.** Realised ROI at the open prices, with its interval. Closing line
value is the test; realised ROI on a few hundred bets is mostly noise.

## Decision rules

- H4 fails: the model carries no usable information beyond the closing line. The blend should lean on the market
  (raise its weight); say so plainly. Do not search for a subgroup (a stat, a team, a player type) that "works".
- H4 passes and H5 fails: the model has information but the early prices already reflected it; report the size of
  `c` and stop.
- H4 and H5 both pass: report as a promising result needing the forward test (PREREG.md, H3) before any claim
  of edge. One season of one book region is not enough to conclude more.
- Whatever happens, the model/market blend weights come from the fitted regression coefficients, and the report
  states how many props and games they rest on.

## Known limits (declared in advance)

- Only US books are included, and Stake is not available in this data.
- Props are matched to box scores by player name and Eastern-time game date; unmatched props are dropped and
  their number is reported.
- Early and closing snapshots are 5-minute-granular; a missing snapshot drops the prop.
- The sample is of whole game days chosen at random, so props within a game and a day are correlated;
  resampling by calendar week partly, not fully, accounts for that.
