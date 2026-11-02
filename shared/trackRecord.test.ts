import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackRecord, type GradedPrediction } from './trackRecord.ts'

const row = (o: Partial<GradedPrediction>): GradedPrediction => ({ stat: 'pts', side: 'over', price: 2, hit: 1, prob: 0.6, modelProb: 0.6, marketProb: 0.5, basis: 'authoritative', ...o })

test('units, hit rate and yield come from the graded rows, with a refund counted as neither a win nor a loss', () => {
  const t = trackRecord([row({ hit: 1, price: 2 }), row({ hit: 0 }), row({ hit: 2 }), row({ hit: 1, price: 1.5 })])
  assert.equal(t.overall.wins, 2)
  assert.equal(t.overall.losses, 1)
  assert.equal(t.overall.pushes, 1)
  assert.equal(t.overall.units, 1 + -1 + 0 + 0.5)
  assert.equal(t.overall.hitRate, 2 / 3)
})

test('rows are split by stat, basis and odds band', () => {
  const t = trackRecord([row({ stat: 'pts', price: 1.6 }), row({ stat: 'reb', price: 2.6, basis: 'legacy' }), row({ stat: 'reb', price: 2.1 })])
  assert.deepEqual(Object.keys(t.byStat).sort(), ['pts', 'reb'])
  assert.equal(t.byStat.reb.n, 2)
  assert.equal(t.byBasis.legacy.n, 1)
  assert.deepEqual(Object.keys(t.byOdds).sort(), ['2.00 to 2.49', '2.50 and up', 'under 1.70'])
})

test('the model, the market and the stated chance are scored on the same bets, so they can be compared', () => {
  const t = trackRecord([
    row({ hit: 1, prob: 0.7, modelProb: 0.8, marketProb: 0.5 }),
    row({ hit: 0, prob: 0.6, modelProb: 0.6, marketProb: 0.5 }),
    row({ hit: 1, prob: 0.6, modelProb: null, marketProb: null }),
    row({ hit: 2, prob: 0.6, modelProb: 0.6, marketProb: 0.5 }),
  ])
  assert.equal(t.brier.n, 2, 'a refund and a row with no market chance are left out')
  assert.ok(Math.abs(t.brier.model! - ((0.2) ** 2 + 0.6 ** 2) / 2) < 1e-12)
  assert.ok(Math.abs(t.brier.market! - 0.25) < 1e-12)
})

test('no graded rows gives empty figures, not errors', () => {
  const t = trackRecord([])
  assert.equal(t.overall.n, 0)
  assert.equal(t.overall.hitRate, null)
  assert.equal(t.brier.n, 0)
  assert.equal(t.brier.model, null)
})
