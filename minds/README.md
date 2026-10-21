# The minds, version 4

Rules and the evidence behind them: `research/PREREG_MINDS_V4.md`. The decision logic is `shared/minds.ts` (pure, tested).

## The daily chain (order matters)
1. `ingest/sync.py --all-active` (or the Sync button): new box scores, injuries-free minutes history, grading of yesterday's bets
   and of rejected candidates.
2. `ingest/.venv/Scripts/python research/project.py`: fresh projections. **The Chief refuses projections older than 24 hours**,
   so skipping this step produces zero bets by design ("no_fresh_projection" / "stale_projection" in the rejection counts).
3. `node minds/run.mjs`: fetches odds (3 OddsBlaze requests), asks ESPN for injuries, decides, and records the decision.
   It decides once per Eastern day; a "no bets" day is recorded and cannot be re-rolled.

`node minds/run.mjs --dry --cache` reuses the last download for up to 3 hours and writes nothing, for inspecting a decision
without spending requests.

Apply migrations 0010 to 0013 to production before deploying, and run `node minds/backfill_games.mjs --remote` only if old
legs need their game times.
