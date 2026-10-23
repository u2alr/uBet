# uBet audit scorecard (2026-10-23)

Scores are 0 to 10 and judge the current local build (`main`, 10 local commits ahead of `origin`). Evidence is from commands run in this session:
unit tests (174 pass), DB tests (11 pass), ingest tests (4 pass), integration (47 pass, 1 fail), typecheck, lint, build, and `research/ui_audit.mjs`
(headless Edge driving the real app at 1440x900 and 390x844, with the props payload served from a cached odds download because the odds provider is out of credits).

| Area | Score | Evidence |
|---|---|---|
| Probability, EV and settlement maths | 8 | One canonical engine; push/void/half-win handled; exact-boundary tests (50/60/+2/+3); 174 tests. Blend weight (70% market) and parlay independence remain unvalidated and are labelled so. |
| Data integrity and provenance | 7 | Per-quote timestamps, identity checks, immutable run snapshots and replay test. Only two books quote today (DraftKings, FanDuel), so many candidates fail the 2-book rule. |
| Calibration and validation | 5 | Walk-forward artifact exists, but it is on pseudo-lines, not book lines. Points and assists fail the final-season gates. PRA has no calibration at all. |
| Decision enforcement (Chief, caps, tiers) | 8.5 | Thresholds recomputed from the record; hostile-proposal and fail-closed tests; caps only remove. |
| Auditability and reporting | 6 | Candidates and inputs are stored, but nothing reads them: no report endpoint or screen. `shared/metrics.ts` is unused by the app. |
| Test suite | 7 | 174 + 11 + 4 pass. One pre-existing integration test (`/capture` window) fails on time of day. No tests for the new props board, H2H endpoint or player H2H. |
| Security and operations | 7 | Secrets in a gitignored `.dev.vars`; validated inputs. The new `/api/h2h` binds up to ~180 SQL variables, over D1's 100-variable limit (see UI finding 1). A key was pasted into chat and should be rotated. |
| Performance | 4 | Props board renders 23,345 DOM nodes, 93 MB heap, 4.7 s to settle; one 750 KB JS bundle with no code splitting. |
| UI visual design | 7 | Consistent, readable, bigger cards, good hierarchy on desktop. |
| UI accessibility and semantics | 5 | No `h1` or `main` on any page; 2,532 text nodes under 11 px on the props board; 99 click targets under 24 px on Minds; mobile nav clips the Results and Players tabs; Minds overflows 19 px sideways on mobile. Alt text, labels and focus all fine (0 unlabeled controls). |
| UI correctness and honesty of copy | 5 | `/api/h2h` returns 500 and the cards then say "no earlier games", which is false. Minds still shows v6 wording ("uncertainty haircut", "no market to check"). The "200 settled bets" bar counts one correlated day of paper lines as if it were 200 independent bets. |
| Documentation | 4 | `minds/README.md` and the README still describe the old engine. |

## UI findings (numbered; each was reproduced by the audit script)
1. **H2H request fails with HTTP 500** on the props board: 200 player:opponent pairs become ~180 bind variables; D1 allows 100. Cards then print "no earlier games" (wrong).
2. **Props board is too heavy**: 548 cards in the DOM at once (23,345 nodes, 2.8 MB transferred, 4.7 s).
3. **Broken team logos**: the game headers show empty bordered boxes when the logo fails to load (no fallback).
4. **Tiny text**: 10 px labels on every card (2,532 nodes) are below the 11 px floor.
5. **No `h1`/`main` landmarks** on any page.
6. **Mobile nav clipped**: the tab bar scrolls sideways with a visible scrollbar and hides tabs.
7. **Minds**: 99 targets under 24 px, 19 px horizontal overflow on mobile, stale v6 copy, and a settled-bet threshold that ignores how many days the sample covers.

## Plan (done autonomously after this audit, in this order)
Fix 1, then 2 to 4 together, then 5 to 7, then add a Minds report endpoint using `shared/metrics.ts`, refresh the docs, add tests for the new code, re-run every
suite and the UI audit, and record the after-scores. Nothing is pushed and nothing is written to production.
