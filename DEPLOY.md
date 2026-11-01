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
   - `ODDS_API_KEY`: your key from the-odds-api.com.
   - `CAPTURE_TOKEN`: a long random string. Without it, writes and credit-spending refreshes only work from localhost, so nothing could ever update the deployed copy.
   - Optional: `ODDS_MONTHLY_CREDITS` (default 450), `ODDS_MAX_EVENTS` (default 3, at most 15), `ODDS_HOURS`.
4. Check the configuration. With `--production` a placeholder database id or a missing `CAPTURE_TOKEN` fails instead of warning:
   ```bash
   npm run check:config -- --production
   ```
5. Put Cloudflare Access (Zero Trust, free for a few users) in front of the site if it is only for you. The site itself is public otherwise.

## Credits

Every odds request goes through one gate that adds its cost to a monthly counter in D1 before it is sent, and refuses it when the month is spent. A page load
cannot spend past `ODDS_MONTHLY_CREDITS`. `GET /api/status` shows `oddsCredits: { month, used, limit, remaining }`.

## Keeping a deployed copy current

Run these on your computer, pointing at the remote database:

```bash
ingest/.venv/Scripts/python research/game_snapshot.py --remote   # re-score the games from today's injury report (seconds, no box-score sync)
```

The box-score sync writes to production with `--remote`; run it before game days:

```bash
ingest/.venv/Scripts/python ingest/sync.py --remote --all-active --seasons 1 --delay 1
```
