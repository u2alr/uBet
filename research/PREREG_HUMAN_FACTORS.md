# Pre-registration: Human Factors Engine (schedule, travel, workload, role), written before `research/human_factors_eval.py` was run

This extends and replaces the narrower `PREREG_CONTEXT.md` experiment (which found no group worth keeping). Nothing below alters production unless a group passes the rule at the end, and even then only after calibration and explicit approval.

## What the data can and cannot support (inspected, not assumed)
| Wanted | Available? | How it is handled |
|---|---|---|
| Rest days, back-to-back, 3-in-4, 4-in-6, games in 7 and 14 days | Yes: dates of every box-scored game | computed, prior-only |
| **Hours** since the previous game | **No for history**: box scores carry only dates, no tip-off times | not used in training. For an upcoming game the UI shows only an interval implied by the previous game's DATE (lower and upper bound in hours), labelled an estimate |
| Home-to-home vs road-to-road back-to-backs | Yes (MATCHUP says home/away) | encoded as a back-to-back TYPE |
| Distance, time-zone change, road trip length, same-city | Estimated from a static table of arena locations (`shared/arenas.json`) | labelled estimates; unknown team code or a gap over 10 days gives unknown, never a guess |
| Altitude | Static elevation table | tested as its own group |
| Neutral-site games (NBA Cup final) | **No**: the feed marks a designated home team, not a neutral site | treated as unknown; at most four games in the sample |
| Postponed games | Never appear in box scores | they cannot be mistaken for a played game; a "previous game" is always a game that was actually played |
| Duplicate schedule records | None found (0 duplicate team-games in 10,554 rows) | de-duplicated by (game id, team) anyway and tested |
| Cumulative minutes, overtime, prior-game minutes, workload vs own baseline, short-rest production, return from absence | Yes (player minutes, team minutes over 240) | computed per player against his own baseline |
| Starting lineup changes, confirmed injury reports | **No historical data** | not built (see `INJURY_FEATURES.md`) |
| Psychology, motivation, tilt, chemistry, pressure | No evidence source | never inferred, never used |

## Features (all strictly prior-only; names `hf_*`)
Team and schedule: `rest_days`, `b2b`, `b2b_type` (0 none, 1 home-home, 2 road-road, 3 road-home, 4 home-road), `three_in_four`, `four_in_six`, `g7`, `g14`, `ot_prev` (previous game went to overtime), `ot_recent5`;
opponent and difference: `opp_rest_days`, `rest_diff` (own minus opponent), `opp_b2b`, `opp_miles`, `opp_road_trip`, `opp_at_home` (the opponent is at home), `opp_g7`;
travel (estimates): `miles`, `tz_shift` (eastward positive), `east_shift` (1 if travelling east), `road_trip`, `same_city`, `miles_x_short`, `tz_x_short` (interactions with rest of at most 1 day);
altitude: `elev` (game city), `elev_up` (the game is higher than the team's previous location).
Player workload: `cum3`, `cum5`, `cum7`, `cum14` (minutes in the previous N days), `min_prev`, `min_prev_z` (previous game's minutes minus his expanding season-to-date mean, in his own standard deviations), `heavy_prev` (previous game at least 6 minutes above that mean), `heavy_l10` (count of such games in his last 10), `workload_ratio` (last-5 average over season-to-date average), `cum7_ratio` (minutes in 7 days over his own baseline times games played), `short_rest_<stat>` (per-minute production on rest of at most 1 day minus other days over his last 40 games, shrunk by n/(n+5), 0 with fewer than 3 of either), `ret_n` (1 for the first game back after missing 4 or more team games, up to 5; 0 otherwise).
`ret_n` carries uncertainty by construction: the reason for the absence is unknown.

Groups: **REST** (team and schedule, opponent and difference), **TRAVEL** (travel estimates), **ELEVATION**, **WORKLOAD** (player workload and return). Existing features already represent rest days, back-to-back, minutes trends, absent rotation minutes, team offence, defence and pace, home and the playoffs flag, so these are measured as INCREMENTAL.

## Experiment (fixed now)
Variants per statistic (points, rebounds, assists, threes; PRA is reported from the sum of its parts' errors where meaningful, and separately fitted where noted): **A** baseline (the production feature set); **B** + REST; **C** + TRAVEL; **D** + WORKLOAD; **E** + every group that passes the rule on the development folds (empty if none; an "all groups, unvalidated" row is shown for information only and can never be adopted).
Chronological walk-forward folds exactly as before: A (train 2022-23, test 2023-24), B (train 2022-24, test 2024-25), F (train 2022-25, test 2025-26). Same rows for every variant. Rotation players (last-10 minutes at least 20). Dispersion fitted once from the baseline on the last 20% of the training period. Whole seasons are never split between train and test, so no game date appears on both sides.
Reported: paired difference in negative-binomial log score with a 95% bootstrap interval resampling calendar weeks; Brier score, log loss and calibration slope/intercept on pseudo-lines; MAE; and the paired difference separately by prop category, by season (fold), by role (last-10 minutes: 20 to 28, 28 to 34, 34 and over), by rest difference (at most -2, -1, 0, +1, at least +2), by travel bucket (none or same city, under 500, 500 to 1,500, over 1,500 estimated miles), and back-to-back versus normal rest, each with its sample size. Partial associations: the Spearman correlation between the baseline's standardised residual and each new feature (does it explain what the baseline misses), and the largest correlation between each new feature and any existing feature (overlap).
"Controlling for team strength, opponent, home/away, injuries and existing workload" is satisfied by measuring everything against the baseline that already contains them (team offence/defence/pace, home, absent-rotation proxies, minutes features); a feature that only repeats them will show no incremental gain.

## Decision rule (fixed now)
A group is **kept as an experimental research feature** only if on BOTH development folds at least 3 of 4 statistics have an interval entirely above 0 and none entirely below, AND on the final season F none is entirely below 0. **F is used once, only for groups that already passed on A and B.** Anything else is dropped from consideration. No subgroup (a bucket, a role, a stat) can rescue a failed group; the bucket tables are descriptive.
Even a kept group stays research-only until it is calibrated, pre-registered for production, and approved: it may not alter the authoritative probability or any approval gate by default.

## Not claimed
Better accuracy against naive baselines is not an edge over sportsbooks: no price is involved. Travel is estimated from city locations, not flights. 2025-26 was seen by earlier experiments, so F is confirmation, not a pristine holdout.
