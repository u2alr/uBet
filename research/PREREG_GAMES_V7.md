# Pre-registration: game-winner model v7 candidates (recent results read against who the opponent was missing), written before any v7 feature was fitted

Question: a team's recent results look better when the opponents were short-handed (the idea: "ATL nearly lost to an Indiana team with six players out"). games-v2 reads recent strength from ratings that adjust for the opponents' quality but not for who the opponents were missing. Does reading recent results against opponent absences improve the games-v2 win chance out of sample? (Streaks and close-game luck were already tested and changed nothing: PREREG_GAMES_V4.md, momentum -0.0000 [-0.0016, +0.0013].)

Every value for a game uses only games on EARLIER dates, over a team's last 5 games (at least 3 earlier games, else 0). The one same-game fact is who played in those earlier games (history): an upper bound for a live injury report, as in v3, v4 and v6. Features are home minus away. "Absent talent" is `ab_gs`: the summed prior-10-game mean Game Score of rotation players who did not play (`game_features.team_absences`, cross-season, as in games-v2).

## Candidate groups
1. **SOFTSCHED** (`soft5_diff`). The mean absent talent of the team's last 5 opponents. A high value means it faced short-handed teams, so its results should be trusted less.
2. **ADJFORM** (`net5_diff`, `adjnet5_diff`). `net5` = mean margin over the last 5 games; `adjnet5` = mean of (margin - 0.2 x (opponent absent talent - own absent talent)): the margin with both sides' absences taken out. 0.2 points per unit is FIXED here, not fitted. Both enter so the model can use their difference.
3. **FRAGILE** (`fragile5_diff`). The number of the last 5 games that were narrow results against a depleted opponent: a win by at most 6 points, or any loss, against an opponent missing at least 30 units of absent talent. 30 was chosen before any outcome was seen, from the distribution of absent talent alone (median 12.6, 90th percentile 37.6; 30 or more in 17% of team-games), because 20 (a single starter) occurs in a third of them and is not "depleted".

## Models (fixed now)
`lin_v2` (shipped) and `lin_v2` plus each group, one at a time. Same logistic, C = 0.5. Then `lin_v2` plus every group that passes, checked once.

## Experiment
Walk-forward exactly as for v2 to v6: E0 (test 2022-23), A (2023-24), B (2024-25), each trained on all earlier seasons back to 2018-19; F (2025-26) confirmation, seen before; 2026-27 so far descriptive. Week-clustered bootstrap, seed 0.

## Decision rule (fixed now; three groups are tested)
A group is adopted only if its paired log-loss improvement over `lin_v2`, pooled over E0, A and B, has a **98.3% interval** (95% divided by three comparisons) entirely above 0, AND on F it is not worse than `lin_v2` by more than 0.001, AND its improvement has the same sign on at least two of the three development seasons. If several pass, the combined model is checked once on F and adopted only if not worse there.

Nothing is tuned after the first run: the window (5), the minimum (3 games), the scale (0.2), the thresholds (6 points, 30 units) and the group definitions are final.

## Not claimed
No sportsbook edge: no historical game lines exist. The features use who actually played in past games, not who was listed, so a positive result would be an upper bound for what a live injury report could deliver.

---

# Outcome (run once as specified: `research/game_eval_v7.py`, output `research/out/games_v7.json`)

**No group is adopted; games-v2 is unchanged.** Pooled over E0, A and B, paired change in log loss against `lin_v2` with the 98.3% interval the rule requires (positive is better):

| Group | Pooled change | 98.3% interval | Better in how many of E0, A, B | Adopted |
|---|---|---|---|---|
| Soft schedule (opponents' absent talent) | +0.0002 | [-0.0010, +0.0015] | 2 | no (interval includes 0) |
| Absence-adjusted form | -0.0002 | [-0.0008, +0.0004] | 1 | no |
| Narrow results against depleted opponents | -0.0003 | [-0.0009, +0.0001] | 0 | no |

On the confirmation season F: soft schedule +0.0006, absence-adjusted form -0.0000, narrow results -0.0003 (all inside the "not worse than 0.001" band; the narrow-results group was measurably worse than `lin_v2` in A and F, where its 95% interval lies entirely below zero). On 2026-27 so far, absence-adjusted form shows +0.0010 [-0.0005, +0.0026]: too small, too early, and not read as evidence.

**What this says about "a team nearly lost to a depleted opponent".** Reading results against who the opponent was missing does not predict the next game better than the ratings games-v2 already uses. Narrow results against depleted teams, if anything, add noise. The idea was reasonable and is now tested; it is not a hidden edge.

**What happens next.** Nothing is displayed or stored as a shadow. One caveat for any later look: the features use who actually played in past games, which is the best case for an injury-report version, so a failure here is a failure of the best case.
