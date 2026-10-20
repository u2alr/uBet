import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIND_IDS, MINDS_V2, runMinds, sharedPool, type Bet } from './minds.ts'
import type { Pick } from './picks.ts'

let n = 0
/** A pick that passes every shared gate unless a field is overridden. Each call is a new player in a new game. */
const pick = (o: Partial<Pick> = {}): Pick => {
  n++
  return {
    playerId: n, player: `P${n}`, team: 'BOS', teamName: 'Boston Celtics', stat: 'pts', side: 'over', line: 20.5, price: 1.9,
    book: 'DraftKings', prices: [], oddsId: `id${n}`, eventId: `G${n}`, marketBooks: 3, modelProb: 0.6, marketProb: 0.5,
    prob: 0.55, push: 0, impliedProb: 0.526, ev: 0.05, risk: 'medium', model: 'gbm-v1', bigGap: false, projection: 22,
    hitRate10: null, recent: [], sample: 15, projectionAgeHours: 2, game: 'x', gameDate: '2026-10-21',
    injury: null, role: { label: 'Starter', min10: 30, trend: 0, games: 40 }, ...o,
  } as unknown as Pick
}
const of = (bets: Bet[], m: string) => bets.filter((b) => b.mind === m)
const many = (k: number, o: Partial<Pick> = {}) => Array.from({ length: k }, () => pick(o))

test('shared gates drop weak evidence, shaky roles, injured players and model blind spots', () => {
  const bad: Pick[] = [
    pick({ model: 'baseline-v2' as never }), pick({ marketBooks: 1 }), pick({ sample: 5 }), pick({ prob: NaN }),
    pick({ injury: { status: 'questionable', label: 'Questionable', note: '' } }),
    pick({ role: null }), pick({ role: { label: 'Bench', min10: 12, trend: 0, games: 30 } }),
    pick({ role: { label: 'Starter', min10: 30, trend: -6, games: 30 } }),
    pick({ bigGap: true }), pick({ modelProb: 0.9, marketProb: 0.6 }),
  ]
  assert.equal(sharedPool([...bad, pick()]).length, 1)
})

test('there is no random control mind any more', () => {
  assert.deepEqual([...MIND_IDS], ['sam', 'val', 'lou', 'cat'])
  const bets = runMinds(many(40, { prob: 0.7, ev: 0.2, price: 2, modelProb: 0.7, marketProb: 0.45 }), 'd')
  assert.equal(bets.filter((b) => !MIND_IDS.includes(b.mind)).length, 0)
})

test('with a rich pool, every mind places exactly 5 bets', () => {
  const bets = runMinds(many(60, { prob: 0.66, ev: 0.12, price: 2.0, modelProb: 0.66, marketProb: 0.45, side: 'over' }), 'd')
  for (const m of MIND_IDS) assert.equal(of(bets, m).length, MINDS_V2.betsPerDay, m)
})

test('a thin pool gives fewer than 5 rather than lowering a floor', () => {
  const bets = runMinds(many(3, { prob: 0.7, ev: 0.1, price: 1.5 }), 'd')
  assert.ok(of(bets, 'sam').length <= 4)            // three singles and the one pair they can make
  assert.equal(of(bets, 'lou').length, 0)
  assert.equal(runMinds([], 'd').length, 0)
})

test('Safe Sam never takes a bet with negative expected value, however likely it is', () => {
  const ps = many(10, { prob: 0.75, ev: -0.05, price: 1.35 })
  assert.equal(of(runMinds(ps, 'd'), 'sam').length, 0)
})

test('Safe Sam: singles first, then doubles from different games, every leg >= 60%', () => {
  const sam = of(runMinds(many(30, { prob: 0.68, ev: 0.04, price: 1.6 }), 'd'), 'sam')
  assert.equal(sam.filter((b) => b.kind === 'single').length, MINDS_V2.sam.singles)
  const dbl = sam.filter((b) => b.kind === 'combo')
  assert.equal(dbl.length, MINDS_V2.sam.doubles)
  for (const b of dbl) assert.equal(new Set(b.legs.map((l) => l.eventId)).size, 2)
  for (const b of sam) for (const l of b.legs) assert.ok(l.prob >= 0.6)
})

test('Value Val needs EV and probability; its double clears the combined-EV bar', () => {
  const val = of(runMinds(many(30, { ev: 0.1, prob: 0.58, price: 1.95 }), 'd'), 'val')
  assert.equal(val.filter((b) => b.kind === 'single').length, MINDS_V2.val.singles)
  assert.equal(val.filter((b) => b.kind === 'combo').length, 1)
  assert.ok(val.every((b) => b.ev >= 0.03))
  assert.equal(of(runMinds(many(20, { ev: 0.2, prob: 0.45 }), 'd'), 'val').length, 0)
})

