# Market evaluation status (as of 2026-10-26)

No hypothesis in `PREREG_MARKET.md` or `PREREG_KALSHI.md` has been tested, and no criterion was changed. This file records why, and what is now collecting.

## PREREG_MARKET.md (H4 information, H5 closing-line value, H6 profit): CANNOT BE COMPLETED YET
- Required: historical sportsbook props at about 180 and about 20 minutes before tip for a sample of 2025-26 games, from `research/backfill_odds.py`.
- Found: `research/data/odds_hist/2025-26/` exists and is **empty**. Historical odds need a paid Odds API plan; none was purchased (no cost without approval).
- `research/market_eval.py` enforces the pre-registered minimum (3,000 matched props); with no data it cannot print a verdict, and it must not.

## PREREG_KALSHI.md (H7, H8, H9): MINIMUM NOT MET
`python research/kalshi_eval.py --peek` (counts only, by design): 974 collector runs from 2026-10-19 to 2026-10-26; 2,611 liquid props with an outcome (needed 1,500, met) across
**4 distinct game dates (needed 30, not met)**. The script refuses to print scores until both hold. Nothing was looked at early.

## What now collects sportsbook prices prospectively (new)
- Every odds snapshot the website or the Minds runner retrieves is recorded in `odds_runs` / `odds_quotes` (migration 0018, `shared/oddsArchive.ts`): book, price, line, side,
  retrieval time, the quote's own time and where it came from, freshness, availability, main-line flag. Only changes are stored; disappearances are recorded.
- `node minds/capture_odds.mjs` takes pre-event snapshots for games starting in 10 to 60 minutes (credit-capped, reserve 100, stops on HTTP 429). The last observation before a
  documented cutoff is a **closing proxy**, never a true closing line (`closingProxy` always returns `isTrueClosingLine: false`).
- `GET /api/odds-archive[?event=ID]` shows coverage and each market's first observed price and closing proxy, with the reason when there is none.
- `research/archive_to_snapshots.py` converts the archive into the snapshot files `market_eval.py` already reads (open about 180 and close about 20 minutes before tip, nearest prior
  observation within 25 minutes, stale or unavailable observations left out). The analysis code and acceptance criteria are untouched.

## What this still cannot show
Whether the model carries information beyond the books' prices, whether any strategy has positive closing-line value, or any ROI. There is **no evidence of market-beating performance**.
Realistic timeline: an archive from the website cache alone is sparse (one snapshot per game per 8 hours); a useful closing proxy needs the capture script scheduled before tip-off, and about
3,000 matched props needs weeks of games, not days.
