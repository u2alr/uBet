# The minds, version 7 (the deterministic Chief)

Rules: `research/PREREG_MINDS_V7.md`. Decision logic: `shared/minds.ts` (pure, tested) on top of the engine in `shared/engine/`
(payoffs, consensus pricing, calibration lookup, eligibility, reason codes). The audit of what this replaced is `AUDIT_ENGINE.md`;
the latest scorecard is `AUDIT_SCORECARD.md`.

## The daily chain (order matters)
1. `ingest/.venv/Scripts/python ingest/sync.py --all-active` (or the Sync button): new box scores, grading of yesterday's bets
   and of rejected candidates.
2. `ingest/.venv/Scripts/python research/project.py`: fresh projections, including PRA. **Projections older than 24 hours are
   refused**, so skipping this step produces zero strict bets by design (`NO_FRESH_PROJECTION` / `STALE_PROJECTION` in the counts).
3. `node minds/run.mjs`: fetches odds, asks ESPN for injuries, decides, and records the decision. It decides once per Eastern day;
   a no-bets day is recorded and cannot be re-rolled.

## Odds sources
`ODDS_API_KEY` set in `.dev.vars` selects The Odds API (FanDuel, DraftKings and bet365 only, one request per game; props for the
points, rebounds, assists, threes and PRA markets). Otherwise OddsBlaze is used. `--provider oddsapi|oddsblaze` forces one.
Free-tier credits are small: a run of about 12 games spends roughly 12 requests per market set.

## Developer aids
- `node minds/run.mjs --dry --cache`: reuse the last download for up to 3 hours and write nothing.
- `DUMP_PICKS=minds/out/picks_fixture.json node minds/run.mjs --dry --cache`: save the built props payload. `node research/ui_audit.mjs`
  then serves it for `/api/picks`, so the UI can be audited while the odds provider is unavailable (needs `npm run dev`).

## What is stored
Migration `0015_engine_v7.sql`: `mind_runs` (config and calibration hashes), `mind_candidates` (every candidate with its full record
and outcome), `mind_run_inputs` (the exact input picks, gzip+base64). `shared/snapshot.ts` replays a stored run and a test proves it
reproduces the decision. `GET /api/minds/report` returns ROI, yield, Brier, log loss and calibration bins with intervals.

## Tiers
STRICT (staked, 1 unit) | SHADOW_ONLY leans (hypothetical half stake, never a recommendation) | RESEARCH_ONLY (parlays, thin history,
unvalidated calibration) | PAPER_VOLUME (graded for evidence, never bet). Strict approval requires a validated calibration for the statistic;
PRA currently has none, so it can only appear as research-only here.

Apply migrations through 0015 to production before deploying; nothing in this repo writes to production on its own.
