# Pre-registration: held-out evaluation of the prop models

Written and committed BEFORE the 2025-26 season is evaluated. Nothing below may be changed after the
held-out run; a new experiment needs a new file and a new held-out period.

## What the development folds already showed (seasons 2022-23 to 2024-25; fixed hyperparameters, no tuning)

- With one season of training data, gradient boosting was WORSE than the app's current model; with two
  seasons it was better on all four stats (per-row log score +0.009 to +0.025 nats, 95% CIs above 0).
  So the result depends on training-set size. The held-out run trains on three seasons.
- The app's own `P(over)` was overconfident on pseudo-lines (calibration slope about 0.5 for points,
  0.7 for rebounds and assists, about 0.95 for threes; 1.0 is calibrated).
- None of this involves a sportsbook line. No market comparison has been made.

## Candidate and comparators (fixed now)

- Candidate: `m2` = HistGradientBoosting, Poisson loss, hyperparameters exactly as in `models.HGB`.
- Comparators: `app` (exact port of `shared/baseline.ts`, verified against the TypeScript), `b1` (last-10 mean).
- Distribution for scoring: negative binomial, dispersion fitted on the last 20% of the training period.
- Train: seasons 2022-23, 2023-24, 2024-25. Test: 2025-26 (regular season and playoffs). Unit: eligible
  player-games (at least 5 prior games). Primary subset: rotation players (last-10 minutes >= 20).

## Hypotheses and pass/fail rules

**H1 (accuracy).** On the rotation subset, `m2` beats `app` on mean per-row negative-binomial log score.
PASS if, for at least 3 of the 4 stats (pts, reb, ast, fg3m), the 95% week-block bootstrap CI of the paired
difference lies entirely above 0, AND no stat has a CI entirely below 0. Otherwise FAIL.

**H2 (calibration).** On pseudo-line probabilities, the calibration slope of `m2` is within [0.85, 1.15]
for every stat. (The slope of the app's native probability is reported for comparison but is not a pass condition.)

**H3 (market edge): NOT TESTABLE with this data.** There are no historical sportsbook lines. It can only be
tested forward: picks are logged frozen with price and timestamp, and the raw odds are captured so the closing
price is known. Required before any claim of edge: at least 1,000 graded frozen bets, mean closing line value
above 0, and a 95% bootstrap CI that excludes 0. Below 500 bets, no conclusion is allowed in either direction.

## Decision rules

- H1 and H2 pass: recommend replacing the app's mean and distribution with the candidate (projection from the
  boosted model, negative-binomial tail). This is a claim about accuracy against naive baselines ONLY.
  Changing what users see needs the owner's approval.
- H1 passes, H2 fails: recommend only recalibrating the app's probabilities (negative-binomial dispersion).
- H1 fails: keep the app's model; still recalibrate the probabilities if the app's slope is below 0.85.
- In every case the model/market blend weights stay labeled UNVALIDATED until H3 data exists.

## Known weaknesses (declared in advance)

- "Who is out" is approximated from past appearances only. The official injury report is not used.
- No historical odds, so pseudo-lines are naive; beating them is a low bar.
- Rosters include only players with recorded minutes; late scratches are invisible until after the fact.
- Free-tier odds credits are too few to capture a full season of closing lines.
