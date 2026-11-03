# uBet

NBA stats and prop-bet research tool: a props board grouped by game (points, rebounds, assists, threes, PRA) with head-to-head history, per-player game logs and charts,
upcoming games with live scores, league standings, the injury report per game, suggested bets (value / safest / riskiest), all driven by stored box scores, odds snapshots and graded history. Personal project, informational only.
Sportsbooks are efficient, so treat every suggestion as a lead to check, not a guarantee.

## Stack

- **Frontend:** React, Vite, TypeScript, Tailwind, Recharts
- **API:** Hono on Cloudflare Pages Functions (`functions/api`), D1 (SQLite) for data
- **Data:** box scores via `nba_api` (`ingest/sync.py`, run locally), schedule from ESPN's public
  endpoints, odds from [SharpAPI](https://sharpapi.io) (game odds first, then player props)
- **Model:** boosted projections (`research/project.py`) with a negative-binomial tail, blended with the market's fair price; `shared/baseline.ts` is the fallback
- **Audits:** `AUDIT_ENGINE.md` (engine), `AUDIT_SCORECARD.md` (scores and UI), `node research/ui_audit.mjs` (headless-Edge UI checks)

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars        # add your SHARPAPI_KEY (the free plan is enough)
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
  (an older script that needs The Odds API's paid historical plan, no longer part of the app) then `research/market_eval.py`. `/api/capture` snapshots games about to start into the odds archive.
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
| `SHARPAPI_KEY` | SharpAPI key (the only odds provider) |
| `CAPTURE_TOKEN` | If set, routes that use the odds provider's request allowance or write (`/api/capture`, `?fresh=1`, `POST /api/predictions`) need this in the `x-capture-token` header. If unset they only work from localhost. **Set it before deploying.** |
| `FALLBACK_MODEL` | `v3` switches the fallback model to the negative-binomial baseline (default `v2`; see `AUDIT.md` finding 14) |
| `ODDS_HOURS`, `ODDS_BOOKS` | how far ahead to look (hours) and which SharpAPI books to read (default `draftkings,fanduel`) |
| `ODDS_MAX_EVENTS` | games whose player props the odds sync stores per run (default 8, at most 15; about 3 of SharpAPI's 12 free requests a minute per game). Game odds cover every game regardless. |

`CAPTURE_TOKEN` protects every write to the database.

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

**Odds archive.** Every odds snapshot the website retrieves is stored point-in-time (`odds_runs`, `odds_quotes`, migration 0018): price, line, book, when we saw it, whether it was fresh. `node scripts/capture_odds.mjs` adds
pre-event snapshots (paced to the free plan's 12 requests a minute). The last observation before a documented cutoff is a *closing proxy*, never a true closing line. `GET /api/odds-archive` shows coverage; `research/archive_to_snapshots.py` feeds it to the pre-registered market evaluation.
No market-beating result exists: see `research/MARKET_EVAL_STATUS.md`.

**One calculation.** The probability and expected value on every screen come from `shared/engine/authority.ts`. A pick the engine cannot price shows the older simple blend marked as unvalidated (a tilde and "unvalidated").
**Defensive matchups.** Prop details and the Matchups tab show the estimated defenders (never a confirmed assignment), team defence and offence traits, and the sample behind each (`shared/defense.ts`, `GET /api/defense-context`, `research/DEFENSE.md`). The pre-registered ablation found team-level defence helps slightly (research-only, not used in predictions) and the individual-defender and likely-matchup estimates did not pass (`research/RESULTS_DEFENSE.md`).

**Game-winner view.** Each upcoming game shows a model chance beside the market's, and a "lean" only when they pick different teams by at least 7 points. The model is home advantage + a margin-aware Elo + **which rotation players the injury report lists Out** (the absence feature was validated on the players who actually sat out, rebuilt from box scores, so that is a best case; late scratches and Questionable players are not seen, and a player who changed team over the summer can be wrongly counted out in a team's first one or two games). The rotation reaches back across seasons, so a player who has been out since game one is still seen as out. It improved on the plain Elo baseline on both development seasons and held on the final one, but it has no historical sportsbook test; model, market and the injury report it read are logged side by side from now on (`research/RESULTS_GAMES.md`, `research/PREREG_GAMES.md`).



**Schedule & fatigue.** A prop's details show rest, congestion, estimated travel and workload as facts (`shared/schedule.ts`, `GET /api/schedule-context`), with what is unknown listed. They change no prediction: the pre-registered ablation found no group worth using (`research/RESULTS_HUMAN_FACTORS.md`, how-to in `research/HUMAN_FACTORS.md`).

`GET /api/health` reports configuration and data freshness without secrets.

`AUDIT.md` lists what was found, what was fixed, what is unproven and what is blocked on data.

**Odds are synced, not fetched per page.** `node scripts/sync_odds.mjs` (`npm run sync:odds`; `npm run dev:sync` runs it every 10 minutes on its own) pulls SharpAPI's game odds and then player props into the `odds_snapshot` table, paced to the free plan's 12 requests a minute. The site only reads that table, so page loads never touch the provider and `/api/status` shows how old the stored odds are (`odds`). Add `--remote` to fill the deployed database. Before the first sync the Worker asks the provider itself, once and cached, so a fresh install still shows odds.

**Our own lines.** `GET /api/lines` prices a line and fair odds for every player we project (`?player=`, `?stat=`, `?date=`), straight from the model's distribution (`shared/ownLines.ts`), with no sportsbook and no provider. They are fair prices with no margin, so they say what the model thinks a bet is worth; they are not an offer anyone will take, and they are only as current as the last `ingest/sync.py` run (`meta.stale` says when they are not).

**Market maths.** `shared/devig.ts` removes each book's margin with the power method and combines books by median, dropping one far-off book when three or more quote. A best price more than 15 % above the runner-up is capped at the runner-up, a game-model snapshot older than 36 hours is ignored (market only), and a game priced by one book is shown but never recommended. See `AUDIT_2026-11-03.md`.

**Team bets first.** The home page (`#/Teams`, `GET /api/team-bets`) lists every game with the market's spread, total and best moneyline on each side, the market's chance with the margin removed, our chance (the game model blended with the market, as props do), expected profit, and our own fair moneyline and spread. Spreads and totals are market lines only: there is no validated model of margin or scoring, and our spread is a conversion of our win chance. The game model has not been tested against sportsbook prices, so expected profit carries a tilde and is a rough guide. `research/game_snapshot.py` refreshes the model numbers (the sync does it).

**Game model (games-v2).** Our chance in each game comes from a model that stands on its own: no odds are needed to produce it. It is a logistic model on a margin-aware Elo, ratings adjusted for the strength of every opponent (a ridge regression over all past results, so "A beat C, B lost to C" chains are used together), the talent of rotation players the injury report lists as Out, and rest (`research/game_features_v2.py`). Head-to-head and common opponents are shown as context from this season's regular-season games only; they are not model inputs. It was chosen by a pre-registered experiment (`research/PREREG_GAMES_V2.md`, results in `research/RESULTS_GAMES_V2.md`): on four seasons it never saw it beat the previous model in log loss by 0.0046 (95% interval 0.0021 to 0.0071), mostly in better probabilities rather than more correct picks, and the boosted-tree variant did not help. It has not been tested against sportsbook prices (none exist for past games), cannot see late injury news, and the live comparison with the previous model accumulates in `game_lean_log`. `research/game_snapshot.py` scores upcoming games (the sync runs it); `research/pull_history.py` fetches the extra seasons it trains on. Rerun the evaluation with `ingest/.venv/Scripts/python research/game_eval_v2.py` and `research/game_report_v2.py`.

**Season review.** The Review tab (`GET /api/season-review`) shows how the model's calls for this season's games turned out: each game as the model would have called it before tip-off (fitted on earlier seasons only), who the favourite was, who won, how often favourites at each confidence level won against what was said, and what the upsets had in common. It counts upsets against what the model expected before reading anything into them, and says when a sample is too small to show a pattern. What it found so far is in the page; the two ways of making the model adapt within a season that were tested (online recalibration, an early-season shrink) did not help and are recorded in `research/PREREG_GAMES_V2.md`. The table behind it (`season_review`, migration 0024) is rewritten by `research/game_snapshot.py`.

**Factors tested for the game model, and shadows.** Beyond games-v2, three more rounds of candidate factors were tested out of sample under pre-registered rules and none was adopted: roster-return credit and a roster-aware preseason prior (`research/PREREG_GAMES_V3.md`), and momentum, player importance, a chemistry proxy, team-specific home court, close-game luck and shooting luck (`research/PREREG_GAMES_V4.md`). Player feuds cannot be tested (no data). The two most promising, returning players and player importance, are stored as SHADOW predictions beside the shipped one before every game (`game_lean_log`) and never displayed; `research/shadow_report.py` scores them, the old model and the market on the live record, and importance is adopted only after at least 300 live games with a paired improvement whose 95% interval is entirely above zero. `research/injury_outcomes.py` measures how often players listed Questionable or Day-To-Day actually play, from `injury_log`, which fills as the sync runs.

