# Pre-registration: game-winner view (favourite, mismatch and upset signals), written before `research/game_eval.py` was run

Question: can the variables the app already has (team ratings, schedule, style mismatch, availability proxy) predict which team wins better than a plain rating baseline, and is a "lean" worth showing next to the market's favourite? The app has no game-winner model today; the only winner probability is the market's. Nothing here changes any player-prop probability, EV or approval gate.

## What the data can and cannot support
| Wanted | Available? | How it is handled |
|---|---|---|
| Final scores and box scores per team-game, 2022-23 to now | Yes (`research/data/team_*.csv`) | the whole model |
| Historical sportsbook game lines (to test "model vs market") | **No.** ESPN's scoreboard carries odds only for current games (checked: no moneyline on any past date tried); `odds_hist` is empty | the model is validated against plain baselines only. **No claim about beating the market is possible.** From now on each snapshot stores model and market chances side by side (`game_lean_log`) so a forward comparison can be pre-registered later |
| Injury report / lineup history | None | availability is the same past-appearance proxy as for player props (rotation minutes missing from the previous game), labelled a proxy |
| Travel, rest, altitude | Estimates (see `PREREG_HUMAN_FACTORS.md`) | reused from `human_factors.team_features` |
| Style (three-point volume, rebounding, free throws, turnovers) | Team box scores | offence-versus-defence products, prior-only |

## Model and features (all strictly prior-only)
Games are the regular-season team-game pairs; each game is one row, label = home team won. Logistic regression (L2, C = 1) on standardised features; the baseline is the same model on fewer features.
- **BASE**: home advantage (intercept) and `elo_diff`, a margin-aware Elo (K = 20, home advantage of 100 points inside the expectation only, margin multiplier ((|margin| + 3)^0.8)/(7.5 + 0.006 x rating gap of the winner), 75% carry-over between seasons). Constants are the common published defaults and are not tuned. Each game uses ratings from BEFORE it.
- **RATINGS** (adds): home-minus-away of net rating per 100 possessions over the last 10, last 20 and season to date (shrunk by n/(n+8)), offence and defence per 100 possessions over the last 20, and the sum of last-20 paces.
- **SCHEDULE**: rest-day difference, each team's back-to-back flag, the away team's estimated travel miles, time-zone shift and road-trip length, and the home arena's elevation.
- **STYLE**: four mismatch products, each (home offence trait x away defence allowance) minus (away offence trait x home defence allowance), on standardised values: three-point attempt rate, offensive-rebound share, free-throw rate, turnover rate (last 10 games; defences from `defense_features.team_defense`).
- **AVAIL**: rotation minutes missing from each team's previous game (past appearances only).

## Experiment (fixed now)
Chronological walk-forward folds: A (train 2022-23, test 2023-24), B (train 2022-24, test 2024-25), F (train 2022-25, test 2025-26). Regular season only. Each group is added to BASE on its own; `ALL` is shown for information. Reported per variant and fold: paired difference in per-game log loss against BASE with a 95% bootstrap interval resampling calendar weeks, Brier score, log loss, calibration slope and intercept, accuracy, and the share of games where the model and the Elo baseline pick different winners with the model's record in those games. Descriptive slices (never used to decide): by rest difference, by predicted-probability band.

## Decision rule (fixed now)
A group is kept for the displayed "model view" only if its paired log-loss improvement over BASE has an interval entirely above 0 on BOTH development folds, and on the final season F its interval is not entirely below 0. **F is used once, only for groups that passed A and B.** If no group passes, the displayed model view is BASE (home advantage + Elo), described as a plain rating-based view.

## What the app may show
- The model's chance that each team wins, with the market's no-margin chance beside it when a price exists.
- A **lean** only when the model's pick differs from the market favourite AND the gap in the home win chance is at least 7 percentage points (fixed now): shown as "model leans X, market favours Y", never as a bet recommendation. Markets are usually more accurate than a simple model, so a gap is far more likely to be model error (an injury it cannot see) than an inefficiency: the label says to check lineup news.
- The strongest drivers behind the model's number (coefficient x standardised value), in plain words, with unknowns listed.
- Calibration and sample size of the model, from `shared/games.status.json`.

## Not claimed
Accuracy over plain baselines is not an edge over sportsbooks. 2025-26 was seen in earlier experiments, so F is confirmation, not a pristine holdout. No profit claim is made.

---

# Addendum (written before AVAIL2 was run; the first ablation had already found no group passing, and fold F was never used)

**Why.** The first ablation could only see a weak availability proxy (rotation minutes missing from the PREVIOUS game). But the app does have an injury report, and who actually sat out a game is recoverable from box scores for every historical game. So the same quantity, "which rotation players are not playing in this game", can be defined identically for training (from the box score) and for serving (from the report as of the snapshot). This replaces the "no historical injury data" limitation for the game view; it does not need an archive.

**Definition (AVAIL2, strictly prior for everything except who is absent).** For a team-game, the rotation is the players with at least 3 appearances and at least 15 average minutes over the team's previous 10 games. A rotation player is **absent** if he has no minutes in this game (training) or is listed Out in the snapshot's injury report (serving). Features, each from PRIOR statistics of the absent players: `ab_min` (their average minutes, summed), `ab_pts` (their average points when they played, summed), `ab_n` (count), `ab_top` (1 if the rotation's highest-minutes player is absent). Game-level inputs: `ab_min_diff`, `ab_pts_diff` (home minus away), `ab_top_home`, `ab_top_away`, `ab_n_home`, `ab_n_away`. A long-term absentee drops out of the rotation after a few games (his absence is then already inside the team's form), the same on both sides.

**What the test means, and does not mean.** Training and testing use the ACTUAL set of absent players, i.e. what a perfect final injury report would say at tip-off. That is an upper bound for the live view: late scratches, a report that is stale at snapshot time, and Questionable players who play or sit are not captured. The leakage test therefore checks that the absentees' PRIOR statistics never contain the game's own results and that nothing from later dates enters; it cannot, and does not claim to, remove the use of the game's own participation, which is the point of the feature. The live job also stores each snapshot's reported-Out list (`injury_log`) so the report's accuracy against who actually sat can be measured going forward.

**Rule.** Same as above: AVAIL2 is kept if its paired log-loss improvement over BASE is entirely above 0 on BOTH development folds; F (the 2025-26 season, still untouched for this experiment) is used once, only if it passes. If it passes, the displayed model view becomes BASE + AVAIL2 and the interface says it uses the injury report as of the snapshot and can be wrong about late changes. If it does not, the view stays BASE. The ALL row is information only.
