# How uBet fits together

uBet answers one question for each upcoming NBA game: **who is likely to win, and how sure are we?** It shows the answer next to the sportsbooks' prices, the projected lineups and who is injured. It does not suggest bets. Everything it says about itself is meant to be checkable.

## What you see

| Tab | What it is | Where it comes from |
|---|---|---|
| **Teams** (home) | Each game with our pick and how sure we are, the market's chance, the best price per side, the model's reasons, and Claude's gut pick | `GET /api/team-bets` (`functions/api/[[route]].ts`, logic in `shared/teamBets.ts`) |
| **Lineups** | Five projected starters per team with injury flags from the NBA's report, next men up, who else is listed | `GET /api/lineups` (`shared/lineups.ts`) |
| **Games** | Scores and the box score of a game | ESPN's public scoreboard, read when the page loads |
| **Review** | How the model's calls for this season's finished games turned out, and Claude's gut record | `GET /api/season-review`, `GET /api/gut` |
| **Standings** | League standings | ESPN's public feed |

The player-props tabs (Props, Matchups, Cheat sheet, Results, Players) are switched off (`PLAYER_PROPS = false` in `src/lib/features.ts`); their code and routes still exist.

## Where the data comes from

```
NBA.com box scores ──ingest/sync.py --league──────────────► D1: games, player_games           (minutes, last played)
NBA.com league logs ─research/pull_raw.py─► research/data/*.csv ─┐
                                                                  ├─research/game_snapshot.py─► D1: game_lean (model numbers),
SharpAPI game odds ──scripts/sync_odds.mjs──► D1: odds_snapshot   │                                 game_lean_log (model + market, never edited),
NBA injury report PDFs ─research/nba_injury_pdf.py─► D1: nba_injury_report ─┘                       season_review, injury_log
ESPN scoreboard / standings ── fetched by the API when a page loads (cached a few minutes)
```

* **The model** (games-v2, `research/game_features_v2.py`) is a logistic model on a margin-aware Elo, opponent-adjusted team ratings (30, 60 and 120 day), the talent of rotation players the NBA's report lists **Out**, and rest. It is fitted on seasons from 2018-19 on. It is **not** tested against sportsbook prices; that test is running live (`research/PREREG_MARKET_GAMES.md`).
* **What the Teams page shows as "our chance"** is 30% model and 70% market (`MODEL_WEIGHT` in `shared/baseline.ts`). With no price it is the model alone. A model number older than 36 hours is ignored.
* **Injury flags** come only from the NBA's official report (`official.nba.com`, a PDF re-posted about every 15 minutes). No other feed is used for flags or for the model. A team that has not submitted shows the default lineup with no flags.
* **Claude's gut picks** are saved before tip-off from localhost only (`POST /api/gut`), locked once the game starts, and scored later against the model's own pre-game number. They never change a displayed probability.

## Where each piece runs

| Piece | Runs | How it is kept current |
|---|---|---|
| The site and API | Cloudflare Pages + D1 (`ubet-app`) | Publish with `npx wrangler pages deploy dist --project-name ubet-app`, or let `.github/workflows/deploy.yml` do it on push (needs the two repository secrets in `DEPLOY.md`) |
| Syncs, model snapshot, injury report | **Your computer** (NBA.com blocks cloud servers) | `npm run dev:sync` runs them on a timer while it is open (odds every 10 min, NBA report every 15 min, box scores every few hours). The live database is only updated when you run `npm run setup:remote` (or `-Quick`) |
| Health of the live site | `GET /api/health` | `npm run check:remote` reads it and says what is stale |

## Tests and how decisions are made

* **Unit tests** (`npm test`): pure logic in `shared/` and `src/lib/`, including **property tests** (`shared/properties.test.ts`) that try hundreds of random inputs against rules that must always hold. They were checked by deliberately breaking the code and confirming a test fails.
* **Integration tests** (`npm run test:integration`): the real Worker against a fake odds provider and a small deterministic league (`tests/integration/fixture_seed.mjs`), so they need no synced data. Set `UBET_FIXTURE=1` to force the fixture even when a local database exists.
* **Research tests** (`python research/tests/run_all.py`): features must look only backwards (leakage tests), parsers, reports.
* **Pre-registration.** Every change to the model is written down first (`research/PREREG_*.md`: question, data, rule), run once, and the outcome appended whatever it is. So far no extra factor has beaten games-v2; `RESULTS_*.md` and the outcomes in each `PREREG_*.md` say what was tried.
* **CI** (`.github/workflows/ci.yml`): types, lint, unit, build, audit, integration and research tests on every push.

## What it cannot do (on purpose, and honestly)

* It has **no sportsbook-beating claim**. Historical game lines do not exist in this system, so the model has only been tested against what happened, never against prices.
* **Starters are projected**, not confirmed (the five with the most minutes over the team's last 10 games). Real lineups appear about 30 minutes before tip and are not read here.
* A status is what the NBA's report **lists**, not a probability of playing. The model counts only players listed Out.
* Injury **history** before this system started storing reports is being backfilled from the league's archive (`research/backfill_injuries.py`); until that is evaluated (`research/PREREG_GAMES_V8.md`) the model does not use Doubtful, Questionable or Probable.
