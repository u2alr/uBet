# Pre-registration: research-only context features (written before `research/context_model.py` was run)

Nothing here changes production. The context layer is OPTIONAL and OFF: it can neither alter a pick nor feed an approval gate. This file fixes what is tested, how, and what would count as evidence.

## Scope: what is measurable here, and what is not
Built only from data in this repository (box scores and a static table of team home cities). Everything uses games strictly before the game being predicted.

| Group | Feature (all prior-only) | Source and availability time |
|---|---|---|
| FATIGUE | `g7`, `g14`: the player's games in the previous 7 / 14 days. `min7`: his minutes in the previous 7 days. `three_in_four`: 1 if he played at least 2 games in the previous 3 days. `ot_recent`: overtime games among his team's last 5 (team minutes > 240). | box scores, available after each prior game ends |
| TRAVEL | `miles_prev`: distance between the previous game's city and this game's city. `tz_shift`: hours of time-zone change, eastward positive. `road_trip`: consecutive away games before this one. | box-score MATCHUP + a static table of city coordinates and time zones (public geography), known before the game; `NaN` after a gap over 10 days |
| PRESSURE | `close_share10`: share of his last 10 games decided by 5 points or fewer (final margin). `close_diff_<stat>`: per-minute production in his close games minus his other games over the last 20, shrunk by n/(n+5), 0 with fewer than 3 close games. | final margins from the team box scores; this is game-level closeness, NOT clutch-minute performance (no play-by-play data exists here) |
| ROLE | `min_delta` = last-5 minus last-20 average minutes; `min_cv10` = coefficient of variation of his last 10 minutes. | box scores |
| CONTINUITY | `overlap`: share of the team's players with 10+ minutes in its previous game who also played 10+ in the game before. | box scores |

**Not built, and why:** coaching changes, starting-lineup status, confirmed injury reports (no historical data in the repository; see `research/INJURY_FEATURES.md`), play-by-play pressure
statistics (no data), motivation or psychological labels (unsupported by any data source; none will be inferred). Travel is limited to what a city table can say: it ignores flights, arrival times and rest quality.

Already represented by the existing 68 features (so a gain is not expected and is checked, not assumed): rest days and back-to-back (`p_rest`, `own_rest`, `own_b2b`), recent minutes trends (`min_l3 ... min_l40`, `min_sd10`),
absent rotation minutes (`miss_prev`, `miss_prev2`, `n_rotation`), playoffs flag.

## Evaluation (fixed now)
- Folds exactly as `evaluate.py` and `improve_model.py`: A (train 2022-23, test 2023-24), B (train 2022-24, test 2024-25), F (train 2022-25, test 2025-26). Rotation players (last-10 minutes >= 20). Dispersion fitted once from the baseline and reused (the comparison is about the mean).
- Variants per stat (pts, reb, ast, fg3m): baseline; baseline + each group alone (ablation); baseline + all groups.
- Primary metric: paired difference in per-row negative-binomial log score against the baseline, 95% week-block bootstrap interval. Secondary: calibration slope and intercept on pseudo-lines, mean bias, MAE, and coverage (share of test rows with the feature present).
- **Development folds A and B decide. The final season F is used ONCE, only to confirm a group that already passed on A and B, and never to choose or tune anything.**

## Decision rule (fixed now)
A group is **kept as an experimental research feature** only if, on BOTH A and B, its interval is entirely above 0 for at least 3 of 4 stats and no stat's interval is entirely below 0; and on F no stat is entirely below 0.
Anything else: **dropped** (the code may stay, switched off). Subgroup searches cannot rescue a dropped group. Even a kept group stays research-only: using it in production needs its own pre-registration, calibration, and explicit approval.
Twenty-four group-stat-fold comparisons is a lot; a single marginal interval is not evidence.

## What this cannot show
Not market-beating ability: nothing here involves a sportsbook price. 2025-26 was examined by earlier experiments, so F is a confirmation, not a pristine holdout. Travel and fatigue effects measured on box scores may reflect schedule strength and selection, not causation.
