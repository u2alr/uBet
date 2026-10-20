import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIND_IDS, runMinds, sharedPool, type Bet } from './minds.ts'
import type { Pick } from './picks.ts'

let n = 0
/** A pick that passes every shared gate unless a field is overridden. */
const pick = (o: Partial<Pick> = {}): Pick => {
  n++
  return {
    playerId: n, player: `P${n}`, team: 'AAA', teamName: 'Team A', stat: 'pts', side: 'over', line: 20.5 + (n % 7), price: 1.9,
    book: 'DraftKings', prices: [], oddsId: `id${n}`, eventId: `G${n}`, marketBooks: 3, modelProb: 0.6, marketProb: 0.5,
    prob: 0.55, push: 0, impliedProb: 0.526, ev: 0.05, risk: 'medium', model: 'gbm-v1', bigGap: false, projection: 22,
    hitRate10: null, recent: [], sample: 15, projectionAgeHours: 2, game: 'x', gameDate: '2026-10-21',
    injury: null, role: { label: 'Starter', min10: 32, trend: 0, games: 40 }, ...o,
  } as unknown as Pick
}
const of = (bets: Bet[], m: string) => bets.filter((b) => b.mind === m)

/** `players` players on one team in one game, each with `lines` lines; minutes fall from 36 by 1.5 a player. */
function teamGame(eventId: string, team: string, players: number, lines: number, o: Partial<Pick> = {}): Pick[] {
  const out: Pick[] = []
  for (let i = 0; i < players; i++) {
    const id = 10_000 + n * 100 + i
    for (let j = 0; j < lines; j++)
      out.push(pick({ playerId: id, player: `${team}${i}`, eventId, team, line: 10.5 + j, stat: (['pts', 'reb', 'ast', 'fg3m'] as const)[j % 4],
        role: { label: 'Starter', min10: 36 - i * 1.5, trend: 0, games: 40 }, ...o }))
    n++
  }
  return out
}
const strong = { prob: 0.66, ev: 0.12, price: 2.0, modelProb: 0.66, marketProb: 0.45, side: 'over' as const }
const groupOf = (b: Bet) => `${b.legs[0].eventId}|${b.legs[0].team}`

test('shared gates drop weak evidence, shaky roles, injured players and model blind spots', () => {
  const bad: Pick[] = [
    pick({ model: 'baseline-v2' as never }), pick({ marketBooks: 1 }), pick({ sample: 5 }), pick({ prob: NaN }), pick({ team: null }),
    pick({ injury: { status: 'questionable', label: 'Questionable', note: '' } }),
    pick({ role: null }), pick({ role: { label: 'Rotation', min10: 20, trend: 0, games: 30 } }),
    pick({ role: { label: 'Starter', min10: 30, trend: -6, games: 30 } }),
    pick({ bigGap: true }), pick({ modelProb: 0.9, marketProb: 0.6 }),
  ]
  assert.equal(sharedPool([...bad, pick()]).length, 1)
})

test('only starters and stars: a team\'s top 6 by minutes', () => {
  const picks = teamGame('G1', 'AAA', 10, 1, strong)           // players AAA0..AAA9, minutes 36 down to 22.5; 24+ passes for AAA0..AAA8
  const pool = sharedPool(picks)
  assert.deepEqual([...new Set(pool.map((p) => p.player))].sort(), ['AAA0', 'AAA1', 'AAA2', 'AAA3', 'AAA4', 'AAA5'])
  const bets = runMinds(picks, 'd')
  assert.ok(bets.every((b) => b.legs.every((l) => ['AAA0', 'AAA1', 'AAA2', 'AAA3', 'AAA4', 'AAA5'].includes(l.player))))
})

test('there is no random control mind', () => {
  assert.deepEqual([...MIND_IDS], ['sam', 'val', 'lou', 'cat'])
  assert.equal(runMinds(teamGame('G1', 'AAA', 6, 3, strong), 'd').filter((b) => !MIND_IDS.includes(b.mind)).length, 0)
})

