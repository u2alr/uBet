# Pre-registration: the minds, version 4 (frozen before the first v4 decision)

Config `minds-v4`, `CHIEF` in `shared/minds.ts`. Not edited after the first v4 decision; a change is `minds-v5`.
Versions 1 to 3 stay in the database as their own records. **Versions are never added together.**

## What this is
Four specialist **personalities** (Safe Sam, Value Val, Longshot Lou, Contrarian Cat) only *propose* candidates. Four
**evidence agents** (Quant, Market, Matchup, Skeptic) are deterministic functions that examine each candidate. One
**Chief** applies a fixed sequence and decides. All of it is code: no agent invents a probability or a payout.
The default output is **no bet**. There are no quotas anywhere, and nothing is topped up.

## The sequence (per candidate)
1. **Eligibility** (data, not judgement): fresh boosted-model projection (<= 24h old), 10+ games of history, 2+ books
   quoting *both* sides, a real minutes role, among the team's top 6 by minutes and 24+ minutes (starters and stars).
2. **Quant**: model probability corrected by the model's *measured* held-out calibration slope (PTS 0.851, REB 0.889,
   AST 0.919, 3PM 0.866, default 0.85; `research/RESULTS.md`), blended with the market (the app's existing 30/70 rule),
   then reduced by 0.5 standard errors with `n = min(40, max(10, games of history))`. All value thresholds use this
   conservative probability. At odds 1.90, a raw 55% (+4.5%) becomes about 51% and is rejected by a +3% floor.
3. **Market**: the price counted is the best, capped at 1.03x the next-best book (a lone outlier is probably stale).
   Vetoes: only one price, best price > 1.15x the runner-up (stale), or a price below the market's own fair value by
   more than 5%. **Line movement is not available** (no stored line history); it is reported as unavailable, not guessed.
4. **Matchup**: minutes trend (+/- 2) and the opponent's tendency (the share of a stat it has allowed over its last 20
   games relative to the league, +/- 4%) each add +1 or -1 in the direction of the bet. It can corroborate or
   contradict; **it never adds probability**, because the boosted model already uses opponent, pace and rest.
   Honest overlap: this is a simpler view of information the model already holds, so it is a check, not independent proof.
5. **Skeptic** vetoes: listed on the injury report; under 15 games; minutes down 4+; model/market gap of 25+ points
   ("no independent validated data resolves it"); recent games that contradict the bet (the last 8+ games average more
   than half a standard deviation on the wrong side of the line). A gap of 15 to 25 points is a **review**: the Chief
   approves it only if the matchup score is +1 or better.
6. **Proposers' own thresholds** (on the conservative numbers): Sam: estimated win chance >= 60% and conservative EV >= 0.
   Val: conservative EV >= +3% and win chance >= 50%. Cat: market rates the side under 50%, model higher by 10+ points,
   conservative EV >= +2%, *and* matchup score >= +1 ("investigate why the market disagrees").
7. **Portfolio**: duplicates merged (a bet two personalities proposed is one bet, credited to both); one bet per player and
   stat; at most 2 per player, 4 per game, 12 a day; at most 65% Unders once there are 6 or more bets. Ranked by
   conservative EV. Caps only remove bets.
8. **Parlays (Longshot Lou)**: legs must individually clear conservative EV +2% and conservative probability 45%, all
   data checks, no whole-number lines, **different games only** (same-game legs are correlated and the product rule does
   not hold). Joint probability is the product of conservative probabilities. The whole parlay needs +10% conservative
   EV, 3 to 5 legs, at most 3 a day. **Parlays are research-only**: tracked and graded, never in the staked portfolio,
   because independence between games is assumed, not validated.

## What is recorded
Every approved bet with its four-part reasoning, conservative probability and EV; every candidate the Chief rejected with
the reason; and **near misses** (a raw edge that the haircut removed; up to 60 a day). Rejections are graded against box
scores afterwards ("what if it had been bet at the price shown"), so each filter can be audited: if the Skeptic's vetoes
mostly *would have won*, the Skeptic is too strict. A day with no bets is recorded as a decision.

## Not validated (stated up front)
- The haircut (0.5 standard errors), the 0.65 Under share, the caps, and every threshold are **starting values chosen by
  reasoning, not tuned on results**. Nothing here has been backtested against sportsbook prices; no historical lines exist.
- The standard-error formula treats history as independent games; it is a rough guide to uncertainty, not a proof.
- Calibration slopes come from one held-out season and four statistics.
- Closing-line value cannot be measured yet (no line history pull).
- Injury status comes from ESPN and can lag; lineup news is not modelled.
- Bets in one game are correlated; the caps limit exposure but do not model it.

## How it will be judged
Forward only, on games not yet played when the decision is frozen. In order: calibration (do conservative and stated
chances match results, by stat and price band), then the audit of rejections, then closing-line value when available, and
ROI last. No verdict on any component below 200 settled bets, and 200 correlated bets are worth far fewer than 200
independent ones. Thresholds are not changed because of a short run of results.
