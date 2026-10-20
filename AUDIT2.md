# Second-pass audit (October 2026)

Scope: `functions/api/[[route]].ts` (the only Functions file), migrations 0001-0010, the odds/schedule fetchers, every D1
read/write, `ingest/*`, `minds/run.mjs`, and the frontend-to-API flow. Everything below was read in the code; "Verified"
means a test that fails on the old code and passes on the new code (re-run against the old code to prove it), "Risk"
means it needs a live deployment or load to confirm and nothing was changed.

## Verified bugs (fixed, each with a regression test)

| # | Severity | Where (before the fix) | What happens | Fix | Test |
|---|---|---|---|---|---|
| 1 | **High** (mine) | `ingest/sync.py:28` | A stray line break inside a string literal (added when wiring in `grade_minds.sql`, shipped in `ae213bb`) made the file a `SyntaxError`: every sync, the Sync button and the scheduled update failed. `py_compile ingest/sync.py` reproduces it. | rewrote the expression | `tests/ingest.test.mjs` compiles `sync.py` and `project.py` |
| 2 | Medium | `ingest/server.mjs:81` | The player-name check allowed `-` anywhere, so `POST /sync?player=--remote` passed and ran `sync.py --seasons 3 --remote`: a *local* sync writing to **production D1**. argparse reads any leading `-` token as an option. Reachable by anything on the machine that can reach 127.0.0.1:8789 without an `Origin` header (curl, a local script); a browser page on another site is blocked by the Origin check. | names must start with a letter (`ingest/playername.mjs`) | `tests/ingest.test.mjs` |
| 3 | Medium | `ingest/sync.py` (`MARK_SYNCED` in every `flush`, and in `--teams-only`) | `last_sync` was stamped after the first 50-player batch, after a run in which players raised `FAILED`, and after a teams-only run that fetches no box scores. The app's "box scores are stale" warning (`[[route]].ts` `boxscores_stale`) therefore went quiet on partial data, and the helper reported success because the script exited 0. | stamp only in the final flush of a run with zero failures; exit non-zero when any player failed; teams-only never stamps | `tests/test_sync_flush.py` (2 of 4 tests fail on the previous script) |
| 4 | Medium | `[[route]].ts` `loadGames` (`d.toISOString()`, UTC) | The schedule asked ESPN for UTC dates. From 8pm Eastern (00:00 UTC) the window started tomorrow, so tonight's in-progress and just-finished games disappeared from Today and `/games/:id` returned 404 for them. | `scoreboardDates()` in `shared/picks.ts` uses the Eastern calendar (`[[route]].ts:224`) | `shared/picks.test.ts` (9pm ET, month end, DST change day) |
| 5 | Medium | `[[route]].ts` `/games/:id` (`p.game === matchup`) | Picks are labelled with Odds API names ("Los Angeles Clippers") and compared with ESPN names ("LA Clippers"), so a Clippers game page showed no suggested bets. The code already knew the names differ (`teamKey`, used for team odds) but not here. | `sameMatchup()` compares through `teamKey` (`[[route]].ts:486`) | `shared/picks.test.ts` |
| 6 | Medium (credits) | `[[route]].ts` `/games/:id` + `GameDetail.tsx:50` | Refresh on a game page sent `?fresh=1`, which `/games/:id` forwarded to `loadPicks`: a privileged caller re-fetched `/events` plus every event's props, about 24 credits per click. The Today page had been fixed for this earlier; the game page had not. | `/games/:id` keeps props on their own cache (`[[route]].ts:482`); schedule and team odds still refresh | `tests/integration/minds_games.test.mjs` counts fake-provider requests |
| 7 | Low-Medium | `minds/run.mjs` card insert | `bet_key` includes the legs, so running the job twice in a day with moved lines inserted **additional** bets: the 5-bets-a-day cap and "frozen card" rule did not hold across runs. | a mind that already has a card for the day is skipped (`runMinds(..., done)`) | `shared/minds.test.ts` |
| 8 | Low | `[[route]].ts` `/minds` `statedProb` | "Said" averaged probabilities over won, lost **and pushed** bets while "got" counted only won and lost, so the two numbers compared different bets. | both use won/lost only (`[[route]].ts:531`) | `tests/integration/minds_games.test.mjs` |
| 9 | Low | `[[route]].ts` `/minds` `.catch(miss)` | A missing table (migration 0010 not applied) returned empty arrays, so the tab said "No cards yet" instead of failing. | errors propagate to the generic 500, which the tab shows | not tested (would need dropping a table in the scratch DB) |
| 10 | Low | `PlayerView.tsx` `logPrediction` | Every failure (validation, 500, 403) showed "Logging is only allowed from your own machine." | shows the server's message | not tested (UI) |

