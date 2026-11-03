# Pre-registration: game-winner model v2, written before any v2 model was fitted

Question: can a richer model than `games-v1` (home advantage + margin-aware Elo + availability, logistic) predict which team wins better, out of sample, on games it has not seen? "Better" means lower log loss, with calibration kept, measured against v1 on the same games.

## What is being added (every value uses only games on EARLIER dates)

1. **Opponent-adjusted margin ratings (SRS).** A ridge regression of each game's margin (clipped to +-25) on home-minus-away team indicators plus a home-court term, with every past game weighted by `0.5 ** (days_ago / H)`; the offseason counts as at most 45 days. Ridge strength 10 (fixed). The rating of every team comes from solving ALL past games at once, so "ATL beat the Lakers, MEM lost to the Lakers" (and every longer chain) is used together with all other results, with the strength of each opponent accounted for. Three memory lengths: H = 30, 60, 120 days (`srs30`, `srs60`, `srs120`), each as home minus away.
2. **Talent-weighted availability (`ab_gs`).** Same absent-rotation definition as v1's AVAIL3, but each absent player counts by his average Hollinger Game Score over the team's previous 10 games instead of by minutes and points. Home minus away.
3. **Common-opponent tally (`co_diff`).** `shared/teamForm.ts` logic: over the last 400 days, for each opponent both teams have played, which team's most recent result was better; (home count - away count) / number of opponents with a difference.
4. **Schedule** (`rest_diff`, `b2b_home`, `b2b_away`): carried from v1's SCHEDULE group, not new.

## Models (fixed now, nothing tuned on a test season)

| Name | What |
|---|---|
| `elo` | logistic on `elo_diff` |
| `v1` | logistic on `elo_diff` + AVAIL3 (the model in production) |
| `lin_v2` | logistic, L2 with C = 0.5, on `elo_diff`, `srs30`, `srs60`, `srs120`, the six AVAIL3 columns, `ab_gs`, `co_diff`, and the schedule columns |
| `gbm_v2` | `HistGradientBoostingClassifier(max_depth=3, learning_rate=0.03, max_iter=250, min_samples_leaf=60, l2_regularization=5)` on the `lin_v2` columns plus net rating windows |
| `blend` | mean of the `lin_v2` and `gbm_v2` probabilities |

Median imputation and standardisation use the training rows only. Information-only ablations add one group at a time to `v1`.

## Experiment

Walk-forward by season on regular-season games, as for v1: fold A (train 2022-23, test 2023-24), fold B (train 2022-24, test 2024-25), fold F (train 2022-25, test 2025-26). Fold F was already used for v1, so it is confirmation, not a pristine holdout. The 2026-27 season so far is scored once, descriptively, as a small genuinely new sample. The paired log-loss difference against `v1` uses the same week-clustered bootstrap as the other studies.

## Decision rule (fixed now)

The candidate is whichever of `lin_v2`, `gbm_v2`, `blend` has the lowest mean log loss over folds A and B. It replaces v1 in the app only if (a) its paired improvement over v1, pooled over A and B, has a 95% interval entirely above 0, and (b) on F its log loss is not worse than v1's by more than 0.001, and (c) its calibration slope on F is between 0.9 and 1.1. Otherwise v1 stays and the result is published as a negative finding.

## Not claimed

Beating v1 is not an edge over sportsbooks: no historical game lines exist to test against. Availability is tested with who actually sat out (an upper bound for a live injury report). No profit claim is made.

---

# Outcome of the experiment above (recorded before the addendum below was written)

Run once, as specified. Log loss against v1, paired, week-clustered 95% interval: `lin_v2` +0.0056 on A, +0.0022 on B, +0.0036 on F (every point estimate favours v2); pooled over A and B +0.0039 with an interval of [-0.00004, +0.0080]. `gbm_v2` was worse than v1 on A and B (it overfits one or two seasons of training data). **Decision under the rule above: v2 is not adopted.** Condition (a), the interval entirely above zero, narrowly failed; (b) and (c) passed. v1 stays the displayed model.

# Addendum (written BEFORE the extended-history data was pulled or any model was refit on it): does more history change the answer?

**Why.** The one clear weakness is data volume: fold A trains on a single season, which is also why the boosted model overfits. NBA.com serves a season in one request, so four more seasons (2018-19 to 2021-22) can be added.

**What changes.** `research/pull_history.py` writes those seasons (regular season only) to `research/data/history/`, separate from the files the rest of the app reads, so v1 and everything else are untouched. History seasons are used for TRAINING and rating warm-up only. Same features, same five models, same hyperparameters as above.

**Folds.** E0 (train 2018-22, test 2022-23), A (train 2018-23, test 2023-24), B (train 2018-24, test 2024-25), F (train 2018-25, test 2025-26). In every fold v1 is refit on the same extended history, so the comparison is like for like. E0, A, B are development; F is confirmation (seen before, so not pristine); the 2026-27 games played so far are scored once, descriptively.

**Decision rule (new, fixed now).** Candidate = lowest mean log loss over E0, A, B among `lin_v2`, `gbm_v2`, `blend`. It replaces v1 only if the paired improvement over v1 pooled over E0, A, B has a 95% interval entirely above 0, AND on F its log loss is not worse than v1's by more than 0.001, AND its calibration slope on F is between 0.9 and 1.1.

**Honest limits.** All four test seasons have been looked at in some form, so this is a second experiment on already-seen seasons, adopted only because the volume argument was made before it was run. The only data no one has looked at is the live stream of games from now on: `game_lean_log` records every prediction before tip-off, and `research/game_report_v2.py` scores the displayed model on that stream as games finish.

# Outcome of the addendum (recorded before the model was deployed)

Run once as specified (`research/game_eval_v2.py`, output `research/out/games_v2h.json`; 9,598 regular-season games, 2018-19 to 2026-27). `lin_v2` had the lowest mean development log loss (0.6084 against `blend` 0.6114 and `gbm_v2` 0.6177). Paired against v1 refit on the same history: pooled over E0, A and B **+0.0046 log loss, interval [+0.0021, +0.0071]**, entirely above zero. On F it is better by +0.0046 (0.5842 against 0.5888) with a calibration slope of 1.08. All three conditions hold, so **by the rule fixed above, `lin_v2` replaces v1** as the model behind "our chance". What this does not show: accuracy is about the same (68.2% against 68.9% on F, the log-loss gain is in the probabilities, not in more correct picks); the boosted model never beat the linear one, so extra model complexity did not help at this data size; and none of it has been tested against sportsbook prices. The 2026-27 games so far (89) favour `lin_v2` over v1 (0.637 against 0.666) but are far too few to count as evidence.

# Last addendum (after the model was chosen; a simplification, not a new claim): the common-opponent input is removed

The product owner asked that last season's and the preseason's matchups play no part, and the page now uses this season's regular-season games only. The model's `co_diff` input looked 400 days back, across seasons, so it was the one place older matchups still entered. A paired ablation on the same four folds showed it adds nothing: dropping it changes log loss by -0.0002, -0.0000, +0.0005 and +0.0000 (E0, A, B, F; mean +0.0001, positive meaning dropping it is better). It was therefore removed from `lin_v2` (and so from `gbm_v2`), and the evaluation was re-run so the published numbers describe the model that ships. The decision rule was not changed and was re-applied to the re-run; its outcome is in `RESULTS_GAMES_V2.md`. The common-opponent tally is still computed for display, from this season's regular-season games only, as context.
