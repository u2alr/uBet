# Pre-registration: does the model add information beyond Kalshi's prices?

Written BEFORE any outcome has been matched to a collected Kalshi price. At the time of writing only prices
exist (`collect_kalshi.py`), no results. Do not edit afterwards; a different design needs a new file.

## Design (fixed)

- Data: Kalshi NBA player-prop markets (points, rebounds, assists, threes), collected from the public API into
  `research/data/kalshi.sqlite`. "YES" on a market with `floor_strike` K pays if the stat is MORE than K, which is
  exactly the model's P(over K).
- Open price: the quote in force 180 minutes before the estimated tip-off. Close price: the quote in force 5 minutes
  before tip-off. Tip-off is estimated as `occurrence_datetime` minus 3 hours (Kalshi gives the expected game end).
- A quote only counts if the collector was demonstrably running: a `runs` row within the 20 minutes before the target
  time. Otherwise the prop is dropped.
- Liquid props only: two-sided quote with bid-ask spread of at most 6 cents at BOTH open and close.
- Market probability = midpoint of bid and ask. Model probability = the stored projection's negative-binomial
  P(over K), computed by `research/project.py` BEFORE the game (as of the morning of the game).
- Truth: box scores (`pull_raw.py`), player matched by normalised name and Eastern-time date. A player with no box
  score row (did not play) is excluded rather than counted as a loss.
- Betting policy for closing line value: weights 0.6 market / 0.4 model, minimum edge 3%, bet YES or NO at the OPEN
  price including an assumed taker fee of 7% x p x (1 - p), rounded up to the cent (verify against Kalshi's fee schedule).

## Minimum evidence before any analysis is read

The analysis script refuses to print scores or coefficients until BOTH hold:
- at least **1,500** liquid props with an outcome, and
- those props span at least **30 distinct game dates**.

Until then it prints counts only (`--peek`). This is enforced in code to prevent early looks.

## Hypotheses and pass/fail

**H7 (information).** In `y ~ a + b*logit(Kalshi close) + c*logit(model)`, the 95% week-resampled interval for `c`
lies entirely above 0. PASS only then. Otherwise FAIL, including when the interval straddles 0.

**H8 (closing line value).** The fixed policy above, over at least 300 bets, has mean CLV with a 95% week-resampled
interval entirely above 0 after the assumed fee.

**H9 (calibration of Kalshi itself): reported only.** Calibration slope of the Kalshi close, so we know how much
to trust it as a benchmark.

## Decision rules

- H7 fails: the model does not beat Kalshi's closing price; report that and do not search for a subgroup (a stat,
  a threshold, a team) that "works". Subgroup tables may be shown but cannot change the verdict.
- H7 passes, H8 fails: information exists but costs (spread, fee) eat it. Report sizes honestly.
- H7 and H8 pass: promising, nothing more. Kalshi is a thin market with wide spreads; passing against it does NOT
  show an edge over sportsbooks. It would justify buying the historical sportsbook data for the real test in
  `PREREG_MARKET.md`.

## Known limits (declared in advance)

- Thin markets: median spread is about 10 cents and most contracts trade rarely, so a midpoint is a weak estimate
  of the "true" market probability. Beating a weak benchmark is easy; failing to beat it would be informative.
- Tip-off time is estimated. Snapshots every ~10 minutes cannot pin the closing price exactly.
- Only games Kalshi lists props for are covered, which skews to marquee games and star players.
- Fees are assumed, not read from the API.
