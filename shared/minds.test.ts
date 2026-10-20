import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runMinds, sharedPool, MINDS_V1, type Bet } from './minds.ts'
import type { Pick } from './picks.ts'

let n = 0
const pick = (o: Partial<Pick> = {}): Pick => {
  n++
  return {
    playerId: n, player: `P${n}`, team: 'BOS', teamName: 'Boston Celtics', stat: 'pts', side: 'over', line: 20.5, price: 1.9,
    book: 'DraftKings', prices: [], oddsId: `id${n}`, eventId: `G${n}`, marketBooks: 3, modelProb: 0.6, marketProb: 0.5,
    prob: 0.55, push: 0, impliedProb: 0.526, ev: 0.05, risk: 'medium', model: 'gbm-v1', bigGap: false, projection: 22,
    hitRate10: null, recent: [], sample: 15, projectionAgeHours: 2, game: 'x', gameDate: '2026-10-21', ...o,
  } as unknown as Pick
}
const of = (bets: Bet[], m: string) => bets.filter((b) => b.mind === m)

test('shared gates drop weak evidence', () => {
  const ps = [pick({ model: 'baseline-v2' as never }), pick({ marketBooks: 1 }), pick({ sample: 5 }), pick({ prob: NaN }), pick()]
  assert.equal(sharedPool(ps).length, 1)
})

test('Safe Sam: high-probability singles and one double from different games', () => {
  const ps = [0.8, 0.75, 0.72, 0.7, 0.66, 0.6].map((prob) => pick({ prob }))
  const sam = of(runMinds(ps, 'd'), 'sam')
  assert.equal(sam.filter((b) => b.kind === 'single').length, 3)
  assert.ok(sam.filter((b) => b.kind === 'single').every((b) => b.legs[0].prob >= 0.68))
  const dbl = sam.find((b) => b.kind === 'combo')!
  assert.equal(dbl.legs.length, 2)
  assert.equal(new Set(dbl.legs.map((l) => l.eventId)).size, 2)
})

test('Safe Sam never takes both sides of a line and skips pushy double legs', () => {
  const a = pick({ prob: 0.8, playerId: 1000, line: 22.5 })
  const b = pick({ prob: 0.75, playerId: 1000, line: 22.5, side: 'under' })
  assert.equal(of(runMinds([a, b], 'd'), 'sam').filter((x) => x.kind === 'single').length, 1)
  const pushy = [pick({ prob: 0.8, push: 0.05 }), pick({ prob: 0.8, push: 0.05 })]
  assert.equal(of(runMinds(pushy, 'd'), 'sam').filter((x) => x.kind === 'combo').length, 0)
})

test('Value Val needs EV and probability, doubles only above the combined EV bar', () => {
  const good = [pick({ ev: 0.12, prob: 0.6, price: 1.95 }), pick({ ev: 0.1, prob: 0.6, price: 1.95 })]
  const val = of(runMinds(good, 'd'), 'val')
  assert.equal(val.filter((b) => b.kind === 'single').length, 2)
  assert.equal(val.filter((b) => b.kind === 'combo').length, 1)
  const thin = [pick({ ev: 0.04, prob: 0.53 }), pick({ ev: 0.04, prob: 0.53 })]
  assert.equal(of(runMinds(thin, 'd'), 'val').filter((b) => b.kind === 'combo').length, 0)
  assert.equal(of(runMinds([pick({ ev: 0.2, prob: 0.5 })], 'd'), 'val').length, 0)
})

test('Longshot Lou builds 3-5 leg combos reaching the odds target', () => {
  const ps = Array.from({ length: 12 }, (_, i) => pick({ prob: 0.45, price: 2.2, ev: 0.01 * (i + 1) }))
  const lou = of(runMinds(ps, 'd'), 'lou')
  assert.ok(lou.length >= 1 && lou.length <= 2)
  for (const b of lou) { assert.ok(b.legs.length >= 3 && b.legs.length <= 5); assert.ok(b.odds >= 8) }
  const legs = lou.flatMap((b) => b.legs.map((l) => l.playerId))
  assert.equal(new Set(legs).size, legs.length)
  assert.equal(of(runMinds([pick({ prob: 0.45, price: 2.2 }), pick({ prob: 0.45, price: 2.2 })], 'd'), 'lou').length, 0)
})

test('Contrarian Cat wants a real model-vs-market gap in either direction', () => {
  const ps = [pick({ modelProb: 0.7, marketProb: 0.5, ev: 0.1 }), pick({ modelProb: 0.3, marketProb: 0.45, ev: 0.05, side: 'under' }), pick({ modelProb: 0.55, marketProb: 0.5, ev: 0.1 }), pick({ modelProb: 0.7, marketProb: null, ev: 0.1 })]
  const cat = of(runMinds(ps, 'd'), 'cat')
  assert.equal(cat.length, 2)
  assert.equal(cat[0].legs[0].modelProb, 0.7)
})

test('Control is deterministic per day, differs across days, and caps at 3', () => {
  const ps = Array.from({ length: 20 }, () => pick())
  const ids = (d: string) => of(runMinds(ps, d), 'control').map((b) => b.legs[0].playerId).join()
  assert.equal(ids('2026-10-21'), ids('2026-10-21'))
  assert.notEqual(ids('2026-10-21'), ids('2026-10-22'))
  assert.equal(of(runMinds(ps, 'x'), 'control').length, MINDS_V1.control.singles)
})

test('bet maths and the per-mind daily cap', () => {
  const ps = Array.from({ length: 30 }, () => pick({ prob: 0.9, ev: 0.3, price: 2.0 }))
  const bets = runMinds(ps, 'd')
  for (const m of ['sam', 'val', 'lou', 'cat', 'control']) assert.ok(of(bets, m).length <= MINDS_V1.maxBetsPerDay)
  const dbl = of(bets, 'sam').find((b) => b.kind === 'combo')!
  assert.ok(Math.abs(dbl.odds - 4) < 1e-12 && Math.abs(dbl.prob - 0.81) < 1e-12 && Math.abs(dbl.ev - (0.81 * 4 - 1)) < 1e-12)
  assert.deepEqual(runMinds([], 'd'), [])
})
