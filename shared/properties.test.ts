// Property tests: instead of hand-picked examples, hundreds of seeded random inputs against rules that must ALWAYS hold. A failure prints the seed and the input that broke it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consensusProb, fairProb, median, power, proportional } from './devig.ts'
import { blendProb, MODEL_WEIGHT } from './baseline.ts'
import { fairSpread, teamBet, type BookLine } from './teamBets.ts'
import { buildLineup, nameKey, officialListings, reportState, STARTERS, NEXT_UP, type Candidate, type OfficialRow } from './lineups.ts'

/** mulberry32: a tiny seeded generator, so every run (and every CI machine) sees the same cases. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const CASES = 500
const between = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r()
/** Decimal prices for a two-way market with a bookmaker's margin of 0 to 12%. */
function twoWay(r: () => number): [number, number] {
  const p = between(r, 0.04, 0.96)
  const margin = 1 + between(r, 0, 0.12)
  return [1 / (p * margin), 1 / ((1 - p) * margin)]
}

test('devig: every method gives two probabilities in (0, 1) that add to 1, for any price pair', () => {
  const r = rng(1)
  for (let i = 0; i < CASES; i++) {
    const prices = twoWay(r)
    if (prices.some((x) => x <= 1.0001)) continue
    for (const f of [proportional, power]) {
      const p = f(prices)!
      assert.ok(p, `case ${i} ${prices}`)
      assert.ok(Math.abs(p[0] + p[1] - 1) < 1e-9, `sum ${p} for ${prices}`)
      assert.ok(p.every((x) => x > 0 && x < 1), `range ${p} for ${prices}`)
    }
  }
})

test('devig: swapping the two sides swaps the probabilities, and a shorter price is always the likelier side', () => {
  const r = rng(2)
  for (let i = 0; i < CASES; i++) {
    const [a, b] = twoWay(r)
    if (a <= 1.0001 || b <= 1.0001) continue
    const p = fairProb(a, b, 'power')!, q = fairProb(b, a, 'power')!
    assert.ok(Math.abs(p - (1 - q)) < 1e-9, `symmetry for ${a},${b}`)
    assert.equal(p > 0.5, a < b, `${a} vs ${b} gave ${p}`)
  }
})

test('devig: the power method never gives a favourite less than the proportional method does', () => {
  const r = rng(3)
  for (let i = 0; i < CASES; i++) {
    const prices = twoWay(r)
    if (prices.some((x) => x <= 1.0001)) continue
    const pw = power(prices)!, pr = proportional(prices)!
    const fav = prices[0] < prices[1] ? 0 : 1
    assert.ok(pw[fav] >= pr[fav] - 1e-9, `favourite: power ${pw[fav]} < proportional ${pr[fav]} for ${prices}`)
  }
})

test('consensus: the order of the books does not matter, and one wild book never moves the answer far when three or more agree', () => {
  const r = rng(4)
  for (let i = 0; i < CASES; i++) {
    const centre = between(r, 0.2, 0.8)
    const agree = Array.from({ length: 3 + Math.floor(r() * 4) }, () => centre + between(r, -0.01, 0.01))
    const base = consensusProb(agree)!
    const shuffled = [...agree].sort(() => r() - 0.5)
    assert.ok(Math.abs(consensusProb(shuffled)!.prob - base.prob) < 1e-12, 'order changed the answer')
    const withWild = consensusProb([...agree, Math.min(0.99, Math.max(0.01, centre + (r() < 0.5 ? -0.3 : 0.3)))])!
    assert.ok(Math.abs(withWild.prob - base.prob) < 0.02, `a wild book moved the consensus from ${base.prob} to ${withWild.prob}`)
  }
})

test('median: lies between the smallest and the largest value, and is unchanged by order', () => {
  const r = rng(5)
  for (let i = 0; i < CASES; i++) {
    const xs = Array.from({ length: 1 + Math.floor(r() * 9) }, () => between(r, -20, 20))
    const m = median(xs)!
    assert.ok(m >= Math.min(...xs) - 1e-12 && m <= Math.max(...xs) + 1e-12)
    assert.equal(median([...xs].reverse()), m)
  }
})

