# Human Factors Engine: data, assumptions, limitations, commands

Two separate things, kept apart on purpose.

1. **Facts shown to the reader** (`shared/schedule.ts`, `GET /api/schedule-context`, the "Schedule & fatigue" section in a prop's details): rest days, back-to-back and its type,
   three games in four nights, four in six, games in the last 7 and 14 days, estimated travel (miles, time-zone change and direction, same city, road-trip length), altitude,
   a range for hours since the previous game, and a player's recent minutes against his own baseline. Facts only. No probability is attached to them.
2. **Research features** (`research/human_factors.py`) tested for whether they improve predictions out of sample (`PREREG_HUMAN_FACTORS.md` -> `RESULTS_HUMAN_FACTORS.md`).
   **None passed**, so none changes any prediction (`shared/humanFactors.status.json`: `adjustsPredictions: false`, enforced by `shared/researchIsolation.test.ts`).

## Data sources
| Input | Source | Time of availability |
|---|---|---|
| Played games, dates, home/away | box scores (`ingest/sync.py` into D1; `research/pull_raw.py` CSVs for research) | after each game |
| Player and team minutes (workload, overtime where full box scores exist) | the same box scores | after each game |
| Arena location, time zone, elevation | `shared/arenas.json`, a static table (public geography, city-level accuracy) | always |
| Tip-off time of the UPCOMING game | ESPN scoreboard (`/api/games`) | before the game |

## Assumptions and limitations (stated, not hidden)
- **Hours since the previous game cannot be reconstructed historically**: box scores carry dates, not tip-off times. The UI shows a RANGE for the upcoming game, assuming the previous game ended between 21:00 ET that night and 01:30 ET the next morning, and says so. The training features use days.
- **Travel is an estimate** from city centres. Flights, departure and arrival times, hotels, sleep and recovery are unknown. Beyond ten days since the previous game, travel is unknown.
- **Overtime** is only known where full team box scores exist; the database holds partial rosters, so the app shows it as unknown (research data from the league logs has it).
- **Neutral-site games** (the NBA Cup final) cannot be identified: the feed marks a designated home team. At most a handful of games.
- **Starting-lineup changes and historical injury reports do not exist** in the data, so they are not features. The injury status in the UI is ESPN's current snapshot.
- **A returning player** is flagged `possible` after a gap of 8 or more days within a season. The reason (injury, rest, suspension) is not known and is never stated.
- Postponed games never appear in box scores, so they cannot be mistaken for the previous game; duplicate schedule records collapse by game id. Both are tested.
- No psychological state (motivation, confidence, tilt, chemistry, pressure) is inferred from anything.

## Reproduce the evaluation
```
python research/features.py                              # builds research/out/features.pkl (needs research/data from research/pull_raw.py)
python research/human_factors_eval.py                    # development folds A and B (pre-registered rules)
python research/human_factors_report.py                  # writes research/RESULTS_HUMAN_FACTORS.md and shared/humanFactors.status.json
python research/human_factors_eval.py --final            # fold F, ONCE, and only for groups that passed A and B (refuses otherwise)
python research/tests/run_all.py                         # all Python tests, including the leakage tests, on a generated fixture
npm test                                                 # includes shared/schedule.test.ts
```
Feature definitions are versioned by `humanFactors.status.json` (`hf-v1`) and `PREREG_HUMAN_FACTORS.md`; change a definition and you must start a new pre-registration.

## If a group is ever adopted
It needs: a passing pre-registered rule including fold F; calibration re-run (`research/calibrate.py`); a decision to change production; and removal of any other adjustment that measures the same thing (rest and back-to-back already enter the model through `own_rest` / `own_b2b`; the injury override is off). The authoritative probability and EV path (`shared/engine/authority.ts`) stays the only one.