## Risks, not changed (need a live deployment or are by design)

| Severity | Where | Concern | How to confirm |
|---|---|---|---|
| Medium | `[[route]].ts:91` `cachedMeta` | The Workers Cache API is **per data centre**. A deployed site serving several regions refetches once per region per TTL, and concurrent cold requests in one region both miss (no single-flight). Credits scale with regions, not just time. | Deploy, request from two regions, count provider calls. Mitigation if it matters: store snapshots in D1 or KV instead. |
| Medium | whole API | No rate limiting. Public GETs are cheap and cached, but cold-cache requests call providers and write `odds_raw`. | Add a Cloudflare rate-limit rule / Access before sharing the URL. |
| Low-Medium | `[[route]].ts:113` `oddsFetch` | A public GET on a cold cache writes the full provider body to `odds_raw`, with no retention. Bodies can be large and a failure is swallowed. Unbounded growth in D1. | Check `SELECT SUM(length(body)) FROM odds_raw` after a week; add a retention delete to `sync.py`. |
| Low | `POST /predictions` | Rows have no `game_date`, so `grade.sql` never grades them and the unique index (NULLs) does not stop duplicates. The button logs data that can never appear in Results. | Decide: remove the button or require a game date. |
| Low | `Today.tsx`, `Minds.tsx`, `Results.tsx` | Effects have no cancellation: two quick Refresh clicks can show the older response last. | Throttle the network in dev tools and click Refresh twice. |
| Low | `games.date` | No index; `WHERE g.date = ?` scans (`EXPLAIN QUERY PLAN` shows `SCAN g`). With 1,542 games this costs nothing, so no index was added. | Revisit if the table grows 100x. |
| Low | `ingest/sync.py` | A NaN in a box-score column would write the text `nan` into the SQL and fail that 50-player batch. Not observed. | Feed a frame with NaN to `player_sql`. |

## Checked and found sound

- **SQL injection:** all values reach D1 through `.bind`. The three interpolations are `pg.${stat}` (checked against the `STATS` whitelist first), player-id lists built from database integers, and `IN (?,?)` placeholder lists. `LIKE` input is escaped. Local scripts build SQL with a quoting helper (`q`) or numbers from the database.
- **Authorization:** the write-capable routes (`/predictions`, `/capture`, `?fresh=1`) require `CAPTURE_TOKEN` (constant-time compare) or localhost; covered by existing integration tests. Without `CAPTURE_TOKEN` set in production, only localhost passes, which means they are off, not open.
- **Probability / EV with bad input:** `line=Infinity/NaN`, negative or oversized lines, prices at or below 1, missing sides and NaN probabilities are rejected or counted in `invalidQuotes`; covered by the earlier audit's unit and mutation tests.
- **Dates:** pick dates use `etDate`; box scores use NBA.com's own local date; the 36-hour projection limit and 2-day void rule are in UTC but have day-scale slack.

## Not run
`npm run test:mutation` (the earlier 30-mutant check) was not re-run after these edits; `shared/baseline.ts` was not touched.