test('blend: always between the model and the market, and equal to the market when the model has no weight', () => {
  const r = rng(6)
  for (let i = 0; i < CASES; i++) {
    const model = between(r, 0.02, 0.98), market = between(r, 0.02, 0.98)
    const b = blendProb(model, market)
    assert.ok(b >= Math.min(model, market) - 1e-9 && b <= Math.max(model, market) + 1e-9, `${model}, ${market} -> ${b}`)
    assert.ok(Math.abs(blendProb(model, market, 0) - market) < 1e-9)
  }
  assert.ok(MODEL_WEIGHT > 0 && MODEL_WEIGHT < 1)
})

function randomBooks(r: () => number): BookLine[] {
  const n = 1 + Math.floor(r() * 6)
  const p = between(r, 0.15, 0.85)
  return Array.from({ length: n }, (_, i) => {
    const wobble = between(r, -0.02, 0.02), margin = 1.03 + between(r, 0, 0.05)
    const q = Math.min(0.97, Math.max(0.03, p + wobble))
    const spread = Math.round(between(r, -12, 12) * 2) / 2
    return { key: `b${i}`, title: `Book ${i}`, moneyline: { home: 1 / (q * margin), away: 1 / ((1 - q) * margin) }, spread: { point: spread, home: 1.91, away: 1.91 }, total: { point: 200 + Math.round(between(r, 0, 40) * 2) / 2, over: 1.91, under: 1.91 } }
  })
}

test('team bets: the two sides always add to 1, our fair prices carry no margin, and no side ever shows a price below the best book price it was built from', () => {
  const r = rng(7)
  for (let i = 0; i < CASES; i++) {
    const books = randomBooks(r)
    const model = r() < 0.7 ? between(r, 0.05, 0.95) : null
    const t = teamBet({ home: 'AAA', away: 'BBB', books, modelHomeProb: model })
    const ml = t.moneyline!
    assert.ok(Math.abs(ml.home.prob + ml.away.prob - 1) < 2e-3, `case ${i}: ${ml.home.prob} + ${ml.away.prob}`)
    assert.ok(Math.abs(ml.home.marketProb + ml.away.marketProb - 1) < 2e-3)
    const f = t.ours!.fairMoneyline
    assert.ok(Math.abs(1 / f.home + 1 / f.away - 1) < 0.02, `fair prices carry margin: ${f.home}, ${f.away}`)
    for (const side of ['home', 'away'] as const) {
      const quotes = books.map((b) => b.moneyline![side])
      assert.ok(ml[side].price <= Math.max(...quotes) + 1e-9, 'a price better than any book offers')
      assert.ok(ml[side].price >= Math.min(...quotes) - 1e-9, 'a price worse than every book')
    }
    assert.ok(Number.isInteger(t.market.spread! * 2) && Number.isInteger(t.market.total! * 2), 'a line that is not on a half point')
  }
})

test('team bets: a model that agrees with the market changes nothing, and a stronger model number moves our chance the same way', () => {
  const r = rng(8)
  for (let i = 0; i < CASES; i++) {
    const books = randomBooks(r)
    const base = teamBet({ home: 'AAA', away: 'BBB', books, modelHomeProb: null })
    const same = teamBet({ home: 'AAA', away: 'BBB', books, modelHomeProb: base.market.homeProb })
    assert.ok(Math.abs(same.ours!.homeProb - base.ours!.homeProb) < 2e-3, 'agreeing with the market moved our chance')
    const lo = teamBet({ home: 'AAA', away: 'BBB', books, modelHomeProb: 0.2 }).ours!.homeProb
    const hi = teamBet({ home: 'AAA', away: 'BBB', books, modelHomeProb: 0.8 }).ours!.homeProb
    assert.ok(hi > lo, `a higher model number gave a lower chance: ${lo} vs ${hi}`)
  }
})