test('with a rich pool, Sam, Val and Cat each place 5 singles for every team in every game', () => {
  const picks = [...teamGame('G1', 'AAA', 6, 4, strong), ...teamGame('G1', 'BBB', 6, 4, strong), ...teamGame('G2', 'CCC', 6, 4, strong), ...teamGame('G2', 'DDD', 6, 4, strong)]
  const bets = runMinds(picks, 'd')
  for (const m of ['sam', 'val', 'cat']) {
    const singles = of(bets, m).filter((b) => b.kind === 'single')
    const perGroup = new Map<string, number>()
    for (const b of singles) perGroup.set(groupOf(b), (perGroup.get(groupOf(b)) ?? 0) + 1)
    assert.equal(perGroup.size, 4, `${m}: every team-game is covered`)
    for (const [g, k] of perGroup) assert.equal(k, 5, `${m} ${g}`)
  }
})

test('a team with too few qualifying lines gets fewer than 5 rather than a lowered floor', () => {
  const picks = [...teamGame('G1', 'AAA', 6, 4, strong), ...teamGame('G1', 'BBB', 1, 1, strong)]
  const val = of(runMinds(picks, 'd'), 'val').filter((b) => b.kind === 'single')
  assert.equal(val.filter((b) => groupOf(b) === 'G1|BBB').length, 1)
  assert.equal(val.filter((b) => groupOf(b) === 'G1|AAA').length, 5)
  assert.equal(runMinds([], 'd').length, 0)
})

test('Safe Sam never takes a bet with negative expected value, however likely it is', () => {
  assert.equal(of(runMinds(teamGame('G1', 'AAA', 6, 3, { prob: 0.75, ev: -0.05, price: 1.35 }), 'd'), 'sam').length, 0)
})

test('Safe Sam: every leg is >= 60%, and he adds at most 2 doubles from different games', () => {
  const picks = [...teamGame('G1', 'AAA', 6, 4, { ...strong, prob: 0.68, ev: 0.04, price: 1.6 }), ...teamGame('G2', 'BBB', 6, 4, { ...strong, prob: 0.68, ev: 0.04, price: 1.6 })]
  const sam = of(runMinds(picks, 'd'), 'sam')
  for (const b of sam) for (const l of b.legs) assert.ok(l.prob >= 0.6)
  const dbl = sam.filter((b) => b.kind === 'combo')
  assert.ok(dbl.length >= 1 && dbl.length <= 2)
  for (const b of dbl) assert.equal(new Set(b.legs.map((l) => l.eventId)).size, 2)
})

test('Value Val needs EV and probability; at most one double, clearing the combined-EV bar', () => {
  const picks = [...teamGame('G1', 'AAA', 6, 4, { ...strong, ev: 0.1, prob: 0.58, price: 1.95 }), ...teamGame('G2', 'BBB', 6, 4, { ...strong, ev: 0.1, prob: 0.58, price: 1.95 })]
  const val = of(runMinds(picks, 'd'), 'val')
  assert.ok(val.every((b) => b.ev >= 0.03))
  assert.ok(val.filter((b) => b.kind === 'combo').length <= 1)
  assert.equal(of(runMinds(teamGame('G1', 'AAA', 6, 4, { ...strong, ev: 0.2, prob: 0.45 }), 'd'), 'val').length, 0)
})

test('Longshot Lou builds parlays across games, each leg once, topped up with doubles', () => {
  const picks = ['G1', 'G2', 'G3', 'G4'].flatMap((g, i) => [...teamGame(g, `T${i}a`, 6, 2, { prob: 0.45, price: 2.3, ev: 0.03 }), ...teamGame(g, `T${i}b`, 6, 2, { prob: 0.45, price: 2.3, ev: 0.03 })])
  const lou = of(runMinds(picks, 'd'), 'lou')
  assert.ok(lou.length >= 1 && lou.length <= 5)
  for (const b of lou) { assert.ok(b.odds >= 4 && b.legs.length >= 2 && b.legs.length <= 5); assert.equal(new Set(b.legs.map((l) => l.eventId)).size, b.legs.length) }
  const legs = lou.flatMap((b) => b.legs.map((l) => `${l.playerId}|${l.line}`))
  assert.equal(new Set(legs).size, legs.length, 'no leg is used twice')
})

