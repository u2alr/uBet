# Pre-registration: the minds (frozen before the first card)

Config version `minds-v1`. Thresholds live in `shared/minds.ts` (`MINDS_V1`) and are not edited after the first card
is generated. A change means a new version (`minds-v2`) with its own record; v1 results stay as they were.

## What a mind is
A rule-based picker. It reads today's picks (built by `buildPicks`, selection `all`) and chooses bets. It has no model of
its own and no learning. Stake is a flat 1 unit per bet. Passing is allowed. At most 5 bets per mind per day, at most
5 legs per combo.

## Shared gates (every mind)
- gbm-v1 projection (fresh, <36h), at least 10 games of history, odds not blocked by age.
- At least 2 books quoting both sides of the line (market probability exists).
- No pick on a whole-number line inside a combo (a push would change the odds after the card is frozen).
- Combo legs come from different games and different players. Legs are independent by assumption (stated, not tested).

## Rules
| Mind | Bets |
|---|---|
| Safe Sam | up to 3 singles with prob >= 0.68, plus 1 double of two legs each >= 0.65 |
| Value Val | up to 3 singles with EV >= +4% and prob >= 0.52, plus a double of the top two such legs if combined EV >= +8% |
| Longshot Lou | up to 2 combos of 3-5 legs; each leg prob >= 0.40 and price >= 1.8; combined odds >= 8 |
| Contrarian Cat | up to 3 singles where abs(model - market) >= 0.10 and EV >= +3% |
| Control | 3 random singles from the shared-gate pool (seeded by date). The benchmark: a mind that cannot beat it has no skill |

Ranking inside a mind: Sam by prob, Val and Lou by EV, Cat by gap size.

## How they are judged
1. Closing line value (did the price we took beat the close?), because it needs far fewer bets than profit.
2. Calibration: stated probability vs actual hit rate.
3. ROI in units, last.

No conclusion is drawn from a mind with fewer than 200 settled bets. Before that the app shows "n of 200" and no verdict.
A mind "beats Control" only if its ROI is higher AND its CLV is higher over the same period; one without the other is
reported as unproven.

## Settlement
Leg win/loss from box scores. A push on a single refunds the stake; a push on a combo leg drops the leg (odds recomputed).
Void if no result exists after 2 days although box scores for that date are present.