test('fair spread: a likelier home win never gives a smaller home line, and the line is always on a half point', () => {
  const r = rng(9)
  for (let i = 0; i < CASES; i++) {
    const ms = Math.round(between(r, -12, 12) * 2) / 2, mp = between(r, 0.15, 0.85)
    const a = between(r, 0.05, 0.9), b = a + between(r, 0.001, 0.05)
    const sa = fairSpread(a, ms, mp), sb = fairSpread(Math.min(b, 0.95), ms, mp)
    assert.ok(sa != null && sb != null)
    assert.ok(sb! <= sa! + 1e-9, `${a} -> ${sa}, ${b} -> ${sb}`)
    assert.ok(Number.isInteger(sa! * 2))
  }
})

const letters = (r: () => number, n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(r() * 26))).join('')
const cap = (w: string) => w[0].toUpperCase() + w.slice(1)
/** Players with letters-only first and last names (so the name key is the whole name), each unique. */
function randomRoster(r: () => number): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  while (out.length < 6 + Math.floor(r() * 10)) {
    const first = cap(letters(r, 4 + Math.floor(r() * 4))), last = cap(letters(r, 5 + Math.floor(r() * 4)))
    if (seen.has(first + last)) continue
    seen.add(first + last)
    out.push({ id: out.length + 1, name: `${first} ${last}`, avgMin: r() < 0.15 ? 0 : Math.round(between(r, 2, 38) * 10) / 10 })
  }
  return out
}
/** The report's spelling of a roster player: "Last,First" with no spaces. */
const rowFor = (c: Candidate, status: string): OfficialRow => {
  const [first, last] = c.name.split(' ')
  return { team: 'AAA', player: `${last},${first}`, status, reason: null, game_date: '2026-11-05', matchup: 'BBB@AAA' }
}

test('lineups: never more than five starters or three next up, nobody with zero minutes, no overlap, and the order of the roster does not change the result', () => {
  const r = rng(10)
  let flagged = 0
  for (let i = 0; i < CASES; i++) {
    const roster = randomRoster(r)
    const statuses = ['Out', 'Doubtful', 'Questionable', 'Probable', 'Available']
    const rows = roster.filter(() => r() < 0.4).map((c) => rowFor(c, statuses[Math.floor(r() * statuses.length)]))
    const mk = (rs: Candidate[]) => buildLineup(rs, officialListings(rows, 'AAA', '2026-11-05', 'BBB@AAA'), reportState(rows, 'AAA', '2026-11-05', 'BBB@AAA'), '2026-11-05 02:15')
    const l = mk(roster)
    flagged += [...l.starters, ...l.nextUp].filter((p) => p.listing).length + l.alsoListed.length
    assert.ok(l.starters.length <= STARTERS && l.nextUp.length <= NEXT_UP)
    const all = [...l.starters, ...l.nextUp]
    assert.ok(all.every((p) => p.avgMin > 0), 'a player with no minutes was shown')
    assert.equal(new Set(all.map((p) => nameKey(p.name))).size, all.length, 'a player appears twice')
    assert.ok(l.starters.every((s) => l.nextUp.every((n) => s.avgMin >= n.avgMin)), 'a bench player out-played a starter')
    assert.ok(l.nextUp.every((p) => !p.listing || !['out', 'doubtful'].includes(p.listing.status)), 'an Out or Doubtful player was named as a replacement')
    const shuffled = mk([...roster].sort(() => r() - 0.5))
    assert.deepEqual(shuffled.starters.map((p) => p.id), l.starters.map((p) => p.id), 'the roster order changed the starters')
  }
  assert.ok(flagged > CASES, `only ${flagged} flags were ever applied: the test is not exercising the report rows`)
})

test('lineups: with any state but listed there are never flags, whatever rows exist', () => {
  const r = rng(11)
  for (let i = 0; i < CASES; i++) {
    const roster = randomRoster(r)
    const rows = roster.map((c) => rowFor(c, 'Out'))
    for (const state of ['clear', 'not_submitted', 'absent'] as const) {
      const l = buildLineup(roster, officialListings(rows, 'AAA', '2026-11-05', 'BBB@AAA'), state, '2026-11-05 02:15')
      assert.ok(![...l.starters, ...l.nextUp].some((p) => p.listing), `${state} showed a flag`)
      assert.equal(l.alsoListed.length, 0)
    }
  }
})
