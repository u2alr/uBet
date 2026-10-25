# Pre-registration: adjusting projections for rotation teammates who are out (written before `research/teammate_out.py` was run)

## What was tried first and what it showed
`research/project.py` now reads ESPN's injury report and sets the model's existing `miss_prev` / `miss_prev2` features to the minutes of rotation teammates
listed Out. Checked on tonight's slate (Orlando with Banchero, 37 min, out): the model's projections for his teammates barely moved and one went DOWN
(Franz Wagner points 15.56 without the news, 15.41 with it). So the existing features carry almost no usable signal about who is out. That override cannot
be said to "factor in" absences.

## Candidate (fixed now)
**Teammate-out lift.** For each player P and rotation teammate O (average >= 15 minutes over the team's last 10 games, appearing in at least 3), keep running
totals from EARLIER games only of P's minutes, points, rebounds, assists and threes when O played and when O was absent. For a game where a set of rotation teammates
is absent, the lift for a stat is the sum over absent teammates of `(mean when O out - mean when O in) * n_out / (n_out + 10)`, counted only if P has at least 3
earlier games with O in and at least 1 with O out. The adjusted projection is `mu + lift`, with the lift clipped to +/-30% of `mu`, floored at 0.1. PRA = points + rebounds + assists lifts.
No parameter is tuned: 10, 3, 1 and 30% are fixed here.

## Evaluation (fixed now)
- Folds as `evaluate.py`: A (train 2022-23, test 2023-24), B (2022-24 -> 2024-25), F (2022-25 -> 2025-26). Rotation players (last-10 minutes >= 20).
- "Absent" in the backtest = rotation teammates who did not appear in that game's box score. This is known only after the game, so it flatters the method compared
  with a pre-game injury report (late scratches, coach decisions and minor injuries differ). The result is an UPPER BOUND on the benefit of the method.
- Primary subset: player-games where at least one rotation teammate was absent (the only rows the method changes). Secondary: all rows.
- Metric: paired difference in per-row negative-binomial log score against the baseline `m2` (dispersion fitted as in `improve_model.py`, the same for both),
  95% week-block bootstrap CI. Also MAE and mean bias on the primary subset.

## Decision rule (fixed now)
**Adopted** only if, on the primary subset, the CI is above 0 for at least 3 of 4 stats in BOTH folds A and B, with no stat's CI entirely below 0 in either;
and fold F shows no stat entirely below 0. Anything else: not adopted, and the app says the model does not adjust for absences beyond what it already learns.

## What this cannot show
- No historical injury reports exist, so the real use (injury report as input) cannot be backtested; only the post-game absence version can.
- Nothing here involves a sportsbook line. Better accuracy against naive baselines is not an edge.
- Adopting it changes production projections and needs the owner's approval (given in general terms: "factor in players that are out"); a re-run of `calibrate.py` would follow.
