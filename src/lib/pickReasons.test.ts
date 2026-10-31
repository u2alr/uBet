import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickReasons } from './pickReasons.ts'
import { toCards } from './propsBoard.ts'
import type { Pick } from './picks.ts'

const pick = (o: Partial<Pick>): Pick => ({
  playerId: 1, player: 'A Player', team: 'BOS', teamName: 'Boston Celtics', stat: 'ast', side: 'under', line: 2.5, price: 3, book: 'Bovada', prices: [], oddsId: null,
  eventId: 'e', marketBooks: 2, modelProb: 0.56, marketProb: 0.31, prob: 0.5, push: 0, impliedProb: 0.33, ev: 0.15, risk: 'balanced', model: 'gbm-v1', bigGap: false,
  projection: 2.1, hitRate10: null, recent: [1, 2, 1, 2, 3, 0, 1, 2], sample: 40, projectionAgeHours: 3, game: 'A @ B', gameDate: '2026-10-24', basis: 'legacy', ...o,
}) as Pick

const reasons = (o: Partial<Pick>) => pickReasons(toCards([pick(o)])[0])
const kinds = (o: Partial<Pick>) => Object.fromEntries(reasons(o).map((r) => [r.label, r.kind]))

test('an under is backed by a projection below the line, a model above the market, and recent games that stayed under', () => {
  const r = kinds({ marketProb: 0.46 })
  assert.equal(r['Projection'], 'for'); assert.equal(r['Model vs market'], 'for'); assert.equal(r['Recent form'], 'for')
})

test('the same inputs argue against an over', () => {
  const r = kinds({ side: 'over', modelProb: 0.3, marketProb: 0.5 })
  assert.equal(r['Projection'], 'against'); assert.equal(r['Model vs market'], 'against'); assert.equal(r['Recent form'], 'against')
})

test('rising minutes help an over and hurt an under; small trends are ignored', () => {
  const role = (trend: number) => ({ label: 'Starter', min10: 30, trend, games: 10 }) as Pick['role']
  assert.equal(kinds({ side: 'over', role: role(4) })['Minutes'], 'for')
  assert.equal(kinds({ side: 'under', role: role(4) })['Minutes'], 'against')
  assert.equal(kinds({ role: role(1) })['Minutes'], undefined)
})

test('an opponent that allows more helps an over and hurts an under', () => {
  assert.equal(kinds({ side: 'over', oppFactor: 1.1 })['Opponent'], 'for')
  assert.equal(kinds({ side: 'under', oppFactor: 1.1 })['Opponent'], 'against')
  assert.equal(kinds({ oppFactor: 1.01 })['Opponent'], undefined)
})

test('cautions come last: fallback model, unvalidated blend, injury, big gap, refund chance', () => {
  const rs = reasons({ model: 'baseline-v2', bigGap: true, push: 0.1, line: 2, injury: { status: 'questionable', label: 'Questionable', note: '' } })
  assert.deepEqual(rs.map((r) => r.kind).filter((k) => k === 'caution').length, rs.filter((r) => r.kind === 'caution').length)
  const firstCaution = rs.findIndex((r) => r.kind === 'caution')
  assert.ok(rs.slice(firstCaution).every((r) => r.kind === 'caution'))
  for (const l of ['Model', 'Evidence', 'Injury report', 'Big gap', 'Refund']) assert.ok(rs.some((r) => r.label === l), l)
})

test('a missing market price or a missing projection produces no sentence about it', () => {
  const r = kinds({ marketProb: null, projection: NaN })
  assert.equal(r['Model vs market'], undefined); assert.equal(r['Projection'], undefined)
})

test('a model/market gap of 15 points or more is a caution, never support', () => {
  assert.equal(kinds({ modelProb: 0.56, marketProb: 0.31 })['Model vs market'], 'caution')
  assert.equal(kinds({ modelProb: 0.56, marketProb: 0.46 })['Model vs market'], 'for')
})
