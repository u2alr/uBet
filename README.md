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
