# Pre-registration: two candidate improvements to the projection model (written before `research/improve_model.py` was run)

## What the diagnostics showed (`research/diagnose_bias.py`, descriptive only)
Actual minus projected mean for rotation players (last-10 minutes >= 24), model `m2` as in production (`gbm-v1`):
- With one training season the bias is large (fold A: points +3.9%, threes +10.2%, rebounds -4.3%).
- With two seasons it is small (fold B: every stat within +/-2.2%).
- In the final season it is small except **assists, +7.0%**: the league produced more assists than the older seasons implied.
So much of the "lean" is **league-wide drift between seasons**, which a model trained on past seasons cannot see. It is not a stable
constant, which is why a fixed intercept did not generalise (see `PREREG_CALIBRATION.md`).

## Candidates (fixed now)
- **C1: online drift correction.** After the model is fitted, scale each projected mean by `1 + c`, where `c` is the shrunk league-wide
  relative residual over the previous 30 days, per stat, using only games strictly before the game's date:
  `c = (sum(y - mu) / sum(mu)) * n / (n + 1000)`, `n` = rows in the window, `c` clipped to [-0.15, 0.15]. No parameter is tuned.
- **C2: head-to-head features.** Add to the model's inputs, from earlier games only: `h2h_n` (earlier games by this player against this
  opponent, any season) and `h2h_diff = (mean of that stat in those games - the player's last-40 mean) * h2h_n / (h2h_n + 3)`.
- **C3:** both.
- Baseline: `m2`, hyperparameters unchanged (`models.HGB`).

## Evaluation (fixed now)
- Walk-forward folds exactly as `evaluate.py`: A (train 2022-23, test 2023-24), B (train 2022-24, test 2024-25), F (train 2022-25,
  test 2025-26). Rotation subset: last-10 minutes >= 20. Negative-binomial log score with dispersion fitted on the last 20% of the
  training period from the baseline model (the same dispersion for every candidate, so the comparison is about the mean).
- Primary metric: paired difference in per-row log score versus baseline, 95% week-block bootstrap CI.
- Secondary: MAE, calibration slope and intercept on pseudo-lines (nearest half-integer to the last-10 mean).

## Decision rule (fixed now)
A candidate is **adopted** only if, on the development folds A and B, its CI lies above 0 for at least 3 of 4 stats on both folds and no stat
has a CI entirely below 0 on either; **and** on F no stat has a CI entirely below 0. Anything else: not adopted, results reported as they are.
Four stats x three candidates x three folds is many comparisons; a single marginal CI is not evidence. Folds A and B choose; F only confirms.

## What this cannot show
- Nothing here involves a sportsbook line. Better accuracy against naive baselines is not an edge over the market.
- 2025-26 was examined in earlier experiments, so F is a confirmation, not a pristine holdout. Only the forward record is.
- Adoption would still need the owner's approval before the production projections change, and a re-run of `calibrate.py`.
