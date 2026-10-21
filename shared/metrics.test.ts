import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adjustedAlpha, breakdown, calibrationBins, holdoutSplit, summarize, wilson, type Graded } from './metrics.ts'

const g = (result: Graded['result'], odds = 2, prob = 0.5, extra: Partial<Graded> = {}): Graded => ({ odds, prob, result, stake: 1, ...extra })

test('units, yield, hit rate and pushes follow settlement rules', () => {
  const s = summarize([g('won', 2), g('lost'), g('push'), g('void'), g('won', 1.5)])
  assert.equal(s.settled, 4); assert.equal(s.pushes, 1)
  assert.equal(s.units, 1 - 1 + 0 + 0.5)
  assert.equal(s.staked, 4)
  assert.equal(s.yield, 0.5 / 4)
  assert.equal(s.hitRate, 2 / 3)
})

test('Brier and log loss are exact on a small case, and null with no decided bets', () => {
  const s = summarize([g('won', 2, 0.8), g('lost', 2, 0.8)])
  assert.ok(Math.abs(s.brier! - (0.04 + 0.64) / 2) < 1e-12)
  assert.ok(Math.abs(s.logLoss! - (-Math.log(0.8) - Math.log(0.2)) / 2) < 1e-12)
  const e = summarize([g('push'), g('void')])
  assert.equal(e.brier, null); assert.equal(e.hitRate, null); assert.equal(e.hitRateCI, null)
})

test('CLV is null when no closing odds exist, never guessed', () => {
  const none = summarize([g('won'), g('lost')])
  assert.equal(none.clv, null); assert.equal(none.clvN, 0)
  const some = summarize([g('won', 2, 0.5, { closingOdds: 1.9 }), g('lost', 2, 0.5)])
  assert.equal(some.clvN, 1)
  assert.ok(Math.abs(some.clv! - (2 / 1.9 - 1)) < 1e-12)
})

test('intervals are wide for small samples and reproducible', () => {
  const [lo, hi] = wilson(3, 5)!
  assert.ok(lo < 0.3 && hi > 0.85, `${lo} ${hi}`)
  const bets = Array.from({ length: 30 }, (_, i) => g(i % 2 ? 'won' : 'lost'))
  const a = summarize(bets), b = summarize(bets)
  assert.deepEqual(a.yieldCI, b.yieldCI)
  assert.ok(a.yieldCI![0] < 0 && a.yieldCI![1] > 0, 'thirty bets cannot rule out zero edge')
})

test('calibration bins, breakdowns and the holdout split', () => {
  const bins = calibrationBins([g('won', 2, 0.65), g('lost', 2, 0.65), g('won', 2, 0.45)])
  assert.equal(bins.find((b) => b.lo === 0.6)!.n, 2)
  assert.equal(bins.find((b) => b.lo === 0.6)!.observed, 0.5)
  const by = breakdown([g('won', 1.5), g('lost', 3)], (x) => (x.odds < 2 ? 'short' : 'long'))
  assert.deepEqual(Object.keys(by), ['long', 'short'])
  const sp = holdoutSplit([{ day: '2026-01-01' }, { day: '2026-02-01' }], '2026-02-01')
  assert.equal(sp.development.length, 1); assert.equal(sp.holdout.length, 1)
  assert.equal(adjustedAlpha(0.05, 10), 0.005)
})
