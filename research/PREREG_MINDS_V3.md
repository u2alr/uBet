# Pre-registration: the minds, version 3 (frozen before the first v3 card)

Config `minds-v3`, in `shared/minds.ts` (`MINDS_V3`). Not edited after the first v3 card; a change is `minds-v4`.
Versions 1 and 2 stay in the database as their own records. **Versions are never added together.**

## What changed from v2, and why

| Change | Why |
|---|---|
| Sam, Val and Cat place up to 5 singles **for each team in each game** (was 5 per mind per day) | Asked for. It also multiplies the evidence: about 100 to 120 bets a day instead of 15, so the 200-bet minimum is reached in 2 to 4 days, not 40. |
| Starters and stars only: a team's **top 6 players by recent minutes**, averaging 24+ minutes (was 18+) with no big minutes drop | Asked for. Starters' minutes are the most predictable, so their props are the least exposed to the thing the model cannot see (role, rotation, blowouts). |
| Doubles and parlays are per day, not per team-game: Sam up to 2 doubles, Val 1 double, Lou 5 parlays | A parlay spans games, so a per-team quota does not apply. |
| Per-game cap of 3 bets removed | It contradicts 5 per team per game. The per-player cap (2 a day) and the all-Under cap (3 per team-game group) stay. |
| Everything else carries over from v2 | Injury list excluded, no model/market gap over 25 points, 2+ books quoting both sides, no negative-EV "safe" bets, Cat takes the side the market rates under 50%. See `PREREG_MINDS_V2.md`. |

## "Easiest to bet"
Read as: the bets most likely to land, from the players whose minutes are most predictable. Safe Sam ranks by win chance
(never below +0% EV); the other minds keep their own ranking but draw only from starters and stars. No mind is given a
looser floor to fill its quota.

## Rules
| Mind | Card |
|---|---|
| Safe Sam | per team-game: up to 5 singles, win chance >= 60% and EV >= 0, likeliest first; plus up to 2 doubles a day (two such legs, different games, each >= 60%) |
| Value Val | per team-game: up to 5 singles, EV >= +3% and win chance >= 50%, best EV first; plus 1 double a day (legs each >= +3%, pair >= +6%) |
| Longshot Lou | up to 5 parlays a day of 3 to 5 legs (each leg >= 38% and price >= 1.6, each leg used once, 6x or more); topped up with 2-leg combos paying 4x or more |
| Contrarian Cat | per team-game: up to 5 singles on the side the market rates under 50% where the model is higher by 10+ points, EV >= +2%, biggest gap first |

## Shared gates (every mind)
Fresh gbm-v1 projection; 10+ games of history; 2+ books quoting both sides; not on the injury list; top 6 on the team by
minutes and 24+ minutes with no drop of 4+; no `bigGap`; model/market gap under 25 points; no whole-number line in a
combo. Flat 1 unit per bet. Combo legs treated as independent.

## What the extra volume does and does not give
- More bets means a faster read on **calibration** (do stated chances match results?), which is the first thing to check.
- Bets within one game are **correlated** (same pace, same blowout risk, same minutes). 100 bets from 14 games are worth
  far fewer than 100 independent bets, so the 200-bet minimum is a floor, not a verdict.
- Profit is still judged last, after calibration and closing-line value (the odds-history pull is not built yet).
- No verdict for any mind below 200 settled bets.

## Known limits, stated up front
The model does not use injuries or minutes (the gates only avoid the players most exposed). Settlement uses box scores.
Starter rank uses minutes, because starts are not stored; a star who comes off the bench still qualifies, and a reserve
who plays starter minutes does too.
