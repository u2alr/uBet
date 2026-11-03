# Pre-registration: game-winner model v6 candidates (four factors, early-season uncertainty, player-built talent, star concentration, pace and variance), written before any v6 feature was built or fitted

Question: does any of five more groups of factors improve the games-v2 win chance out of sample? Every value for a game uses only games on EARLIER dates, except the one same-game fact used by v3 and v4 as well: who played (history), an upper bound for a live injury report. Features are home minus away unless noted.

## Candidate groups
1. **FOURFACTORS** (`ff_efg`, `ff_tov`, `ff_orb`, `ff_ftr`). Per game and team: effective field-goal share (FGM + 0.5 FG3M) / FGA, turnovers per possession, offensive-rebound share OREB / (OREB + opponent DREB), and free-throw rate FTA / FGA, for the team (what it produced) and for its opponent in that game (what it allowed). Opponent adjustment: a team's produced value minus the opponent's prior decayed average ALLOWED for that factor; its allowed value minus the opponent's prior decayed average PRODUCED. Each is then a decayed average over the team's earlier games (half-life 20 games, carried across seasons). The feature for a factor is produced-adjusted minus allowed-adjusted (turnovers: allowed minus produced, because forcing them is good).
2. **UNCERTAINTY** (`early`, `early_x_elo`, `early_x_srs60`). `early` = 1 - min(average of the two teams' games played this season, 20) / 20. The interactions let the model trust ratings less early in a season. `early_x_elo` = `early` x `elo_diff`; `early_x_srs60` = `early` x `srs60`. (`early` itself is a home-and-away SUM, not a difference.)
3. **PLAYERRATING** (`tal_diff`). Sum over the players who play of (their mean minutes over their previous 10 appearances, capped at 36) x (their mean Game Score over their previous 20 appearances) / 240, a roster-built team strength that is independent of the team's own results. Players need 3 earlier appearances.
4. **CONCENTRATION** (`conc_diff`, `conc_x_abgs`). `conc` = the summed talent of the team's two most talented players who play, over the summed talent of all who play with talent above 0. `conc_x_abgs` = the average of the two teams' `conc` x `ab_gs`: stars matter more when a star is missing.
5. **PACEVAR** (`pace_l20`, `sd_sum`, `sd_x_srs60`). The existing sum of the two teams' recent pace, `sd_sum` = the sum of the two teams' standard deviation of margin over their last 20 games, `sd_x_srs60` = (`sd_sum` / 2) x `srs60`.

## Models (fixed now)
`lin_v2` (shipped) and `lin_v2` plus each group, one at a time. Same logistic, C = 0.5. Then `lin_v2` plus every group that passes, checked once.

## Experiment
Walk-forward as for v2 to v5: E0 (test 2022-23), A (2023-24), B (2024-25), each trained on all earlier seasons back to 2018-19; F (2025-26) confirmation, seen before; 2026-27 so far descriptive.

## Decision rule (fixed now; stricter because five groups are tested)
A group is adopted only if its paired log-loss improvement over `lin_v2`, pooled over E0, A and B, has a **99% interval** (95% divided by five comparisons) entirely above 0, AND on F it is not worse than `lin_v2` by more than 0.001, AND its improvement has the same sign on at least two of the three development seasons. If several pass, the combined model is checked once on F and adopted only if not worse than the best single group by more than 0.001. If none passes, the result is published as a negative finding and nothing changes.

Calibration is also reported, for information only: the slope of outcome on the logit of the prediction for `lin_v2` and for UNCERTAINTY, in the first 20 games of a season and after. It cannot adopt anything.

## Not claimed
No sportsbook edge: no historical game lines exist. PLAYERRATING and CONCENTRATION use who actually played, not who was listed.

---

# Outcome (run once as specified: `research/game_eval_v6.py`, output `research/out/games_v6.json`)

**No group is adopted; games-v2 is unchanged.** Pooled over E0, A and B, paired change in log loss against `lin_v2` with the 99% interval the rule requires (positive is better):

| Group | Pooled change | 99% interval | Better in how many of E0, A, B | Adopted |
|---|---|---|---|---|
| Four factors (opponent-adjusted) | -0.0007 | [-0.0017, +0.0002] | 1 | no |
| Early-season uncertainty | +0.0003 | [-0.0007, +0.0014] | 3 | no (interval includes 0) |
| Player-built talent | +0.0012 | [-0.0018, +0.0042] | 2 | no |
| Star concentration | +0.0017 | [-0.0004, +0.0037] | 3 | no (interval includes 0) |
| Pace and variance | -0.0003 | [-0.0008, +0.0002] | 0 | no |

Per season (E0, A, B, F): player-built talent +0.0035, +0.0027, -0.0027, +0.0024; star concentration +0.0014, +0.0030, +0.0007, +0.0015 (positive in all four, the steadiest of the five, but too small to clear the interval). Both use who actually played, an upper bound for a live injury report, so even their positive results are optimistic.

**Calibration (information only).** Early in a season (the first 20 games of either team) `lin_v2`'s calibration slope was 0.59, 1.30, 1.04 and 1.08 in E0, A, B and F, against 0.92, 1.07, 1.12 and 1.08 later: more erratic early, with no consistent direction. The uncertainty interactions moved these slopes by at most 0.06 and did not make them more stable.

**2026-27 so far (89 early games).** Player-built talent shows +0.025 and star concentration -0.004. That fold is both tiny and early, and player-built talent leans on who played, so it is not read as evidence. It points the same way as importance did (+0.019 on the same games), which is consistent with the "who played" signal being an upper bound for a live injury report, not with a model improvement.

**What happens next.** Nothing is displayed or stored as a shadow. Star concentration, positive in all four tested seasons, is the one worth a new pre-registered test once injury-report history exists, because then it can be measured without the who-played shortcut.
