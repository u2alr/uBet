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

## Result (development folds A and B; fold F not run because the rule failed)
Source: `research/out/teammate_out_dev.json`. Paired difference in negative-binomial log score on the player-games the lift changes (positive = better):
| fold | pts | reb | ast | 3pm | PRA |
|---|---|---|---|---|---|
| A | -0.0222 [-0.0273, -0.0168] | -0.0272 [-0.0313, -0.0228] | -0.0141 [-0.0179, -0.0103] | -0.0133 [-0.0171, -0.0095] | -0.0358 [-0.0442, -0.0280] |
| B | -0.0258 [-0.0333, -0.0189] | -0.0212 [-0.0249, -0.0170] | -0.0181 [-0.0226, -0.0136] | -0.0158 [-0.0188, -0.0130] | -0.0297 [-0.0373, -0.0224] |

**Not adopted, and clearly so**: every CI is entirely below 0 on every stat in both folds, even though the backtest gives the method the absentees that the box score reveals
after the game (an upper bound on what an injury report could provide). MAE got worse on all of them. Likely reasons, none tested here: with the 15-minute rotation rule 77% of
player-games have at least one "absent rotation teammate", so the lift is applied almost everywhere and double counts what the model's season and recent averages already contain
(those averages include the games without the teammate). Changing the rule to fix this would be a new experiment with a new pre-registration, not a tweak of this one.

## What this means for the app
- Production projections do NOT apply the lift.
- `research/project.py` does read the injury report, but only to set the existing `miss_prev` features and to drop players listed Out. Measured effect on a teammate of an
  absent star is about +/-0.1 points, i.e. the model learned almost nothing from those features. The app therefore shows who is out so the reader can judge for themselves,
  and does not claim the projections account for it.
