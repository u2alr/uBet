# uBet V2: evidence-first upgrade (status record)

What changed, what was measured, what is still experimental, and what is blocked. Numbers come from commands run in this repository; nothing here claims the model is more accurate or profitable.

## Schema changes (apply to every database before deploying)
- `0017_prediction_basis.sql`: `predictions.basis` (defaults to `legacy` for every existing row, which are left untouched) and `predictions.ev`.
- `0018_odds_archive.sql`: `odds_runs`, `odds_quotes` (point-in-time odds archive).
- Earlier in this body of work and still pending for production: `0015_engine_v7`, `0016_my_bets`.
- Not a schema change, but note: the market key (`legKey`, `pickKey`) now includes the game's event id, so the same line in two different games is never merged. Old stored keys are not rewritten.

## Phase 1: correctness
1. **Props payload.** `/api/picks` now builds with `selection: 'all'` and returns every side of every posted line (it used to keep at most 80 picks, by value). `shared/boardPayload.ts` limits a response by whole games only, reports `meta.coverage` (returned, omitted games), and supports `?event=<id>`. Each pick says whether its other side is `posted` or `not_posted`. Engine-only arrays are no longer sent.
2. **One probability and EV path.** `shared/engine/authority.ts` attaches the canonical engine record to every pick and makes `prob`, `ev`, `modelProb`, `marketProb` the authoritative numbers (same records Minds decides on; expected value through `payoff.ts`). Quote freshness is judged at the odds' retrieval time. Where the engine cannot compute (fallback model, no calibration, no corroborated price) the pick keeps the older blend, labelled `basis: 'legacy'`, shown with a tilde and "unvalidated", never ranked with authoritative numbers.
3. **Risk labels.** The probability-only Safe / Even / Risky label is gone (`riskTier` deleted). An evidence badge says Strict rules met / Research only / Not enough evidence / Unvalidated blend, with reasons. Tabs are "Most likely" and "Longshots", with copy that says a likely outcome is not good value. Positive EV with insufficient evidence is not coloured as a green light.
4. **Injury train/serve mismatch.** Measured and documented in `research/INJURY_FEATURES.md`. The override cannot be backtested (no historical injury reports exist), so it is OFF by default (`--injury-features` to opt in). Players listed Out are still dropped from the projection set; no feature changes.

## Phase 2: reproducible validation and market data
5. **CI** (`.github/workflows/ci.yml`): types, lint, unit tests, in-memory DB tests, build; Python research tests including the leakage test on a generated fixture league and a seeded-leak detector (two planted leaks are caught); ingest tests. No secrets, no live API. Integration tests are excluded (they need a local database with real synced data).
6. **Point-in-time odds archive**: schema, planner (`shared/oddsArchive.ts`), website and Minds-runner capture, `minds/capture_odds.mjs` (credit-capped, stops on 429), `GET /api/odds-archive`. Opening is "first observed", closing is a "closing proxy" with a stated gap; `isTrueClosingLine` is always false.
7. **Market evaluation**: cannot be completed. `research/data/odds_hist/2025-26` is empty (paid data, not purchased); `PREREG_KALSHI` needs 30 game dates and has 4. Criteria untouched. `research/archive_to_snapshots.py` converts the archive to the format `market_eval.py` reads. See `research/MARKET_EVAL_STATUS.md`.

## Phase 3: research-only context features
Pre-registered (`research/PREREG_CONTEXT.md`), built (`research/context_features.py`, point-in-time, leakage-tested), evaluated on the development folds (`research/RESULTS_CONTEXT.md`). **No group met the rule, none is kept, and the final season was not used.** Nothing is wired into production (`shared/researchIsolation.test.ts` enforces it).

## Phase 4: maintainability and security
- One team-code mapping (`shared/teamCodes.json`) read by TypeScript and Python.
- `/api/my-bets` reads now need the access token as well as writes; the Results screen asks for it on a deployed copy.
- `/api/cheatsheet` is cached for 10 minutes.
- `GET /api/health` and `npm run check:config` validate configuration without printing a secret. `check:config --production` currently FAILS, correctly: `wrangler.toml` still holds the placeholder `database_id`, and no `CAPTURE_TOKEN` is set locally.
- The old `/capture` integration test failed at some hours: its fake provider put games inside the 12-hour cap. Fixed (the test was wrong, not the Worker).

## Test results at the end of this work
Unit 246 pass; DB 16 pass; ingest 5 pass; integration 67 pass, 0 fail; Python research suite 12 of 12 files pass; real-data leakage test PASS (68 features, no leak, control fires); typecheck clean; lint: one old warning in `payoff.test.ts`; build passes.
Not run: the context-feature leakage test on real data (fixture only), anything against live odds (credits), the production deployment.

## Experimental / unvalidated
- Calibration for points, assists and PRA failed its gates; those stats cannot be strict bets.
- Blend weights (0.7 market) are placeholders until historical lines exist.
- The injury override (opt-in only), the teammate-out lift (rejected), the context features (dropped).
- Parlay independence.

## Evidence of market-beating performance
**None exists.** No test against sportsbook prices has been run, and none can be until the archive or purchased data accumulates.

## Next steps
1. Schedule `node minds/capture_odds.mjs` before tip-off on game days (about 10 credits per run) and let the archive grow.
2. When about 3,000 props are matched, run `research/archive_to_snapshots.py` then `research/market_eval.py` exactly as pre-registered.
3. Set a real D1 `database_id` and `CAPTURE_TOKEN` before deploying; run `npm run check:config -- --production`.
4. Apply migrations 0015 to 0018 to production.
