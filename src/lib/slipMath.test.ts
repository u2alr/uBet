import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slipTotals } from './slipMath.ts'
import { combine, type Pick } from './picks.ts'
import type { TeamLeg } from '../../shared/teamBets.ts'

const leg = (o: Partial<Pick>): Pick => ({ playerId: 1, stat: 'pts', side: 'over', line: 20.5, price: 2, prob: 0.55, push: 0, game: 'A @ B', ...o }) as Pick
const team = (o: Partial<TeamLeg>): TeamLeg => ({ gameId: 'g1', team: 'BOS', game: 'A @ B', price: 1.5, marketProb: 0.65, ...o }) as TeamLeg

test('prop legs alone are priced exactly as the full slip prices them', () => {
  const legs = [leg({}), leg({ playerId: 2, price: 1.8, prob: 0.6 })]
  assert.deepEqual(slipTotals(legs, []), combine(legs))
})

test('team legs multiply into the odds and use the market chance, not the model', () => {
  const t = slipTotals([leg({ price: 2, prob: 0.55 })], [team({ price: 1.5, marketProb: 0.65 })])
  assert.ok(Math.abs(t.odds - 3) < 1e-9)
  assert.ok(Math.abs(t.prob - 0.55 * 0.65) < 1e-9)
})

test('an empty slip is odds of 1x with nothing at stake', () => {
  const t = slipTotals([], [])
  assert.equal(t.odds, 1); assert.equal(t.prob, 1); assert.equal(t.ev, 0)
})
