# Pre-registration: game-winner model v5 candidates (schedule density, travel, late-season motivation, matchup style), written before any v5 feature was built or fitted

Question: does any of four more groups of factors improve the games-v2 win chance out of sample?

## What is new and what is a re-test
Rest days and back-to-back are already in games-v2. Travel (`away_miles`, `away_tz`, `away_road_trip`, `home_elev`) and matchup style (`mm_*`) were tested in the v1 model (PREREG_GAMES.md) but never on top of v2; they are re-tested here on top of the shipped model. Schedule density (3 games in 4 nights, 4 in 6, games in the last 7 days) and late-season motivation are new as game-model inputs.

## Candidate groups (every value uses only games on EARLIER dates; every feature is home minus away unless noted)
1. **DENSITY.** `three_in_four`, `four_in_six` (flags: this game is the third in four nights / fourth in six) and `g7` (games in the previous 7 days), from `human_factors.team_features`.
2. **TRAVEL.** `away_miles`, `away_tz` (eastward positive), `away_road_trip` (consecutive road games before this one), `home_elev` (all four already exist in the v1 frame) and `home_miles` (the home team's own distance from its previous game's city). Estimates from city coordinates, never flights.
3. **MOTIVATION (regular season only).** Team wins before the date are ranked inside the team's conference (hard-coded conference table). For a team with at least 50 games played: `cushion` = clip((wins - wins of the conference's 7th-best team) / (games left + 5), 0, 1), "comfortably above the play-in line"; `outofit` = clip((wins of the conference's 10th-best team - wins) / (games left + 5), 0, 1), "far behind the last play-in spot". Both are 0 before 50 games. Features: `cushion_diff`, `outofit_diff`. This is a proxy for incentives; tanking and rest decisions themselves are not observed.
4. **STYLE.** The four `mm_*` mismatch products (three-point volume, offensive rebounding, free throws, turnovers) from the v1 frame.

## Models (fixed now)
`lin_v2` (shipped) and `lin_v2` plus each group, one at a time. Same logistic, C = 0.5. Then `lin_v2` plus every group that passes, checked once.

## Experiment
Walk-forward as for v2, v3 and v4: E0 (test 2022-23), A (2023-24), B (2024-25), each trained on all earlier seasons back to 2018-19; F (2025-26) confirmation, seen before; 2026-27 so far descriptive.

## Decision rule (fixed now; stricter because four groups are tested)
A group is adopted only if its paired log-loss improvement over `lin_v2`, pooled over E0, A and B, has a **98.75% interval** (95% divided by four comparisons) entirely above 0, AND on F it is not worse than `lin_v2` by more than 0.001, AND its improvement has the same sign on at least two of the three development seasons. If several pass, the combined model is checked once on F and adopted only if not worse than the best single group by more than 0.001. If none passes, the result is published as a negative finding and nothing changes.

## Not claimed
No sportsbook edge: no historical game lines exist. Motivation uses only the standings, not what teams actually decided to do (rest, tank). Travel is estimated from city centres.

---

# Outcome (run once as specified: `research/game_eval_v5.py`, output `research/out/games_v5.json`)

**No group is adopted; games-v2 is unchanged.** Pooled over E0, A and B, paired change in log loss against `lin_v2` with the 98.75% interval the rule requires (positive is better):

| Group | Pooled change | 98.75% interval | Better in how many of E0, A, B | Adopted |
|---|---|---|---|---|
| Schedule density | +0.0001 | [-0.0006, +0.0009] | 2 | no |
| Travel (re-test on v2) | +0.0007 | [-0.0007, +0.0022] | 2 | no (interval includes 0) |
| Late-season motivation | +0.0002 | [-0.0008, +0.0011] | 1 | no |
| Matchup style (re-test on v2) | +0.0001 | [-0.0007, +0.0008] | 1 | no |

Travel is the largest and the only one that is positive on both E0 (+0.0013) and A (+0.0016), but it is negative on B (-0.0007) and its interval includes 0. Nothing else moves. The 2026-27 games so far (early season only) show density +0.0019 and motivation +0.0015 with travel and style negative; with so few games and no late-season games yet, that is not evidence either way. Motivation cannot be judged on 2026-27 until the season reaches its final 30 games.

Nothing is stored as a shadow: none of these shows a development-season signal worth a live test. Motivation will be re-run on the 2026-27 season's second half as a fresh descriptive check; it is not adopted unless a new pre-registered rule says so.
