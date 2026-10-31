import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evText, hitRate, projectionEdge, projectionState, capPerTeam, groupConsecutive, shortName, sortCards, toCards, topPicks } from './propsBoard.ts'
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

import { favorite, normAbbr } from './propsBoard.ts'

test('ESPN team codes are mapped to the codes the rest of the app uses', () => {
  assert.deepEqual(['UTAH', 'GS', 'NY', 'NO', 'SA', 'WSH', 'BOS'].map(normAbbr), ['UTA', 'GSW', 'NYK', 'NOP', 'SAS', 'WAS', 'BOS'])
})

test('the favourite is the side the market gives over 50%, with the spread shown from its side; no odds means no favourite', () => {
  const g = (p: number | null, spread = 6) => ({ home: { abbr: 'UTAH' }, away: { abbr: 'LAL' }, odds: p == null ? null : { spread, total: 236.5, homeWinProb: p } })
  const away = favorite(g(0.326))!
  assert.deepEqual([away.abbr, away.spread, away.tossUp], ['LAL', -6, false]); assert.ok(Math.abs(away.prob - 0.674) < 1e-9)
  const home = favorite(g(0.72, -7.5))!
  assert.deepEqual([home.abbr, home.spread], ['UTA', -7.5])
  assert.equal(favorite(g(0.5004))!.tossUp, true)
  assert.equal(favorite(g(null)), null)
  assert.equal(favorite({ home: { abbr: 'A' }, away: { abbr: 'B' }, odds: { spread: null, total: null, homeWinProb: null } }), null)
})

test('top picks keep only validated positive-EV leads with enough evidence, best first, one per player', () => {
  const a = (o: Partial<Pick>) => pick({ basis: 'authoritative', auth: { evidence: 'sufficient' }, ...o } as Partial<Pick>)
  const cards = toCards([
    a({ playerId: 1, player: 'Best', ev: 0.12 }),
    a({ playerId: 1, player: 'Best', stat: 'reb', ev: 0.1 }),
    a({ playerId: 2, player: 'Second', ev: 0.05 }),
    a({ playerId: 3, player: 'Negative', ev: -0.01 }),
    a({ playerId: 4, player: 'Thin', ev: 0.3, auth: { evidence: 'insufficient' } } as Partial<Pick>),
    pick({ playerId: 5, player: 'Unvalidated', ev: 0.4, basis: 'legacy' } as Partial<Pick>),
  ])
  const top = topPicks(cards)
  assert.deepEqual(top.picks.map((c) => c.lead.player), ['Best', 'Second']); assert.equal(top.validated, true)
  assert.equal(topPicks(cards, 1).picks.length, 1)
})

test('top picks fall back to unvalidated estimates, flagged, only when nothing validated qualifies', () => {
  const cards = toCards([pick({ playerId: 5, player: 'Blend', ev: 0.2, basis: 'legacy' } as Partial<Pick>), pick({ playerId: 6, player: 'Neg', ev: -0.1, basis: 'legacy' } as Partial<Pick>)])
  const top = topPicks(cards)
  assert.deepEqual(top.picks.map((c) => c.lead.player), ['Blend']); assert.equal(top.validated, false)
})

test('the per-team cap keeps the likeliest leads of each team, leaves other teams alone, and keeps the input order', () => {
  const mk = (id: number, team: string, prob: number) => pick({ playerId: id, player: `P${id}`, team, prob, line: 10 + id })
  const cards = toCards([mk(1, 'BOS', 0.4), mk(2, 'BOS', 0.7), mk(3, 'BOS', 0.55), mk(4, 'NYK', 0.3), mk(5, 'BOS', 0.6)])
  const kept = capPerTeam(cards, 2).map((c) => c.lead.player)
  assert.deepEqual(kept, ['P2', 'P4', 'P5'])
  assert.equal(capPerTeam(cards, 10).length, cards.length)
})

test('neighbouring games with the same tip time form one group, in order, and a later repeat starts a new one', () => {
  const g = groupConsecutive(['a:1', 'b:1', 'c:2', 'd:1'], (x) => x.split(':')[1])
  assert.deepEqual(g.map((x) => [x.key, x.items]), [['1', ['a:1', 'b:1']], ['2', ['c:2']], ['1', ['d:1']]])
  assert.deepEqual(groupConsecutive([], (x: string) => x), [])
})

test('player names shorten to an initial and the surname, keeping suffixes', () => {
  assert.equal(shortName('Scoot Henderson'), 'S. Henderson')
  assert.equal(shortName('Jaren Jackson Jr.'), 'J. Jackson Jr.')
  assert.equal(shortName('Nene'), 'Nene')
})
