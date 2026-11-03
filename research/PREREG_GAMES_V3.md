# Pre-registration: game-winner model v3 candidates, written before any v3 feature was built or any model fitted

Question: do two missing factors improve the games-v2 win chance out of sample? (1) **Returning players:** the ratings remember the games a star missed, so a returning star's team is underrated (and a team losing a regular is overrated until the ratings catch up). (2) **A roster-aware preseason prior:** early in a season the ratings carry last season's team, ignoring how much of it came back.

## What cannot be tested, and why
Questionable and Doubtful statuses (how often such players actually play) need historical injury reports. None exist in our data: ESPN's feed shows only today's list, and `injury_log` started recording on 2026-11-03. Nothing is claimed about them. `research/injury_outcomes.py` joins that log to who actually played, so the question can be answered once enough games have passed. The returning-player test below uses who actually played, like the availability test for v1 (`PREREG_GAMES.md`): an upper bound for a live injury report.

## Features (every value uses only games on EARLIER dates)
**Returning players (`rd_diff`).** For each player, his talent `V` is his mean Hollinger Game Score over his last 20 appearances before the game (at least 3). A player is a rotation candidate for a team if his average minutes over his last 10 appearances before the game was at least 18 and his most recent appearance was for that team. For a team-game, `roster_delta = sum over candidates of V * (played_today - play_rate_20)`, where `play_rate_20` is the share of the team's previous 20 games he played. Positive: today's roster is stronger than the one the recent results came from (a star is back). Negative: a regular is missing. A player absent for the whole window contributes zero (the ratings already know). The feature is home minus away.

**Preseason prior (`prior_early`).** `last_final` is the team's opponent-adjusted rating (120-day memory) before its last game of the previous season. `continuity` is the share of the team's rotation minutes over its previous 10 games this season (all of them in the same season) played by players who had at least 200 minutes for that team last season; before the first game, 0.6. `w = max(0, 1 - n/25)`, with n the team's games this season so far. `prior_early = w * continuity * last_final`, home minus away (zero when there was no previous season). A variant without continuity, `prior_early_raw = w * last_final`, is reported for information only.

## Models (fixed now; nothing tuned on a test season)
`lin_v2` (the shipped model, from `research/game_features_v2.py`), `lin_v2 + rd_diff`, `lin_v2 + prior_early`, and `lin_v2 + both`. Same logistic, same C = 0.5, training rows only for imputation and scaling.

## Experiment
Walk-forward by season as for v2: E0 (test 2022-23), A (2023-24), B (2024-25), each trained on all earlier seasons back to 2018-19; F (2025-26) is confirmation and was seen before. The 2026-27 games so far are reported descriptively.

## Decision rules (fixed now)
- **Returning players** are adopted only if the paired log-loss improvement over `lin_v2`, pooled over E0, A, B on ALL games, has a 95% interval entirely above 0, and on F it is not worse by more than 0.001.
- **Preseason prior** is adopted only if the paired improvement pooled over E0, A, B on EARLY games (either team has played fewer than 15 games that season) has a 95% interval entirely above 0, its log loss over ALL games is not worse than `lin_v2` by more than 0.001 on any development fold, and on F's early games it is not worse by more than 0.001.
- If both pass, `lin_v2 + both` is checked once on F and adopted only if not worse than the better single one by more than 0.001. Otherwise whichever passed is adopted alone, and if neither passes the result is published as a negative finding.

## Not claimed
Neither factor is a sportsbook edge: no historical game lines exist to test against. The returning-player result is an upper bound because it uses who actually played.

---

# Outcome (run once as specified: `research/game_eval_v3.py`, output `research/out/games_v3.json`)

**Neither candidate is adopted; games-v2 is unchanged.**

- **Returning players (`rd_diff`).** Paired log-loss change against `lin_v2`, pooled over E0, A and B on all games: +0.0002, 95% interval [-0.0014, +0.0017] (the rule needs the interval entirely above 0). By season, all games: E0 +0.0029, A -0.0005, B -0.0020, F +0.0010. On early-season games only: E0 +0.0102, A -0.0009, B -0.0063, F +0.0051. It helps in some seasons and hurts in others, so there is no stable effect to adopt. The 2026-27 games so far favour it (+0.0110, interval [+0.0075, +0.0142], 89 games), but that is one small sample against an inconsistent history.
- **Preseason prior (`prior_early`).** Pooled over E0, A and B on early games: -0.0003, interval [-0.0013, +0.0007]. It does nothing, with or without the continuity weighting, and on F's early games it is slightly worse (-0.0013), so it also fails the F condition.

**What this does not close.** Questionable and Doubtful players could not be tested at all: there are no historical injury reports. `injury_log` has been recording since 2026-11-03, and `research/injury_outcomes.py` joins it to who actually played. The returning-players feature is kept as a SHADOW: `game_lean_log` stores its prediction beside the shipped model's before every game (migration 0025), so the live record, which nobody has seen, can settle whether the 2026-27 result was luck. Nothing displayed uses it.
