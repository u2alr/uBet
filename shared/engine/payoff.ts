// Settlement and expected return for ANY outcome distribution, not just win/lose. Pure.
//
// Payoff per 1 unit staked at decimal odds `price`:
//   win        price - 1            lose        -1
//   push       0 (stake returned)   void        0 (stake returned)
//   half_win   (price - 1) / 2      half_loss   -0.5          (half the stake wins or loses, the rest is returned)
// The simple binary formula `p * price - 1` is only correct when win and lose are the only outcomes. Every caller in the
// engine goes through `expectedReturn`, so a market with refunds is never priced as if it had none.

export type SettlementOutcome = 'win' | 'lose' | 'push' | 'void' | 'half_win' | 'half_loss'

export interface Settlement {
  outcome: SettlementOutcome
  /** Probability of this outcome, 0 to 1. */
  probability: number
}

const SUM_TOLERANCE = 1e-9

/** Net profit per 1 unit staked for one settled outcome. */
export function payoff(outcome: SettlementOutcome, price: number): number {
  if (!Number.isFinite(price) || price <= 1) throw new RangeError(`decimal odds must be a finite number above 1, got ${price}`)
  switch (outcome) {
    case 'win': return price - 1
    case 'lose': return -1
    case 'push':
    case 'void': return 0
    case 'half_win': return (price - 1) / 2
    case 'half_loss': return -0.5
  }
}

/** Throws unless the probabilities are each in [0, 1] and sum to 1 (within a tight tolerance). Fail closed. */
export function validateDistribution(dist: Settlement[]): void {
  if (!dist.length) throw new RangeError('empty outcome distribution')
  let sum = 0
  for (const d of dist) {
    if (!Number.isFinite(d.probability) || d.probability < 0 || d.probability > 1) throw new RangeError(`probability out of range for ${d.outcome}: ${d.probability}`)
    sum += d.probability
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) throw new RangeError(`outcome probabilities sum to ${sum}, not 1`)
}

/** Expected net profit per 1 unit staked, as a decimal (0.03 is +3%). */
export function expectedReturn(price: number, dist: Settlement[]): number {
  validateDistribution(dist)
  return dist.reduce((a, d) => a + d.probability * payoff(d.outcome, price), 0)
}

/**
 * The distribution of an over/under bet. `winGivenDecided` is the chance of winning if the bet is decided (what a model
 * that excludes ties reports), and `pushProbability` the chance of a refund (a tie on a whole-number line).
 */
export function binaryDistribution(winGivenDecided: number, pushProbability = 0): Settlement[] {
  if (!(winGivenDecided >= 0 && winGivenDecided <= 1)) throw new RangeError(`win probability out of range: ${winGivenDecided}`)
  if (!(pushProbability >= 0 && pushProbability <= 1)) throw new RangeError(`push probability out of range: ${pushProbability}`)
  const decided = 1 - pushProbability
  return [
    { outcome: 'win', probability: decided * winGivenDecided },
    { outcome: 'lose', probability: decided * (1 - winGivenDecided) },
    { outcome: 'push', probability: pushProbability },
  ]
}

/** Expected return of a plain over/under bet. Equals `(1 - push) * (win * price - 1)`. */
export function binaryExpectedReturn(winGivenDecided: number, pushProbability: number, price: number): number {
  return expectedReturn(price, binaryDistribution(winGivenDecided, pushProbability))
}

/** Net profit of a settled bet: stake times the payoff. Voids and pushes return the stake. */
export function settle(outcome: SettlementOutcome, price: number, stake = 1): number {
  return stake * payoff(outcome, price)
}

/** Settlement of an over/under bet on a final value, with the refund rule: a tie on the line is a push. */
export function settleOverUnder(side: 'over' | 'under', line: number, actual: number): SettlementOutcome {
  if (actual === line) return 'push'
  return (side === 'over' ? actual > line : actual < line) ? 'win' : 'lose'
}

/**
 * A parlay settles as the product of its legs' returns: a win multiplies by the leg price, a push or void drops the leg
 * (multiplies by 1), a loss loses the stake. Half outcomes scale that leg's return. Returns the combined payoff per unit.
 */
export function settleParlay(legs: { outcome: SettlementOutcome; price: number }[]): number {
  if (!legs.length) throw new RangeError('a parlay needs at least one leg')
  let ret = 1
  for (const l of legs) {
    if (!Number.isFinite(l.price) || l.price <= 1) throw new RangeError(`decimal odds must be above 1, got ${l.price}`)
    switch (l.outcome) {
      case 'win': ret *= l.price; break
      case 'lose': return -1
      case 'push': case 'void': break
      case 'half_win': ret *= 1 + (l.price - 1) / 2; break
      case 'half_loss': ret *= 0.5; break
    }
  }
  return ret - 1
}
