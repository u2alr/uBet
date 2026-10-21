import { test } from 'node:test'
import assert from 'node:assert/strict'
import { binaryDistribution, binaryExpectedReturn, expectedReturn, payoff, settle, settleOverUnder, settleParlay, validateDistribution } from './payoff.ts'

const near = (a: number, b: number, e = 1e-12) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`)

test('payoff of every settlement outcome', () => {
  near(payoff('win', 1.9), 0.9)
  near(payoff('lose', 1.9), -1)
  near(payoff('push', 1.9), 0)
  near(payoff('void', 1.9), 0)
  near(payoff('half_win', 1.9), 0.45)
  near(payoff('half_loss', 1.9), -0.5)
  for (const bad of [1, 0.5, NaN, Infinity, -2]) assert.throws(() => payoff('win', bad), RangeError)
})

test('binary expected return is p*price - 1, and a refund scales it exactly as the app always did', () => {
  near(binaryExpectedReturn(0.55, 0, 1.9), 0.55 * 1.9 - 1)
  near(binaryExpectedReturn(0.5, 0, 1.9), -0.05)
  near(binaryExpectedReturn(0.55, 0.2, 1.9), 0.8 * (0.55 * 1.9 - 1))
  near(binaryExpectedReturn(0.6, 1, 1.9), 0, 1e-12)
})

test('half-wins, half-losses and voids are priced from their real payoffs, never the binary shortcut', () => {
  const asian = [
    { outcome: 'win' as const, probability: 0.3 }, { outcome: 'half_win' as const, probability: 0.2 },
    { outcome: 'push' as const, probability: 0.1 }, { outcome: 'half_loss' as const, probability: 0.15 }, { outcome: 'lose' as const, probability: 0.25 },
  ]
  near(expectedReturn(2.0, asian), 0.3 * 1 + 0.2 * 0.5 + 0.1 * 0 + 0.15 * -0.5 + 0.25 * -1)
  const withVoid = [{ outcome: 'win' as const, probability: 0.4 }, { outcome: 'void' as const, probability: 0.2 }, { outcome: 'lose' as const, probability: 0.4 }]
  near(expectedReturn(2.5, withVoid), 0.4 * 1.5 - 0.4)
})

test('a distribution that is not a distribution is rejected, not repaired', () => {
  assert.throws(() => validateDistribution([]), RangeError)
  assert.throws(() => validateDistribution([{ outcome: 'win', probability: 0.5 }, { outcome: 'lose', probability: 0.4 }]), /sum/)
  assert.throws(() => validateDistribution([{ outcome: 'win', probability: 1.2 }, { outcome: 'lose', probability: -0.2 }]), RangeError)
  assert.throws(() => validateDistribution([{ outcome: 'win', probability: NaN }, { outcome: 'lose', probability: 1 }]), RangeError)
  assert.throws(() => binaryDistribution(1.1), RangeError)
  assert.throws(() => binaryDistribution(0.5, -0.1), RangeError)
  assert.throws(() => binaryExpectedReturn(0.5, 0, 1), RangeError)
})

test('over/under settlement: a tie on the line is a refund', () => {
  assert.equal(settleOverUnder('over', 24.5, 25), 'win')
  assert.equal(settleOverUnder('over', 24.5, 24), 'lose')
  assert.equal(settleOverUnder('under', 24.5, 24), 'win')
  assert.equal(settleOverUnder('over', 24, 24), 'push')
  assert.equal(settleOverUnder('under', 24, 24), 'push')
  near(settle('win', 1.9, 0.5), 0.45)
  near(settle('push', 1.9, 5), 0)
})

test('parlays: a pushed or voided leg is dropped, a loss loses the stake, halves scale their leg', () => {
  near(settleParlay([{ outcome: 'win', price: 2 }, { outcome: 'win', price: 3 }]), 5)
  near(settleParlay([{ outcome: 'win', price: 2 }, { outcome: 'push', price: 3 }]), 1)
  near(settleParlay([{ outcome: 'void', price: 2 }, { outcome: 'win', price: 1.5 }]), 0.5)
  near(settleParlay([{ outcome: 'win', price: 2 }, { outcome: 'lose', price: 3 }]), -1)
  near(settleParlay([{ outcome: 'half_win', price: 2 }, { outcome: 'win', price: 2 }]), 1.5 * 2 - 1)
  near(settleParlay([{ outcome: 'half_loss', price: 2 }, { outcome: 'win', price: 2 }]), 0.5 * 2 - 1)
  assert.throws(() => settleParlay([]), RangeError)
  assert.throws(() => settleParlay([{ outcome: 'win', price: 1 }]), RangeError)
})