test('Contrarian Cat takes the side the market rates below 50% when the model is clearly higher', () => {
  const base = { role: { label: 'Starter' as const, min10: 32, trend: 0, games: 40 } }
  const ps = [
    pick({ ...base, eventId: 'G1', team: 'AAA', modelProb: 0.66, marketProb: 0.45, ev: 0.08 }),   // yes
    pick({ ...base, eventId: 'G1', team: 'AAA', modelProb: 0.80, marketProb: 0.55, ev: 0.20 }),   // the market already favours it
    pick({ ...base, eventId: 'G1', team: 'AAA', modelProb: 0.52, marketProb: 0.45, ev: 0.08 }),   // gap too small
    pick({ ...base, eventId: 'G1', team: 'AAA', modelProb: 0.7, marketProb: null, ev: 0.1 }),     // no market to disagree with
  ]
  const cat = of(runMinds(ps, 'd'), 'cat')
  assert.equal(cat.length, 1)
  assert.equal(cat[0].legs[0].modelProb, 0.66)
})

test('a mind never takes both sides of one line, and never stacks one player', () => {
  const same = { playerId: 500, line: 22.5, eventId: 'GX', team: 'AAA', prob: 0.8, ev: 0.2, price: 1.9 }
  const both = [pick({ ...same, side: 'over' }), pick({ ...same, side: 'under' })]
  assert.equal(of(runMinds(both, 'd'), 'sam').filter((b) => b.kind === 'single').length, 1)

  const one = teamGame('G1', 'AAA', 1, 12, { ...strong, ev: 0.15 })      // one star with 12 strong lines
  const val = of(runMinds(one, 'd'), 'val')
  assert.ok(val.length <= 2)
})

test('at most 3 of a team-game\'s 5 bets are all-Under, so one lean cannot decide a card', () => {
  const unders = teamGame('G1', 'AAA', 6, 4, { ...strong, side: 'under' })
  assert.ok(of(runMinds(unders, 'd'), 'val').filter((b) => b.kind === 'single').length <= 3)
  const mixed = [...teamGame('G1', 'AAA', 3, 4, { ...strong, side: 'under' }), ...teamGame('G1', 'AAA', 3, 4, { ...strong, side: 'over', ev: 0.1 })]
  const val = of(runMinds(mixed, 'd'), 'val').filter((b) => b.kind === 'single')
  assert.equal(val.length, 5)
  assert.ok(val.filter((b) => b.legs.every((l) => l.side === 'under')).length <= 3)
})

test('a mind that already has a card today is skipped, so a re-run cannot add bets or rewrite it', () => {
  const picks = [...teamGame('G1', 'AAA', 6, 4, strong), ...teamGame('G2', 'BBB', 6, 4, strong)]
  assert.ok(of(runMinds(picks, 'd'), 'val').length > 0)
  const again = runMinds(picks, 'd', new Set(['val', 'sam']))
  assert.equal(of(again, 'val').length, 0)
  assert.equal(of(again, 'sam').length, 0)
  assert.ok(of(again, 'cat').length > 0)
})

test('bet maths', () => {
  const picks = [...teamGame('G1', 'AAA', 6, 4, { prob: 0.9, ev: 0.3, price: 2.0 }), ...teamGame('G2', 'BBB', 6, 4, { prob: 0.9, ev: 0.3, price: 2.0 })]
  const dbl = of(runMinds(picks, 'd'), 'sam').find((b) => b.kind === 'combo')!
  assert.ok(Math.abs(dbl.odds - 4) < 1e-12 && Math.abs(dbl.prob - 0.81) < 1e-12 && Math.abs(dbl.ev - (0.81 * 4 - 1)) < 1e-12)
})
