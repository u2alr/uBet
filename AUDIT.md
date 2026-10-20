# Audit: the number users act on

Scope (agreed before starting): prove, or find the flaws in, the chance and expected value shown on a pick, and close the
ways the public app can leak credits or secrets. Not in scope: new charts, filters, comparisons, parlay UI, new dependencies.

Every statement below is tagged **verified** (reproduced with a command or test in this repo), **measured** (an out-of-sample
study with its rules fixed beforehand), or **hypothesis** (plausible, not shown). Nothing is fabricated; where data does not
exist, the tooling is built and the gap is named.

## 1. Findings

| # | Severity | Status | Finding | Evidence |
|---|----------|--------|---------|----------|
| 1 | High | verified, fixed | **Ties were handed to the Under.** `Under = 1 - Over` on a whole-number line gives the refund probability to the Under; the error equals P(tie) exactly (3% to 11% on the four whole-line picks in the test scenario, 22% for a Poisson(3) at line 3). The normal branch also ignored the half-point boundary: over 18 and over 18.5 are the same event for a count yet differed by 9 points. Hit rates counted ties as misses. | `research/out/evidence_before.mjs` against the old code; 1,288 scipy reference cases now pass |
| 2 | High | verified, fixed | **One request could hang the Worker.** `line=Infinity` made the Poisson loop run `i <= Infinity` forever; `line=NaN` returned a confident 86% / 96% probability for garbage input. | probe against the original commit: no response in 6 s; now `400` in milliseconds |
| 3 | High | verified, fixed | **Anyone could spend provider credits.** `GET /api/games?fresh=1` bypassed the cache with no authorisation. | fake provider counted upstream calls: original 1, fixed 0 (cache primed first so a cold cache cannot confuse the count) |
| 4 | Medium | verified, fixed | **Anonymous writes.** `POST /api/predictions` accepted any body from anyone, including `line:"abc"`, `pOver:7` and a 5,000-character model name (2 rows added, one of them junk). A body of `null` caused a 500 (found by the new tests). | probe + `tests/integration/api.test.mjs` |
| 5 | Medium | verified, fixed | **A page view wrote to the database.** `GET /api/results` graded pending picks. Grading now runs in `ingest/sync.py` from `ingest/grade.sql` (6 tests). | probe: original graded a seeded pick on a GET, fixed does not |
| 6 | Low | verified, fixed | Internal error text reached the browser (e.g. a JSON parser message). Now a generic `500`/`502`; detail goes to the server log. | probe |
| 7 | Low | verified, fixed | LIKE wildcards in `/players?search=` were live (`%` returned everyone); searches over 64 characters accepted. | probe |
| 8 | Medium | verified, fixed | **Corrupt box-score row.** A preseason row for Mark Williams had **-4 minutes**; the sync only skipped zero. Filter fixed, row removed, and `npm run check:data` guards it. | `ingest/check_data.mjs` |
| 9 | Medium | measured, fixed | **The `confidence` score meant nothing validated.** It failed its pre-registered test in 0 of 6 stats (top tercile has lower *relative* error, which is mechanical, but no better probabilities; 25% of its variance is just the stat type) yet scaled the model's weight in the blend. Removed; the blend uses a fixed placeholder weight of 0.3 (the old weight was about 0.29 to 0.33 for typical players). `effectiveGames` replaces it and is only a description of the data. | `research/confidence_check.py`, `PREREG_AUDIT.md` |
| 10 | Medium | verified, fixed | **Stale projections were used forever.** No age check. Projections older than 36 hours (or with no/invalid timestamp) are now ignored with a visible warning. | unit + integration tests |
| 11 | Medium | verified, fixed | **Odds age was invisible.** Odds can be up to 8 hours old (cache lifetime). The page now shows when they were fetched, warns past 4 hours and shows nothing past 9. | `assessOddsAge` tests |
| 12 | Low | verified, fixed | Team-odds failures were swallowed (`.catch(() => new Map())`); the page showed games with no odds and no reason. Now reported. | integration test |
| 13 | Low | verified, fixed | `GET /api/picks` ran 40 database writes on every view. Now at most once per 10 minutes. | integration test |
| 14 | Medium | measured | **Poisson-below-6 / normal-above is not the best rule.** Negative binomial (or a constant-dispersion variant) beat it with a 95% interval above 0 in both development folds in 12 (statistic, mean-bucket) cells; the rule's output listed 20 cell-and-distribution combinations because several distributions qualified in some cells (e.g. rebounds 2-6: +0.051 and +0.055 nats per prediction; assists 2-6: +0.026, +0.028; threes 2-6: +0.008, +0.007). For points with mean above 6 (most props) the existing normal stays. Implemented as the opt-in `baseline-v3` (`FALLBACK_MODEL=v3`), **off by default** because it is unconfirmed on forward data. | `research/dist_study.py` |
| 15 | Medium | verified (earlier work) | The app's own over-probabilities were overconfident (calibration slope 0.48 for points, 0.7 for rebounds and assists). The boosted projections with a fitted negative-binomial tail are close to calibrated (0.85 to 0.92). | `research/RESULTS.md` |
| 16 | Low | verified, fixed | Parlay figures multiplied legs as if independent, with no warning, and a tied leg counted as a loss. Now labelled "if independent", a tie drops the leg, and old saved slips without the new field cannot produce NaN. | tests |
| 17 | Low | verified, fixed | Duplicate React keys on the game page (a player can appear twice per stat). | earlier commit |

