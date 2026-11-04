# Pre-registration: does the game model add anything to the sportsbook price? (live, forward only)

Written 2026-11-04, before any priced game has been scored beyond a count. Nothing below may be changed after results are looked at.

## Question
The site shows a chance that is 30% game model (games-v2) and 70% market. The model has been tested on past games against nothing but its own history, never against sportsbook prices.
Does it carry information the price does not?

## Data
Only what the system stored itself before tip-off: `game_lean_log` (model number and the books' no-margin market chance side by side, written by `research/game_snapshot.py`),
joined to the final result from the box scores. For each game the newest row made on or before the game's date is used.
- The market chance is the power-devigged median across books (`shared/devig.ts`).
- "Closing" here means the last stored price on or before game day. It is **not** a true closing line, and it may be hours before tip. Running `scripts/refresh_slate.ps1` near tip-off makes it closer.
- Games without a stored market price are left out. No game is dropped for any other reason.

## Hypotheses (fixed)
- **H1:** the blend the site shows has lower log loss than the market alone.
- **H2:** the model alone has lower log loss than the market alone (descriptive; the model was never meant to stand alone).

## Rule (fixed)
- Minimum **300 finished games with a stored market price**. Below it the script prints counts only and no verdict (`research/market_games_report.py`).
- At or above it: the paired improvement in log loss (market minus candidate) is averaged, with a 95% interval from resampling whole game days 4,000 times (seed 0).
- H1 (or H2) is **supported** only if its whole interval is above 0. If the whole interval is below 0 the candidate is **worse than the market**. Otherwise: **no difference you could tell from luck.**
- One look at the minimum. Looking earlier than 300 priced games is not allowed to change the plan, the weight 0.3, or the minimum.

## What this cannot show
- Nothing about profit, ROI or closing-line value: those need true closing lines and stake rules and are not tested here.
- Nothing about player props (off).
- With roughly 5 to 10 priced games a day, 300 games is about 5 to 8 weeks.

## If H1 fails
The honest reading is that the model adds nothing over the price. The site would then show the market chance alone and keep the model as a labelled extra, a change to be made in a new pre-registration, not silently.
