# uBet

NBA stats and prop-bet research tool: a props board grouped by game (points, rebounds, assists, threes, PRA) with head-to-head history, per-player game logs and charts,
upcoming games with live scores, league standings, the injury report per game, suggested bets (value / safest / riskiest), parlays, a bet slip, and the "minds": a deterministic, pre-registered, fail-closed bet-approval pipeline (`minds/README.md`). Personal project, informational only.
Sportsbooks are efficient, so treat every suggestion as a lead to check, not a guarantee.

## Stack

- **Frontend:** React, Vite, TypeScript, Tailwind, Recharts
- **API:** Hono on Cloudflare Pages Functions (`functions/api`), D1 (SQLite) for data
- **Data:** box scores via `nba_api` (`ingest/sync.py`, run locally), schedule from ESPN's public
  endpoints, odds from [The Odds API](https://the-odds-api.com)
- **Model:** boosted projections (`research/project.py`) with a negative-binomial tail, blended with the market's fair price; `shared/baseline.ts` is the fallback
- **Audits:** `AUDIT_ENGINE.md` (engine), `AUDIT_SCORECARD.md` (scores and UI), `node research/ui_audit.mjs` (headless-Edge UI checks)

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars        # add your ODDS_API_KEY (free tier is ~500 credits/month)
npm run db:migrate                    # create the local D1 tables

python -m venv ingest/.venv
ingest/.venv/Scripts/python -m pip install nba_api
ingest/.venv/Scripts/python ingest/sync.py "Stephen Curry"      # or --all-active

npm run build && npm run dev:api      # API on :8788
npm run dev                           # app on :5173
npm run dev:sync                      # optional: lets the Sync button run ingest/sync.py
```

`ingest/update.ps1` is the daily refresh used by a Windows scheduled task.

## Notes

- `stats.nba.com` blocks cloud IPs and throttles heavy runs, so box scores are loaded from your own machine.
  `sync.py --start N` resumes an interrupted run; `--remote` writes to production D1.
- Player props only appear for players you have synced. Injuries and lineup news are not modeled.
- Keys live in `.dev.vars` (git-ignored). Never commit them.

## Research and the model

`research/` holds the evidence behind the model. Start with `research/RESULTS.md`; the pass/fail rules were
written first in `research/PREREG.md`.

```bash
ingest/.venv/Scripts/python -m pip install pandas numpy scipy scikit-learn tzdata
ingest/.venv/Scripts/python research/pull_raw.py             # league-wide game logs (one request per season)
ingest/.venv/Scripts/python research/features.py             # point-in-time features
ingest/.venv/Scripts/python research/tests/test_leakage.py   # proves no feature peeks at the future
ingest/.venv/Scripts/python research/evaluate.py             # walk-forward development folds
ingest/.venv/Scripts/python research/project.py              # boosted projections for upcoming games -> D1
```

- Picks use the boosted model's projection with a negative-binomial tail when `projections` has a row, and
  fall back to the weighted-average model otherwise (`model` on each pick says which).
- **No sportsbook edge has been shown.** Historical lines are needed for that: `research/backfill_odds.py`
  (paid Odds API plan; `--dry-run` prices a run) then `research/market_eval.py`. Raw live odds are also stored
  in `odds_raw`, and `/api/capture` snapshots games about to start.
- `research/tests/` also verifies the Python port of the app model and the negative-binomial maths against
  the TypeScript in `shared/baseline.ts`.

### Free forward data: Kalshi

`research/collect_kalshi.py` snapshots Kalshi's public NBA prices (player props, game winners, spreads, totals)
into `research/data/kalshi.sqlite`, with no API key and no cost. A Windows task ("uBet Kalshi collector", running
`ingest/.venv/Scripts/pythonw.exe research/collect_kalshi.py`, which has no console window) runs it every
10 minutes while the PC is on; output goes to `research/data/kalshi.log`. `kalshi_eval.py --peek` shows how
much usable data exists; it refuses to show scores until the minimum fixed in `research/PREREG_KALSHI.md`
(1,500 liquid props across 30 game dates) is reached.

## Configuration and tests

Environment variables (set in `.dev.vars` locally, as Pages secrets when deployed):

| Name | Purpose |
|---|---|
| `ODDS_API_KEY` | The Odds API key |
| `CAPTURE_TOKEN` | If set, routes that spend credits or write (`/api/capture`, `?fresh=1`, `POST /api/predictions`) need this in the `x-capture-token` header. If unset they only work from localhost. **Set it before deploying.** |
| `FALLBACK_MODEL` | `v3` switches the fallback model to the negative-binomial baseline (default `v2`; see `AUDIT.md` finding 14) |
| `ODDS_REGIONS`, `ODDS_MARKETS`, `ODDS_HOURS`, `ODDS_BOOKS` | what to fetch (each region/market costs credits) |
| `ODDS_MAX_EVENTS` | games whose props are pulled per refresh (default 3; one credit per market per game) |

`CAPTURE_TOKEN` also protects personal data (`GET/POST/DELETE /api/my-bets`). On a deployed copy, enter it once under Results > My bets; it is kept in that browser only.

```bash
npm run check               # typecheck, lint, unit and db tests
npm run test:integration    # real Worker against a fake provider and a scratch copy of your local database
npm run test:mutation       # plants known bugs and checks the tests catch them
npm run check:data          # database integrity checks
npm run check:config        # deployment configuration without printing any secret (add -- --production for a deployed copy)
npm run test:research       # Python research tests, incl. the leakage test on a generated fixture and a seeded leak that must be caught
npm run grade               # grade logged picks against stored box scores (also runs after every sync)
```

**CI** (`.github/workflows/ci.yml`) runs types, lint, unit tests, in-memory database tests and the build, plus the Python research suite and the ingest tests. It uses no secrets, no live API and no paid data.
`test:integration` is not in CI because it needs a local database holding real synced box scores; run it before merging.

**Odds archive.** Every odds snapshot the website or the Minds runner retrieves is stored point-in-time (`odds_runs`, `odds_quotes`, migration 0018): price, line, book, when we saw it, whether it was fresh. `node minds/capture_odds.mjs` adds
pre-event snapshots (credit-capped). The last observation before a documented cutoff is a *closing proxy*, never a true closing line. `GET /api/odds-archive` shows coverage; `research/archive_to_snapshots.py` feeds it to the pre-registered market evaluation.
No market-beating result exists: see `research/MARKET_EVAL_STATUS.md`.

**One calculation.** The probability and expected value on every screen come from `shared/engine/authority.ts`, the same records Minds decides on. A pick the engine cannot price shows the older simple blend marked as unvalidated (a tilde and "unvalidated").
**Schedule & fatigue.** A prop's details show rest, congestion, estimated travel and workload as facts (`shared/schedule.ts`, `GET /api/schedule-context`), with what is unknown listed. They change no prediction: the pre-registered ablation found no group worth using (`research/RESULTS_HUMAN_FACTORS.md`, how-to in `research/HUMAN_FACTORS.md`).

`GET /api/health` reports configuration and data freshness without secrets.

`AUDIT.md` lists what was found, what was fixed, what is unproven and what is blocked on data.
