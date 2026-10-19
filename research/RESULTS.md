# Results

Rules were fixed in `PREREG.md` (commit `ee4119d`) before the held-out season was evaluated. The held-out
season was run once; `research/out/FINAL_RUN_DONE` blocks a second run.

## Held-out 2025-26 (trained on 2022-23 to 2024-25; 17,349 rotation player-games, 27,942 eligible)

Per-row negative-binomial log score, `m2` (boosted, Poisson loss) minus `app` (the model the app uses today).
Positive = `m2` better. 95% CI from resampling calendar weeks. Rotation players = last-10 minutes >= 20.

| Stat | Difference | 95% CI | MAE app -> m2 | Calibration slope app / m2 |
|------|-----------:|--------|---------------|----------------------------|
| PTS  | +0.0178 | [+0.0116, +0.0252] | 4.634 -> 4.579 | 0.476 / 0.851 |
| REB  | +0.0120 | [+0.0093, +0.0150] | 1.906 -> 1.898 | 0.699 / 0.889 |
| AST  | +0.0056 | [+0.0016, +0.0098] | 1.351 -> 1.330 | 0.703 / 0.919 |
| 3PM  | +0.0074 | [+0.0039, +0.0115] | 0.889 -> 0.897 | 0.916 / 0.866 |

## Against the pre-registered rules

- **H1 (accuracy): PASS.** All four CIs are entirely above 0 (rule: at least 3 of 4, none below).
- **H2 (calibration): PASS, narrowly.** All `m2` slopes are inside [0.85, 1.15]; points is 0.851, right at the edge.
- **H3 (market edge): NOT TESTED.** No historical sportsbook lines exist in this data. See "What this does not show".

## What the development folds added

With one training season, boosting was worse than the app's model. With two it was better on all four stats.
The held-out run trains on three seasons. Gains grow with data, so they are partly a data-size effect.

## What this does not show

- It does not show an edge over any sportsbook. Pseudo-lines are the player's own last-10 mean, far weaker
  than a book's line. Beating them says the model beats naive baselines.
- The gains are statistically reliable but small: about 1-1.5% lower error on points. A difference of 0.006 to
  0.018 nats per prediction is not, by itself, a betting edge.
- The app's own win probabilities were clearly overconfident (points slope about 0.48). Even the improved
  model is still mildly overconfident (slopes 0.85-0.92).
- "Who is out" is inferred from past appearances only; the official injury report is not used.

## Checks that guard these numbers

- `tests/test_leakage.py`: deleting the future or scrambling a day's results moves no feature (0 of 68);
  a control confirms the test can detect a change.
- `tests/test_port.py`: the Python port of the app model matches `shared/baseline.ts` to 2e-7 on random histories.
