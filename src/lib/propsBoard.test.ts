import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evText, hitRate, projectionEdge, projectionState, sortCards, toCards } from './propsBoard.ts'
import type { Pick } from './picks.ts'

const pick = (o: Partial<Pick>): Pick => ({
  playerId: 1, player: 'A Player', team: 'BOS', teamName: 'Boston Celtics', stat: 'pts', side: 'over', line: 20.5, price: 1.9, book: 'DraftKings', prices: [], oddsId: null,
  eventId: 'e', marketBooks: 2, modelProb: 0.55, marketProb: 0.5, prob: 0.52, push: 0, impliedProb: 0.526, ev: 0.01, risk: 'balanced', model: 'gbm-v1', bigGap: false,
  projection: 22, hitRate10: null, recent: [25, 18, 22, 30, 15], sample: 40, projectionAgeHours: 3, game: 'A @ B', gameDate: '2026-10-24', ...o,
}) as Pick

test('both sides of a line become one card, led by the side with the higher expected value', () => {
  const cards = toCards([pick({ side: 'over', ev: -0.02 }), pick({ side: 'under', ev: 0.04 }), pick({ line: 21.5, ev: 0.01 })])
  assert.equal(cards.length, 2)
  const c = cards.find((x) => x.lead.line === 20.5)!
  assert.equal(c.lead.side, 'under'); assert.ok(c.over && c.under)
})

test('hit rate counts the lead side only, drops exact ties, and is -1 without history', () => {
  const over = toCards([pick({ recent: [25, 20.5, 18, 30] })])[0]
  assert.equal(hitRate(over), 2 / 3)
  const under = toCards([pick({ side: 'under', recent: [25, 18, 18, 30] })])[0]
  assert.equal(hitRate(under), 0.5)
  assert.equal(hitRate(toCards([pick({ recent: [] })])[0]), -1)
})

test('sorting by hit rate is a different order from sorting by expected value, and neither mutates the input', () => {
  const cards = toCards([
    pick({ playerId: 1, player: 'High EV', ev: 0.09, recent: [10, 10, 10, 25] }),
    pick({ playerId: 2, player: 'High Hit', ev: -0.03, recent: [30, 30, 30, 30] }),
  ])
  const before = cards.map((c) => c.lead.player)
  assert.deepEqual(sortCards(cards, 'ev').map((c) => c.lead.player), ['High EV', 'High Hit'])
  assert.deepEqual(sortCards(cards, 'hit').map((c) => c.lead.player), ['High Hit', 'High EV'])
  assert.deepEqual(cards.map((c) => c.lead.player), before)
})

test('expected value is shown as a signed percentage of stake', () => {
  assert.equal(evText(0.084), '+8.4%'); assert.equal(evText(-0.012), '-1.2%'); assert.equal(evText(0), '0.0%')
})

test('a projection is flagged stale, fallback or missing instead of being shown as if it were fresh', () => {
  assert.equal(projectionState(pick({})), 'ok')
  assert.equal(projectionState(pick({ projectionAgeHours: 30 })), 'stale')
  assert.equal(projectionState(pick({ model: 'baseline-v2' })), 'fallback')
  assert.equal(projectionState(pick({ projection: Number.NaN })), 'missing')
})

test('the projection gap is signed toward the side being bet', () => {
  assert.equal(projectionEdge(pick({ side: 'over', projection: 22, line: 20.5 })), 1.5)
  assert.equal(projectionEdge(pick({ side: 'under', projection: 22, line: 20.5 })), -1.5)
  assert.equal(projectionEdge(pick({ projection: Number.NaN })), null)
})