### Hypotheses and gaps, not verified

- **Best-price selection may favour stale or outlier quotes.** EV is computed at the single best price across books while the market probability is a consensus. In the one real sample (5 books, 92 player-lines) the best Over plus best Under never implied a sure profit (lowest sum 1.000), so there was no direct sign of it, but one sample cannot rule it out. Needs historical lines.
- **Large model-versus-market gaps on stars** (the many Unders on stars) probably reflect news the model cannot see. The `⚠` flag fires above a 25-point gap; that threshold and the halved weight are heuristics, unvalidated.
- **Whole-number lines may be rare for points** (0 of 92 in the one real sample) and more common for rebounds and assists; unmeasured. Finding 1's practical size depends on this.
- Same-game parlay legs are positively correlated; nothing here estimates by how much.

## 2. What was measured, and how

Rules were committed before running (`research/PREREG_AUDIT.md`, commit `6a1c752`). Development folds only; the 2025-26
held-out season was spent on the accuracy question and was not reused. One departure is recorded: where several candidate
distributions qualified for a cell, the one with the best mean log score across the folds was chosen, a tie-break added after
seeing results. It affects which qualifying distribution was picked, not whether any change was warranted.

Differential check of the Worker rewrite: the same controlled provider data through the old and new Worker gave the same 15
picks with **292 unchanged fields and 0 unexpected differences**; the 11 half-point picks' blend, EV and risk tier match an
independent recomputation; only the 4 whole-number-line picks changed (`tests/integration/compare_golden.mjs`).

## 3. Tests and checks

| Command | What | Count |
|---|---|---|
| `npm test` | probability maths vs scipy, ties, invalid input, pick builder, freshness, v3 | 67 |
| `npm run test:db` | grading SQL | 6 |
| `npm run test:integration` | real Worker + fake provider + scratch DB: credits, writes, validation, errors, headers, picks, v3 | 22 |
| `npm run test:mutation` | plants 30 known bugs; every one must make a test fail | 30 of 30 caught |
| `npm run check:data` | database integrity (points = 2FGM+3PM+FTM held on all 26,606 rows) | 14 must-pass + 7 info |
| `npm run check` | typecheck (app, Worker, tests), lint (0 warnings), unit and db tests | |
| `research/tests/*.py` | leakage, TS-vs-Python model ports, v3 vs an independent scipy implementation (184 cases), calibration report, market and Kalshi evaluation code | |

The first mutation run caught **4 blind spots** in my own tests (playoff weights, playoff dates, wrong-statistic projections, an
always-tying line) and a second run caught 2 weak v3 tests; all were closed. `npm audit`: 0 vulnerabilities. The git history
contains neither key that appeared in the working session (0 matches), and no secret-like strings.

## 4. Remaining risks and blocked work

1. **No sportsbook edge has been shown.** The model/market blend weight (0.3) and the 25-point gap rule are placeholders until
   real lines exist. Blocked on data: historical lines need a paid Odds API plan (`research/backfill_odds.py`, pre-registered in
   `PREREG_MARKET.md`); the free route is the Kalshi collector (`PREREG_KALSHI.md`), which needs about six weeks.
2. **Calibration of the app's own picks cannot be reported yet.** `research/calibration_report.py` is built and tested but there
   are 0 graded picks: games start tomorrow. The 141 earlier picks are excluded (logged before the model/market components and
   refund-aware probabilities existed). It will not print a score before 300 decided picks over 15 game dates.
3. **Injuries and lineup news are not modelled.** The page says so on every view.
4. **`baseline-v3` is unconfirmed on forward data**, hence opt-in.
5. **Before deploying publicly:** set `CAPTURE_TOKEN` (otherwise the credit-spending and write routes are localhost-only, which
   also means Refresh cannot re-fetch odds and Log is refused on the public site), add a Cloudflare rate-limiting rule and put the
   site behind Cloudflare Access. The Worker cannot rate-limit by itself. Apply migrations `0007` to `0009` to the production D1
   and run `sync.py --remote` once so the new minute filter and grading take effect there. A strict Content-Security-Policy was
   not added (the charts use inline styles); that is optional hardening.
6. **Integration tests need a locally synced database** (they copy it); they are not hermetic about data, only about providers.
7. Mixed Windows/Unix line endings exist in some files from the editing tools; harmless, not normalised.
8. `GET /api/games/:id` recomputes all picks on each view (4 D1 reads plus cached odds). Fine at personal scale; cache it if traffic grows.
9. Position is never stored (`488` players have none); only matters if positional matchups are added.

## 5. Running everything

```bash
npm run check                 # types, lint, unit + db tests
npm run test:integration      # real Worker against a fake provider (needs a synced local database)
npm run test:mutation         # do the tests have teeth?
npm run check:data            # database integrity
ingest/.venv/Scripts/python research/tests/test_v3.py          # (and the other research/tests/*.py)
ingest/.venv/Scripts/python research/calibration_report.py --peek
```
