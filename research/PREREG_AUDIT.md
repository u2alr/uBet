# Pre-registration: distribution choice and the confidence score (audit)

Written BEFORE `dist_study.py` and `confidence_check.py` were run. Development folds only
(A: train 2022-23 -> test 2023-24; B: train 2022-23 + 2023-24 -> test 2024-25). The 2025-26 held-out season was
spent on the accuracy question in `PREREG.md` and is NOT used here. A distribution chosen on these folds is
therefore unconfirmed until forward data (logged picks, Kalshi) can check it.

## Question 1: is the app's rule "Poisson if mean < 6, else normal" appropriate?

Design: the MEAN is held fixed at the app's own weighted mean (so only the distribution varies), for all six stats
(pts, reb, ast, fg3m, stl, blk). Candidates, each scored on the same rows:

- `native`   the app's rule: Poisson when mean < 6, normal(mean, spread) otherwise
- `poisson`  Poisson everywhere
- `nb`       negative binomial, dispersion alpha(mean) fitted on the last 20% of the training period
- `nb_const` negative binomial with one fitted alpha per stat
- `normal`   normal(mean, spread) everywhere, discretised with a continuity correction

Metric: mean per-row log score of the observed count (proper scoring rule; higher is better). Secondary:
calibration slope and Brier score on pseudo-lines (the half-integer nearest the last-10 mean).
Buckets: mean < 2, 2 to 6, >= 6. Uncertainty: 95% interval from resampling calendar weeks.

Decision rule: a candidate replaces `native` for a (stat, bucket) cell ONLY IF its log-score advantage over
`native` is positive with a 95% interval above 0 in BOTH folds. Otherwise `native` stays. No cell may be
chosen after looking at results; cells with fewer than 400 rows in a fold are reported but cannot trigger a change.

## Question 2: does the confidence score mean anything?

Definition under test (from `shared/baseline.ts`): `round(100 * (0.5*min(nEff/25, 1) + 0.5*(1 - min(cv, 1))))`
with `cv = spread / mean`. It currently scales the model's weight in the model/market blend.

Design: within each stat, split test rows into confidence terciles. Compare the top and bottom tercile on
(a) relative absolute error |y - mean| / max(mean, 1) and (b) Brier score of the app's native over-probability on
pseudo-lines.

Decision rule: the score is "meaningful" only if the top tercile has LOWER error AND lower Brier than the bottom
tercile, with 95% intervals excluding 0, in BOTH folds, for at least 3 of the 6 stats. Otherwise it carries no
validated information, must stop influencing probabilities, and is to be relabelled for what it actually measures.
Also reported: how much of its variation is just the stat type (cv depends on the mean), which would show it is
not measuring forecast quality.

## Declared limits

- The mean predictor is the app's baseline, not the boosted model; conclusions are about the fallback path.
- Pseudo-lines are not sportsbook lines.
- Two folds with overlapping training data are not independent evidence.
