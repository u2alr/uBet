// The parlay numbers for a slip. One place, so the full Slip screen and the dock beside the props can never disagree.
import { combineLegs, type Combined, type TeamLeg } from '../../shared/teamBets.ts'
import { combine, type Pick } from './picks.ts'

/**
 * Combined odds, the chance that no leg loses, and expected value. Team (moneyline) legs are priced from the market and combined with the prop legs;
 * their chance is the market's no-margin chance, not a model's.
 */
export function slipTotals(legs: Pick[], teamLegs: TeamLeg[]): Combined {
  if (!teamLegs.length) return combine(legs)
  return combineLegs([...legs.map((l) => ({ price: l.price, prob: l.prob })), ...teamLegs.map((t) => ({ price: t.price, prob: t.marketProb }))])
}
