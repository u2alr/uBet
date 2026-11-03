# Pre-registration: game-winner model v4 candidates (momentum, importance, chemistry, home-court, luck), written before any v4 feature was built or fitted

Question: does any of six extra groups of factors improve the games-v2 win chance out of sample? They come from the product owner's list ("momentum, player importance, team chemistry ...") plus four suggestions.

## What cannot be tested
**Player feuds ("beef").** There is no data on them: it would need a news or social feed with a labelled history of which players were feuding when, and the effect, if any, is too small and too confounded to measure from a few hundred events. Nothing is built and nothing is claimed.

## Candidate groups (every value uses only games on EARLIER dates; every feature is home team minus away team)
1. **MOMENTUM.** `win5`: win share over the team's last 5 games, shrunk toward 0.5 by n/(n+2). `streak`: the signed current win or loss streak, capped at 8. `trend`: average margin over the last 5 games minus over the last 20, clipped at +-15. (The ratings already contain a 30-vs-120 day trend; this tests whether the raw streaks add anything.)
2. **IMPORTANCE.** `star2`: the summed talent (Game Score mean over the last 20 appearances) of the two most talented rotation players who play (history) or are not listed Out (live). `top_absent`: the highest talent among rotation players who do not play.
3. **CHEMISTRY (a proxy).** `stab`: the average overlap (Jaccard) between the top-8-by-minutes players of consecutive games over the team's previous 10 games. High means a settled rotation. Chemistry itself is not measurable from box scores; this is only a stability proxy.
4. **HOME-COURT, team-specific.** `hsplit`: half the difference between the team's decayed average margin at home and on the road (decay 0.98 a game, shrunk by m/(m+10), m the smaller of its home and road game counts).
5. **CLOSE-GAME LUCK.** `close`: a decayed (0.97 a game) excess of close wins (margin of 5 or fewer) over close losses, shrunk by 1/(n+10), to test whether close-game records regress.
6. **SHOOTING LUCK.** `shot`: the team's three-point percentage over its last 10 games minus over its last 40.

## Models (fixed now)
`lin_v2` (shipped) and `lin_v2` plus each group, one at a time. Same logistic, C = 0.5. Then `lin_v2` plus every group that passes, checked once.

## Experiment
Walk-forward as for v2 and v3: E0 (test 2022-23), A (2023-24), B (2024-25), each trained on all earlier seasons back to 2018-19; F (2025-26) confirmation, seen before; 2026-27 so far descriptive.

## Decision rule (fixed now; stricter because six groups are tested)
A group is adopted only if its paired log-loss improvement over `lin_v2`, pooled over E0, A and B, has a **99.17% interval** (95% divided by six comparisons) entirely above 0, AND on F it is not worse than `lin_v2` by more than 0.001, AND its improvement has the same sign on at least two of the three development seasons. If several pass, the combined model is checked once on F and adopted only if not worse than the best single group by more than 0.001. If none passes, the result is published as a negative finding and nothing changes.

## Not claimed
No sportsbook edge: no historical game lines exist. Importance uses who actually played, an upper bound for a live injury report.

---

# Outcome (run once as specified: `research/game_eval_v4.py`, output `research/out/games_v4.json`)

**No group is adopted; games-v2 is unchanged.** Pooled over E0, A and B, paired change in log loss against `lin_v2` with the 99.17% interval the rule requires (positive is better):

| Group | Pooled change | 99.17% interval | Better in how many of E0, A, B | Adopted |
|---|---|---|---|---|
| Momentum | -0.0000 | [-0.0016, +0.0013] | 2 | no |
| Importance | +0.0033 | [-0.0009, +0.0075] | 2 | no (interval includes 0) |
| Chemistry (stability proxy) | +0.0001 | [-0.0002, +0.0003] | 2 | no |
| Home-court, team-specific | -0.0000 | [-0.0005, +0.0005] | 1 | no |
| Close-game luck | -0.0000 | [-0.0002, +0.0002] | 2 | no |
| Shooting luck | -0.0002 | [-0.0004, +0.0001] | 1 | no |

Momentum, chemistry, home-court, close-game luck and shooting luck change nothing measurable. Importance is the only one with a visible effect: +0.0045 on F (95% interval [-0.0003, +0.0092]) and +0.0191 on the 89 games of 2026-27 so far (interval [+0.0172, +0.0210]), but its pooled development interval includes 0.

**Exploratory, found after looking and therefore NOT evidence for adoption.** Splitting importance by season phase (early = either team under 15 games): later games +0.0031, +0.0040, +0.0017, +0.0025 in E0, A, B and F (positive in all four); early games +0.0110, +0.0158, -0.0114, +0.0132 (2024-25 negative). That points to a small, steady effect once the season is under way, which is a hypothesis for a new test, not a result. The 2026-27 sample contains only early games.

**What happens next.** Importance (and the returning-players feature of `PREREG_GAMES_V3.md`) are stored as SHADOW predictions beside the shipped one before every game (`game_lean_log`, migrations 0025 and 0026), never displayed. They will be scored on the live games nobody has seen; a new pre-registered rule, written now: importance is adopted only if, over at least 300 live games, its paired log-loss improvement over games-v2 has a 95% interval entirely above 0.
