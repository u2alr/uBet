# Pre-registration: the minds, version 5 (frozen before the first v5 decision)

Config `minds-v5`, `CHIEF` in `shared/minds.ts`. Everything in `PREREG_MINDS_V4.md` still holds. Version 4 produced no bets on
its one day, so nothing was lost by starting a new record.

## What changes: a second tier, "leans"
Version 4's strict tier turned down every candidate on its first day: at the same time only 86 of 6,500 lines had a
two-sided market, a starter or star, and no veto, and only 8 of those showed any raw model edge. A system that rarely
produces a bet cannot be played or evaluated, so version 5 adds a lesser tier. **It does not loosen the strict tier.**

| | Strict (unchanged) | Lean (new) |
|---|---|---|
| Probability used | conservative (haircut) | the point estimate (no haircut) |
| Needs | conservative EV >= +3% (Val), win chance >= 60% and EV >= 0 (Sam), or Cat's gap rules | raw EV >= +2% **and** win chance >= 50% |
| Vetoes | all | **all the same** (injury, thin history, falling minutes, gaps of 25+, contradicting form, stale or lone price, rich price, unresolved review, matchup contradicted) |
| Stake | 1 unit | **0.5 unit** |
| Caps | 2 per player, 4 per game, 12 a day, <= 65% Unders | **one bet per player in all** (a strict bet on him rules out a lean), the same per-game cap, <= 65% Unders over strict + leans together, **at most 8 a day** |
| Record | its own | **its own**: never added to the strict record |

A lean is exactly "the model sees an edge, but not one that survives the uncertainty haircut". It is credited to the personalities
whose point-estimate thresholds it meets, and to Value Val if none. Longshot payouts do not qualify: raw EV can be huge on a
2.6 price at 46%, but the 50% win-chance floor keeps leans from being longshots.

## What this does and does not claim
- Leans are **weaker evidence by construction**. They are the bets the strict tier declined. Whether they are worth playing is
  an empirical question the separate record will answer, and it may answer no.
- The stake of 0.5 unit is a convention to limit damage while the question is open, not a proven size. The unit itself must be
  small enough that a long losing run is survivable.
- A positive expected value from the model is not a real edge until calibration, the graded rejections and, when available,
  closing-line value say so. Nothing here has been tested against sportsbook prices.
- Today's two-sided lines are a small part of the market: lines quoted on one side only cannot be compared with a margin-free
  market price, so they are not eligible at all.

## How it will be judged
Forward only. Strict and lean tiers are compared on calibration first, then closing-line value, then ROI, each separately.
If leans are not better than their stated chances or the strict tier on those measures after 200 settled bets, the tier is
removed in `minds-v6`. No threshold is changed because of a short run of results.