test('Longshot Lou builds 3-5 leg combos reaching the odds target, each leg once, topped up with doubles', () => {
  const lou = of(runMinds(many(16, { prob: 0.45, price: 2.3, ev: 0.03 }), 'd'), 'lou')
  assert.ok(lou.length >= 1)
  for (const b of lou) assert.ok(b.odds >= 4 && b.legs.length >= 2 && b.legs.length <= 5)
  assert.ok(lou.filter((b) => b.legs.length >= 3).every((b) => b.odds >= MINDS_V2.lou.minOdds))
  const legs = lou.flatMap((b) => b.legs.map((l) => l.playerId))
  assert.equal(new Set(legs).size, legs.length, 'no player appears in two combos here')
  assert.equal(of(runMinds([pick({ prob: 0.45, price: 2.2 }), pick({ prob: 0.45, price: 2.2 })], 'd'), 'lou').length, 1) // only a double is possible
})

test('Contrarian Cat takes the side the market rates below 50% when the model is clearly higher', () => {
  const ps = [
    pick({ modelProb: 0.66, marketProb: 0.45, ev: 0.08 }),        // yes
    pick({ modelProb: 0.80, marketProb: 0.55, ev: 0.20 }),        // market already favours it
    pick({ modelProb: 0.52, marketProb: 0.45, ev: 0.08 }),        // gap too small
    pick({ modelProb: 0.7, marketProb: null, ev: 0.1 }),          // no market to disagree with
  ]
  const cat = of(runMinds(ps, 'd'), 'cat')
  assert.equal(cat.length, 1)
  assert.equal(cat[0].legs[0].modelProb, 0.66)
})

test('a mind never takes both sides of one line, and never stacks one player or one game', () => {
  const same = { playerId: 500, line: 22.5, eventId: 'GX', prob: 0.8, ev: 0.2, price: 1.9 }
  const both = [pick({ ...same, side: 'over' }), pick({ ...same, side: 'under' })]
  assert.equal(of(runMinds(both, 'd'), 'sam').filter((b) => b.kind === 'single').length, 1)

  // 12 strong lines from only 2 players: no more than 2 bets each
  const stacked = Array.from({ length: 12 }, (_, i) => pick({ playerId: 700 + (i % 2), line: 10 + i, eventId: `S${i}`, prob: 0.7, ev: 0.15, price: 1.9, modelProb: 0.7, marketProb: 0.45 }))
  const val = of(runMinds(stacked, 'd'), 'val')
  const per = new Map<number, number>()
  for (const b of val) for (const l of b.legs) per.set(l.playerId, (per.get(l.playerId) ?? 0) + 1)
  for (const k of per.values()) assert.ok(k <= MINDS_V2.maxBetsPerPlayer)

  // 12 strong lines in one game: no more than 3 bets
  const oneGame = Array.from({ length: 12 }, (_, i) => pick({ eventId: 'ONE', prob: 0.7, ev: 0.15, price: 1.9, line: 10 + i }))
  assert.ok(of(runMinds(oneGame, 'd'), 'val').length <= MINDS_V2.maxBetsPerGame)
})

test('at most 3 of a mind\'s bets are all-Under, so one lean cannot decide a whole card', () => {
  const unders = many(30, { side: 'under', prob: 0.7, ev: 0.15, price: 1.9 })
  const sam = of(runMinds(unders, 'd'), 'sam')
  assert.ok(sam.length <= MINDS_V2.maxAllUnder)
  const mixed = [...many(10, { side: 'under', prob: 0.7, ev: 0.15, price: 1.9 }), ...many(10, { side: 'over', prob: 0.69, ev: 0.14, price: 1.9 })]
  const val = of(runMinds(mixed, 'd'), 'val')
  assert.equal(val.length, MINDS_V2.betsPerDay)
  assert.ok(val.filter((b) => b.legs.every((l) => l.side === 'under')).length <= MINDS_V2.maxAllUnder)
})

test('a mind that already has a card today is skipped, so a re-run cannot exceed the cap or rewrite it', () => {
  const ps = many(60, { prob: 0.7, ev: 0.15, price: 2.0, modelProb: 0.66, marketProb: 0.45 })
  assert.ok(of(runMinds(ps, 'd'), 'val').length > 0)
  const again = runMinds(ps, 'd', new Set(['val', 'sam']))
  assert.equal(of(again, 'val').length, 0)
  assert.equal(of(again, 'sam').length, 0)
  assert.ok(of(again, 'cat').length > 0)
})

test('bet maths', () => {
  const dbl = of(runMinds(many(30, { prob: 0.9, ev: 0.3, price: 2.0 }), 'd'), 'sam').find((b) => b.kind === 'combo')!
  assert.ok(Math.abs(dbl.odds - 4) < 1e-12 && Math.abs(dbl.prob - 0.81) < 1e-12 && Math.abs(dbl.ev - (0.81 * 4 - 1)) < 1e-12)
})
