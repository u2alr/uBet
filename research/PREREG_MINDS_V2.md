# Pre-registration: the minds, version 2 (frozen before the first v2 card)

Config `minds-v2`, in `shared/minds.ts` (`MINDS_V2`). It is not edited after the first v2 card is made; a change is
`minds-v3`. Version 1 (`PREREG_MINDS.md`, cards of 2026-10-20) stays in the database and the app as its own record:
**v1 and v2 results are never added together**, because the rules differ.

## What changed, and the evidence for each change

| Change | Why |
|---|---|
| Control (random) removed | Asked for. Without it, "beats random" can no longer be tested directly. The replacement benchmark is the market itself: a mind is judged on closing-line value and on whether its stated chances match results. |
| Every mind places 5 bets a day | v1 minds placed 1 to 4. A card that is topped up from the next-best candidates (never below that mind's floors) gives each mind the same sample rate, so the 200-bet bar is reached in 40 days, not 100+. |
| Players the app tags as listed (Questionable, Doubtful, Day-to-day) are excluded | The model ignores injuries (`AUDIT2.md`). v1's biggest model-vs-market gaps (Tatum under 26.5 at model 80% vs market 49%) looked like missing news, not edges. |
| Players with a shaky minutes role are excluded: under 18 average minutes, or minutes down 4+ in the last 5 games versus the 10 before | The model does not use minutes. A role change is the most common reason it is wrong. |
| Picks with a model/market gap of 25 points or more are excluded (the `bigGap` flag) | Same reason: gaps that large are far more often a model blind spot than a market mistake. |
| Safe Sam needs EV >= 0 | v1-style "safe" filters on win chance alone picked bets with negative expected value (1.44x at 67% = -4%). A short price with no edge is just a slow loss. |
| Contrarian Cat takes the side the market rates below 50%, ranked by gap | v1 Cat ranked by size of disagreement, which selected the model's likeliest errors first, and overlapped Value Val. Betting the less-likely side makes it differ from Val by construction. |
| At most 2 bets per player and 3 per game per mind per day | v1 cards stacked the same few players (Castle, Brunson, Drummond appeared in several bets). |
| At most 3 of a mind's 5 bets may be all-Under | 13 of 13 v1 bets were Unders and the model-vs-market chart sat almost entirely above the diagonal: a sign of an Under lean. A card with some Overs keeps one possible bias from deciding the whole result. This is a hedge, not a fix. |

## Rules
| Mind | Card of 5 |
|---|---|
| Safe Sam | 3 singles with win chance >= 60% and EV >= 0 (likeliest first) + 2 doubles of two such legs (different games, each >= 60%), likeliest first |
| Value Val | 4 singles with EV >= +3% and win chance >= 50% (best EV first) + 1 double of two legs with EV >= +3% each and combined EV >= +6% |
| Longshot Lou | up to 5 combos of 3 to 5 legs (each leg >= 38% and price >= 1.6, one leg used once across the card, combined odds >= 6x); if fewer than 5 can be built, topped up with 2-leg combos paying 4x or more |
| Contrarian Cat | 5 singles on the side the market rates below 50% where the model is higher by 10 points or more, EV >= +2%, biggest gap first |

If a class has too few candidates, the card is topped up from the other class of the same mind, then from lower-ranked
candidates that still pass that mind's floors. A mind may place fewer than 5; it never lowers a floor to reach 5.

## Shared gates (every mind)
Fresh gbm-v1 projection; 10+ games of history; 2+ books quoting both sides; not listed injured; minutes role as above;
no `bigGap`; model/market gap under 25 points; no whole-number line inside a combo (a push would change the odds).
Flat 1 unit per bet. Combo legs are treated as independent (stated, not tested).

## How they are judged (unchanged in spirit)
1. Closing-line value (needs the odds-history pull, not built yet).
2. Calibration: do stated chances match results?
3. ROI in units, last.

No verdict for any mind below 200 settled bets. v2 has no random benchmark, so "skill" is claimed only if a mind beats the
market's own prices on closing-line value AND its stated chances are calibrated; profit alone over a few hundred bets is
not enough.

## Known limits, stated up front
- The model does not use injuries or minutes; the gates above only avoid the players most exposed to that.
- Combos assume independent legs.
- Settlement uses box scores; a player with no box score two days on is voided (dropped from a combo).
