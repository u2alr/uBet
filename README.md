# uBet

NBA stats and prop-bet research tool: per-player game logs and charts, upcoming games with team odds,
suggested bets (value / safest / riskiest), parlays and a bet slip. Personal project, informational only.
Sportsbooks are efficient, so treat every suggestion as a lead to check, not a guarantee.

## Stack

- **Frontend:** React, Vite, TypeScript, Tailwind, Recharts
- **API:** Hono on Cloudflare Pages Functions (`functions/api`), D1 (SQLite) for data
- **Data:** box scores via `nba_api` (`ingest/sync.py`, run locally), schedule from ESPN's public
  endpoints, odds from [The Odds API](https://the-odds-api.com)
- **Model:** `shared/baseline.ts`: recency- and game-type-weighted projection, blended with the market price

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
