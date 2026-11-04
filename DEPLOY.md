# Deploying uBet to Cloudflare Pages

The site and API deploy to Pages. Box scores, projections and the game model are produced on your computer (NBA.com blocks cloud servers), so a deployed
copy only stays current while you push fresh data to it from here.

## Before the first deploy

1. Create the database and put its id in `wrangler.toml` (replacing `REPLACE_AFTER_wrangler_d1_create`):
   ```bash
   npx wrangler d1 create ubet
   ```
2. Apply every migration to the remote database:
   ```bash
   npx wrangler d1 migrations apply ubet --remote
   ```
3. Set the secrets in the Pages project (Settings > Variables and Secrets), as secrets, never in the repository:
   - `SHARPAPI_KEY`: your key from sharpapi.io.
   - `CAPTURE_TOKEN`: a long random string. Without it, writes and provider-using refreshes only work from localhost, so nothing could ever update the deployed copy.
   - Optional: `ODDS_MAX_EVENTS` (default 3, at most 15), `ODDS_HOURS`, `ODDS_BOOKS`.
4. Check the configuration. With `--production` a placeholder database id or a missing `CAPTURE_TOKEN` fails instead of warning:
   ```bash
   npm run check:config -- --production
   ```
5. Put Cloudflare Access (Zero Trust, free for a few users) in front of the site if it is only for you. The site itself is public otherwise.

## Odds

The deployed site reads `odds_snapshot`; fill it from your computer with `node scripts/sync_odds.mjs --remote` (the `ingest/server.mjs` helper runs the local copy every 10 minutes). Run it on a schedule (Windows Task Scheduler every 10 to 15 minutes) if you want the deployed odds to stay current.

## Request limits

SharpAPI's free plan allows 12 requests a minute. Game odds for the whole slate take one or two requests and are cached 10 minutes; each game's player props take about three and are cached 10 minutes. Props load one game at a time and, if the limit is hit, the board shows the games it got and says the rest are missing. Game odds never depend on props.

## Keeping a deployed copy current

Run these on your computer, pointing at the remote database:

```bash
ingest/.venv/Scripts/python research/game_snapshot.py --remote   # re-score the games from today's injury report (seconds, no box-score sync)
```

The box-score sync writes to production with `--remote`; run it before game days:

```bash
ingest/.venv/Scripts/python ingest/sync.py --remote --league --full   # first load of a season (a few minutes)
ingest/.venv/Scripts/python ingest/sync.py --remote --league          # afterwards: only what is new (seconds)
```

`--all-active` still works as a one-player-at-a-time fallback (about 25 minutes); the Sync button uses it automatically if the league-wide request fails.
