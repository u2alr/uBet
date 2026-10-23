# Pre-registration: probability calibration and uncertainty (written before `research/calibrate.py` was run)

## What problem this fixes
The decision engine used two adjustments with no sound basis:
1. `p' = 0.5 + slope * (p - 0.5)` with `slope` the **logit-space** calibration slope from `RESULTS.md`. A logit slope cannot be applied
   in probability space; and it ignored any intercept (an overall lean to Under or Over).
2. A haircut of `0.5 * sqrt(p(1-p)/n)` with `n` = games of history. That treats a model probability as a binomial proportion
   estimated from `n` trials. It is not one, so the "standard error" was manufactured.

## Method (fixed in advance)
- **Predictions**: `m2_p` from `research/evaluate.py` (the boosted model, negative-binomial tail: the same model as production
  `gbm-v1`), at the same pseudo-lines (nearest half-integer to the player's last-10 mean). **These are not sportsbook lines.**
  Calibration is therefore of the model's predictive distribution, not of an edge over a market. Applicability to book lines is
  assumed, not shown, and is recorded in the artifact.
- **Population**: rows whose last-10 average minutes are at least 24 (the players the strict tier may bet on).
- **Walk-forward, never fitting on the data being judged**:
  - Calibrator trained on fold A out-of-sample predictions (test season 2023-24) and **validated on fold B** (2024-25).
  - The method is chosen by fold B log loss. The chosen method is then refit on A and B together and evaluated **once** on
    the 2025-26 season (final), whose predictions come from a model trained on 2022-24 only.
- **Candidates**: identity (raw); logistic (Platt) calibration on logit(p) with an intercept, applied symmetrically to the Under
  side as `1 - f(p_over)`; isotonic regression **only** when a statistic has at least 5,000 training rows **and** it beats Platt on
  fold B log loss by more than 0.0005 (a margin so that noise cannot pick the flexible method). Platt must beat identity on
  fold B log loss to be used at all.
- **Uncertainty**: bootstrap over **calendar weeks** (rows within a week are dependent) of the chosen method, 400 resamples,
  recorded as lower and upper bounds of the calibrated probability on a grid at 80%, 90% and 95% one-sided confidence. This is
  uncertainty in the calibration only. It deliberately does not add a per-player "standard error": none is available.
- **Gates (a statistic may be used for strict approval only if all hold on BOTH fold B and the final season)**:
  1. n >= 3,000 rows.
  2. Logit calibration slope of the *calibrated* predictions between 0.85 and 1.15.
  3. Expected calibration error (10 equal-width bins, bins with >= 30 rows) of the calibrated predictions <= 0.03.
  4. Calibrated log loss no worse than raw log loss + 0.001.
  A statistic that fails any gate is `unvalidated`, and the engine rejects it from strict approval (it may still appear as a
  research-only candidate).
- **Reported per statistic**: Brier score, log loss, ECE, slope with a week-bootstrap interval, n, for raw and calibrated.

## What this cannot show (stated up front)
- It does not validate the **blend with the market** or any edge against sportsbook prices: no historical lines exist.
- Pseudo-lines are far easier than book lines. A calibrated probability here says the model's distribution is honest about
  itself, not that its tails match a book's.
- The 2025-26 season was examined once before (`RESULTS.md`, to compare models). It is clean *for the calibrator* (nothing
  here was fitted to it) but not a pristine holdout for the model. The forward record in the app is the only untouched test.
- Many choices (method selection, gates) were fixed before looking, but four statistics and two validation sets are still
  several comparisons; results should be read with that in mind.

## Amendment A (written after the first run, before the artifact was used by anything)
The first run chose **identity** (no correction) for all four statistics: a logistic or isotonic calibrator trained on 2023-24
did not beat the raw model on 2024-25 log loss. That is the pre-registered selection rule working. It exposed a defect in the
artifact: for the identity method the stored lower and upper bounds equalled the calibrated value, i.e. **zero uncertainty**,
which would have made the "conservative" probability equal the raw one.
- **Fix**: when the method is identity, the bounds come from the model's own measured **reliability**: the observed Over rate among
  predictions near each probability (a window of at least 5 points, widened until it holds at least 300 rows), with calendar
  weeks bootstrapped 400 times; lower and upper are the one-sided quantiles at 80, 90 and 95%. The central value stays the raw
  probability (the rule chose identity), and the bounds are clipped to bracket it.
- The method choice, gates and every number in the evaluation are unchanged by this: the fix only fills in the bounds.
- The run is repeated to write the corrected artifact. The 2025-26 season is therefore read twice by the same script and the same
  fixed rules; it is not used to choose anything.
- Rows are now saved to `research/out/calibration_rows.npz` so the artifact can be rebuilt without retraining.

## What the first run showed (recorded because it matters for decisions)
- Fold B and the final season, raw model, last-10 minutes >= 24, pseudo-lines: `mean predicted P(over)` is below the observed Over
  rate for points (0.434 vs 0.459; final 0.430 vs 0.456) and assists (final 0.389 vs 0.442). The model leans **Under**, and the
  size of the lean is not stable between seasons (assists: fold B 0.437 vs 0.442, final 0.389 vs 0.442). A fixed intercept
  would not have generalised, which is why the selection rule preferred identity.
- Statistics that failed a gate on the final season: points (slope 0.828 < 0.85), assists (ECE 0.053 > 0.03). Rebounds and threes passed.

## Amendment B: PRA (points + rebounds + assists), written before `research/calibrate_pra.py` was run
PRA became a bettable market after this pre-registration, so it has no calibration entry and the engine treats it as research-only.
- **Scope**: exactly the method, gates, populations and folds above, applied to a fifth statistic `pra`. Nothing is changed for the other four;
  their entries in `shared/calibration.json` are kept byte for byte and the artifact hash is recomputed.
- **Model**: the production recipe for PRA (`research/project.py`): boosted model, Poisson loss, the same features, target = points + rebounds + assists;
  negative-binomial tail with dispersion fitted on the last 20% of the training period. Pseudo-line = nearest half-integer to the last-10 PRA mean
  (the sum of the three last-10 means, which is exactly the last-10 PRA mean).
- **Folds**: calibrator trained on fold A out-of-sample predictions, method chosen by fold B log loss, refit on A and B, evaluated once on 2025-26.
  The final season has not been used to evaluate PRA before. The same lock rule applies: `research/out/CALIBRATION_PRA_DONE` stops a second look.
- **Gates**: identical (n >= 3,000; slope 0.85 to 1.15; ECE <= 0.03; log loss no worse than raw + 0.001) on BOTH fold B and the final season.
  Failing any leaves PRA `unvalidated` (research-only in the Chief).
- **Still true**: pseudo-lines are not sportsbook lines; passing says the model's PRA distribution is honest about itself, not that it beats a market.
