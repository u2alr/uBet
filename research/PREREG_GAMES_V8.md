# Pre-registration: game-winner model v8 (what the league's own pre-game injury reports add), written before any v8 feature was built or fitted

## Why this test exists
Every earlier availability test (v3, v4, v6, v7) used who actually PLAYED, which nobody knows before tip-off. It is an upper bound, and it cannot say whether Questionable, Doubtful or Probable listings carry information, because the reports were not kept. The league's official reports exist back to December 2020 (`research/backfill_injuries.py` stores them in `research/data/injuries/injury_reports.csv`). This test uses only what the report said before the game.

## Data (fixed now)
For every regular-season game, the report used is the latest stored one of that game's day whose own printed time is at least 60 minutes before the game's tip (tip as printed on the report; a game where neither team prints anything has no printed tip, and 7:00 PM Eastern is assumed) AND in which neither team is marked "NOT YET SUBMITTED". The report prints a team only when it has a listed player or has not filed, so a team that filed with nobody listed is simply absent from a covered game and has no listed players. (Amended 2026-11-05, after the first download and before any feature was fitted or any result seen: the first wording required "at least one listed player each", which would have treated a healthy team as missing.) If no stored report qualifies the game has no report: its report features are 0 and `has_rep` = 0 in every model. Four reports per day are stored (about 11 AM, 2 PM, 5 PM, 7 PM Eastern), so "latest" means among those. Players are matched to our player ids by name (letters only, accents and suffixes removed); an unmatched name contributes nothing and is counted.

## Player weight and availability (fixed now)
For player i before date D: `w_i` = (mean minutes over his previous 10 appearances before D, capped at 36) x (mean Game Score over his previous 20 appearances before D) / 240, the same talent as v6's PLAYERRATING; needs at least 3 earlier appearances, else he contributes 0. Probability of playing given the listed status, FIXED here, not fitted: Out 0.00, Doubtful 0.15, Questionable 0.50, Probable 0.90, Available 1.00.

## Features (home minus away)
- `rep_out` = sum of `w_i` over players listed Out.
- `rep_exp_loss` = sum of `w_i` x (1 - p_i) over every listed player.
- `rep_top` = the largest `w_i` among players listed Out or Doubtful.
- `has_rep` = 1 if the game has a report, else 0 (not a difference: a flag).

## Models (fixed now)
- **R** (reference, unattainable before tip): `lin_v2` exactly as shipped, with absence features from who actually played.
- **B0** (what the live system can know): `lin_v2` with the actual-absence columns (the AVAIL3 group and `ab_gs`) REMOVED and `rep_out` and `has_rep` added. Listed Out only.
- **C1** = B0 + `rep_exp_loss` (status-aware expected loss).
- **C2** = B0 + `rep_top` (the single biggest name missing).
All logistic, C = 0.5. To be fair every model is trained only on games from the 2020-21 season on (the reports' range), including R.

## Experiment
Walk-forward as for v2 to v7: E0 (test 2022-23), A (2023-24), B (2024-25), each trained on all earlier seasons from 2020-21; F (2025-26) confirmation, seen before; 2026-27 so far descriptive. Week-clustered bootstrap, seed 0.

## Decision rule (fixed now; two candidates are compared with B0)
A candidate is adopted only if its paired log-loss improvement over B0, pooled over E0, A and B, has a **97.5% interval** (95% divided by two comparisons) entirely above 0, AND on F it is not worse than B0 by more than 0.001, AND its improvement has the same sign on at least two of the three development seasons.

Reported for information only, and unable to adopt anything: R against B0 (how much the model loses by knowing only the listings, not who played), and for each status the share of listed players who then played (matched through the box scores), by season.

## Not claimed
No sportsbook edge: no historical game lines exist. Four reports a day is coarser than the league's 15-minute updates, so a late scratch after the last stored report is not seen.

---

# Outcome (run once as specified: `research/game_eval_v8.py`, output `research/out/games_v8.json`; the backfill covers 971 game days from 2020-12-22 to 2026-11-04, about 398,000 report rows)

**Neither candidate is adopted; games-v2 is unchanged.** Pooled over E0, A and B, paired change in log loss against B0 (listed Out only, what the live system can know) with the 97.5% interval the rule requires (positive is better):

| Candidate | Pooled change | 97.5% interval | Better in how many of E0, A, B | F not worse by more than 0.001 | Adopted |
|---|---|---|---|---|---|
| C1: status-aware expected loss (Out 0, Doubtful 0.15, Questionable 0.5, Probable 0.9) | +0.0005 | [-0.0005, +0.0014] | 3 of 3 | yes (+0.0008) | no (interval includes 0) |
| C2: the single biggest name listed Out or Doubtful | -0.0002 | [-0.0011, +0.0008] | 1 of 3 | yes (-0.0001) | no |

Per season (E0, A, B, F, 2026-27 so far): C1 +0.0005, +0.0004, +0.0005, +0.0008, -0.0022; C2 -0.0003, -0.0008, +0.0006, -0.0001, +0.0011. C1 was positive in every development season and in F: the steadiest sign of any group tested since v2, and too small to clear the interval, the same shape as star concentration in v6. Its 2026-27 number (121 games) is not read as evidence.

**Reference (information only).** R, which knows who actually played, beat B0 by +0.0001, +0.0049, +0.0060 and +0.0029 in E0, A, B and F (no interval excluded 0). So knowing only the league's pre-game listings costs about 0.003 to 0.006 log loss against hindsight, and C1 recovers roughly a tenth of that.

**What the reports are worth, from the play rates (information only).** Of players the report used listed each status, the share who then played: **Out 0.00** in every season (about 38,000 listings), **Doubtful 0.01 to 0.06**, **Questionable 0.47 to 0.53**, **Probable 0.84 to 0.95**, "Available" 0.71 to 0.87. So the NBA's "Out" is as reliable as hindsight, which is why treating only listed Out as absent loses so little; "Questionable" really is close to a coin flip, and "Doubtful" is closer to Out than to the 0.15 fixed here.

**Limits of this run.** Only 63% to 74% of games had a usable report under the rule (four stored reports a day; a team still "not yet submitted" in the latest qualifying one blocks it), so the report features are 0 and `has_rep` = 0 for about 30% of games in every model. That dilutes any effect and is the main reason a larger sample of finer-grained reports (every 15 minutes, as the league posts them) is worth a new pre-registration rather than a re-run of this one: the window, weights and statuses here are final and were not tuned after the result.

**What happens next.** Nothing changes in the model or the pages. The pages already show every status the NBA lists; the model keeps counting only Out.
