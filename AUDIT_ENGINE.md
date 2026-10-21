# Betting engine audit (before the rewrite)

Scope: odds ingestion (`shared/oddsblaze.ts`), pick construction (`shared/picks.ts`), the minds and Chief (`shared/minds.ts`),
the runner (`minds/run.mjs`), grading (`ingest/grade_minds.sql`) and the record (`functions/api/[[route]].ts`).

## Data flow as it was
OddsBlaze quotes (one response per book) -> `normalizeOddsBlaze` -> `buildPicks` (history, fresh projection, negative-binomial
tail, per-line market consensus, blend) -> `Pick[]` -> `minds.ts` (eligibility, four evidence functions, proposers, Chief caps)
-> `mind_bets` / `mind_rejections` rows -> grading SQL -> `/api/minds`. Decision inputs were **not stored**: a decision could not
be reproduced from the database.

## Findings

| # | Severity | Finding | Where |
|---|---|---|---|
| 1 | **High** | The calibration correction `0.5 + slope*(p-0.5)` applies a *logit-space* slope in *probability* space and ignores any intercept (an overall Under/Over lean). It is not a calibration. | `minds.ts` `quant` |
| 2 | **High** | The "uncertainty" `sqrt(p(1-p)/n_games)` treats a model probability as a binomial proportion from `n` trials. It is a manufactured standard error, and the 0.5 multiplier is arbitrary. | `minds.ts` `quant` |
| 3 | **High** | Odds timestamps were never used. OddsBlaze supplies a per-quote `updated`; the engine trusted "downloaded just now". A stale quote was indistinguishable from a fresh one. | `oddsblaze.ts`, `picks.ts` |
| 4 | **High** | Decisions were not auditable or reproducible: no immutable pre-game snapshot of candidates, no run record (model, calibration, config versions), rejected candidates stored without their inputs. | schema, `run.mjs` |
| 5 | **High** | Market consensus was the *mean* of proportionally de-vigged books: no outlier handling, no check that two "books" are independent feeds, no per-quote freshness, one de-vig method. | `picks.ts` |
| 6 | Medium | Player identity was matched by name only. OddsBlaze carries the NBA player id; a name collision or alias would silently mis-assign a line. | `picks.ts` |
| 7 | Medium | Duplicated and inconsistent eligibility: sample 10 vs 15, role 24 vs 18 vs 20, top-6 vs top-10 appear in `ineligibleReason`, `skeptic`, `volumeReason` and the starter selection. | `minds.ts` |
| 8 | Medium | `Pick.ev`/`prob` (blend of the *raw* model) and the Chief's own `quant` are two EV calculations in the same system. | `picks.ts`, `minds.ts` |
| 9 | Medium | The "independent evidence" claim is weak. Matchup (opponent allowed) is a simpler view of features the boosted model already uses; Market and Quant share the same consensus; Skeptic re-reads the same inputs. They are checks, not independent proofs. | `minds.ts` |
| 10 | Medium | Leans were staked (0.5 unit) and described as bets, and defined as "raw edge that fails" without requiring that the *only* thing failing was the conservative threshold. | `minds.ts` |
| 11 | Medium | Payoff maths supports only win/lose/push. Half-wins and half-losses (and voids) cannot be represented. Fine for over/under props, wrong if the engine is reused for other markets. | `baseline.ts` |
| 12 | Low-Med | Thresholds are compared on raw doubles with no rule about rounding; nothing tests the exact-boundary cases. | `minds.ts` |
| 13 | Low | Parlays multiply "conservative" leg probabilities and call the result conservative. Independence across games is unvalidated; the product is not a valid bound. They were already research-only but not labelled as an experimental baseline. | `minds.ts` |
| 14 | Low | Caps are configurable only by editing constants; nothing validates a configuration or logs which cap removed a candidate. | `minds.ts` |

## What was already sound
No quota anywhere in the strict tier; the Chief can reject everything; hard vetoes are code, not prose; rejected candidates are
recorded and graded; the previous work already refused stale projections, listed-injured players, lone prices and extreme gaps.

## Not fixable with the data that exists
- **Edge versus a market cannot be validated.** No historical sportsbook lines exist; the only honest test is the forward record.
- **Line movement.** No timestamped history. Left as an explicit extension point (`odds_snapshots`), reported as unavailable.
- **Joint probability of parlay legs.** No data to validate dependence. Parlays stay research-only.

## Status after the rewrite (minds-v7)
Fixed in code, each with tests: one canonical payoff/EV engine (`shared/engine/payoff.ts`, push/void/half-win/half-loss aware, no rounding at the 50/60/+2/+3 boundaries); vig removal and independent-feed consensus with a 3% best-price cap (`consensus.ts`); calibration artifact with bootstrap uncertainty replacing the invalid logit-slope and 0.5-SE haircut (`calibration.ts`, `research/calibrate.py`, `research/PREREG_CALIBRATION.md`); one shared eligibility policy with structured reason codes (`record.ts`, `reasons.ts`); a deterministic Chief that recomputes every threshold and ignores anything else a proposal says (`minds.ts`); portfolio caps that only remove; SHADOW_ONLY leans; RESEARCH_ONLY parlays; immutable run snapshots and candidate records (`migrations/0015`, `shared/snapshot.ts`, replay test); metrics with intervals (`shared/metrics.ts`).

Real calibration result (`shared/calibration.json`, walk-forward on pseudo-lines, NOT sportsbook lines): the raw model was kept for all four statistics (nothing beat it on validation). Points (slope 0.828) and assists (ECE 0.053) failed the final-season gates and are `unvalidated`, so they cannot be strict bets; rebounds and threes passed. The model leans Under on points and assists.

First dry run on a cached 3-book slate with the final artifact: 0 strict approvals, 2 SHADOW_ONLY leans, 1 research-only line. That is the system failing closed, not a bug.

Still blocked: validating any edge against sportsbook prices (no historical lines), closing-line value (no closing odds stored), line movement (single snapshot per run; extension point only), parlay independence, and a per-player uncertainty estimate.
