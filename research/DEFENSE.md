# Defensive Matchup Engine: data, method, limits

Pre-registration: `PREREG_DEFENSE.md` (written before any model was fitted). Results: `RESULTS_DEFENSE.md` (generated). Status read by the app: `shared/defense.status.json`.

## What data exists, and what does not
| Source | What it gives | Used? |
|---|---|---|
| NBA.com `BoxScoreMatchupsV3` (one call per game, via `nba_api`) | per game: each offensive player's matchups with each defender, partial possessions, shots faced (FGA/3PA), points allowed, assists, turnovers, shooting fouls, help shots | **Yes**, the basis of the individual-defender and likely-matchup features (`pull_matchups.py` -> `data/matchups.sqlite`) |
| Team box scores (already in `data/team_*.csv`) | points, shots, threes, free throws, rebounds, assists, turnovers for both sides | **Yes**, team defence (`df_td_*`) |
| NBA.com season-level defence tables (`LeagueDashPtDefend`, Synergy play types, shot-zone defence, `LeagueSeasonMatchups`) | defended FG% by zone, rim protection, pick-and-roll / isolation / post defence | **No.** They are published as totals as of the day they are fetched, with no history, so using them for past games would include the games being predicted. A daily snapshot job could accumulate them going forward; until it exists they cannot be validated |
| `switchesOn` field of the matchup feed | switches | **No**: it is zero in every row inspected (96,004 rows) |
| Positions | the OFFENSIVE player's position is listed only for starters (about half the rows); defenders have no position | role class G / F / C / U; defenders are described by what they actually guarded |
| Lineups, injury report history | none | the opposing rotation is "players in the team's last 10 games"; a late absence cannot be known historically |
| Zone defence, double teams | none | not modelled; help defence appears only as the spread of the estimated assignment |

`matchupMinutes` does not sum to real minutes (a starter's total is about half his box-score minutes) and `partialPossessions` is NBA.com's own exposure measure, so both are used only as relative weights and sample sizes.

## How the features are built (all prior-only)
- **Point in time.** Cumulative state is stored per date including that date and always read with `merge_asof(allow_exact_matches=False)`. A game never sees itself or anything played the same day. League averages used for shrinkage are themselves computed from earlier dates only. `tests/test_defense.py` proves it: deleting the future, and corrupting a day's results (box scores, team totals and matchup rows), leaves every feature for that day and earlier unchanged, while a control corruption does move later rows.
- **Team defence (TD).** Seven rates, last 10 games and season to date, shrunk toward the prior league mean. Points allowed per possession is adjusted for the offences faced (minus each offence's own prior rate), so a team that faced strong offences is not penalised.
- **Individual defenders (PD).** "Points over expected per 100 matchup possessions": points scored by the players he guarded minus what those players normally score per possession (their own prior rate, shrunk), so a defender is not blamed for guarding stars. Shrunk with weight 1,500 possessions, so a defender with little exposure sits at the league mean. Fouls, threes faced, versatility (entropy of positions guarded) and per-minute blocks and steals are secondary.
- **Likely matchup (MU).** Weights over the opposing rotation = `lambda` x (the player's own past share against each defender) + (1 - `lambda`) x (how the team's rotation has guarded players of his role), with `lambda = n_direct / (n_direct + 150)`. With no direct history the role term carries it; with neither, it falls back to the rotation's minutes and the confidence says so. Output: weighted quality, concentration, direct share, and a confidence from the sample behind the defenders.
- **Interactions (IX).** Offensive skill times defensive weakness, one per mechanism (threes x three-point attempts allowed, rebounds x offensive-rebound share allowed, assists x assists allowed, points x free-throw rate allowed, points x matchup quality). No generic "weak defence" bonus.

## Result (RESULTS_DEFENSE.md, generated)
Per the rule fixed in advance: **team defence (TD) passed** on both development seasons (3 of 4 statistics clearly better, none worse) and held on the final season; **individual defenders (PD) and likely matchup (MU) did not pass**. The gains are small (a few thousandths of a log score per row). TD stays research-only: it is not calibrated for production or approved, so it changes no prediction. Where the evidence is thin, the matchup context in the app is descriptive.

## What reaches the app
The evaluation decides whether any feature may change a probability (`shared/defense.status.json`, `adjustsPredictions`). Whatever the result, the prop card can show **facts** with their samples: the estimated defenders and a contextual rating, the team's notable traits for that statistic, a confidence, and the source/freshness. `research/defense_snapshot.py` computes those facts for the next two days' games with the same point-in-time code (placeholder rows for games not yet played) and writes them to D1 (`migrations/0019_defense_context.sql`); `GET /api/defense-context?player=ID&opp=ABBR` serves them. A defender is rated only with enough sample, and the wording is "below-average in the available matchup sample", never "bad defender".

## Reproduce
```
ingest/.venv/Scripts/python research/pull_matchups.py            # resumable; several --part k --parts N pullers can run side by side
ingest/.venv/Scripts/python research/defense_eval.py             # development folds A and B -> research/out/def_dev.json
ingest/.venv/Scripts/python research/defense_report.py           # RESULTS_DEFENSE.md + shared/defense.status.json
ingest/.venv/Scripts/python research/defense_eval.py --final     # fold F, ONCE, only for groups that passed A and B
ingest/.venv/Scripts/python research/defense_snapshot.py         # live context for the next games -> D1 (add --remote for the deployed database)
ingest/.venv/Scripts/python research/tests/test_defense.py       # definitions, shrinkage, edge cases, leakage
```
