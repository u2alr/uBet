// Run: npm test
// Tests the pure pick builder with hand-made inputs, so every number a user sees can be reproduced here.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { blendProb, expectedValue, nbPOver, outcomeProbs, MODEL_WEIGHT } from './baseline.ts'
import {
  buildPicks, devigPair, etDate, normName,
  type BuildInput, type HistoryRow, type OddsEvent, type PlayerRow, type ProjectionRow,
} from './picks.ts'

// ---- builders ----
const NOW = Date.parse('2026-10-20T15:00:00Z')
const TIP = '2026-10-21T00:30:00Z' // 8:30pm Eastern on 2026-10-20
const DATE = etDate(TIP)
const stamp = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString().slice(0, 19).replace('T', ' ')

const player = (id: number, name: string, team: string | null = 'BOS'): PlayerRow => ({ id, name, team })
const history = (id: number, vals: number[], stat: 'pts' | 'reb' | 'ast' | 'fg3m' = 'pts'): HistoryRow[] =>
  vals.map((v) => ({ player_id: id, type: 'regular' as const, pts: 0, reb: 0, ast: 0, fg3m: 0, [stat]: v }))
const projection = (id: number, stat: string, mean: number, alpha: number, hoursAgo = 3, extra: Partial<ProjectionRow> = {}): ProjectionRow =>
  ({ player_id: id, game_date: DATE, stat, mean, alpha, model: 'gbm-v1', created_at: stamp(hoursAgo), ...extra })

function market(name: string, line: number, quotes: { book: string; over?: number; under?: number }[], key = 'player_points') {
  return quotes.map((q) => ({
    key: q.book.toLowerCase(), title: q.book,
    markets: [{ key, outcomes: [
      ...(q.over ? [{ name: 'Over', description: name, price: q.over, point: line }] : []),
      ...(q.under ? [{ name: 'Under', description: name, price: q.under, point: line }] : []),
    ] }],
  }))
}
const event = (bookmakers: ReturnType<typeof market>, id = 'e1'): OddsEvent =>
  ({ id, commence_time: TIP, home_team: 'Detroit Pistons', away_team: 'Boston Celtics', bookmakers })

const vals = [24, 27, 22, 30, 19, 25, 28, 21, 26, 23, 29, 20, 24, 27, 25]
const base = (over: Partial<BuildInput> = {}): BuildInput => ({
  events: [event(market('Jaylen Brown', 24.5, [{ book: 'DraftKings', over: 1.9, under: 1.9 }, { book: 'FanDuel', over: 1.95, under: 1.85 }]))],
  players: [player(7, 'Jaylen Brown')],
  history: history(7, vals),
  projections: [],
  now: NOW,
  selection: 'all',
  ...over,
})
const find = (r: ReturnType<typeof buildPicks>, side: 'over' | 'under') => r.picks.find((p) => p.side === side)

describe('a half-point line, fully reproduced by hand', () => {
  const fresh = base({ projections: [projection(7, 'pts', 24.8, 0.08)] })
  const r = buildPicks(fresh)
  const over = find(r, 'over')!
  const under = find(r, 'under')!

  it('uses the stored projection with a negative-binomial tail', () => {
    assert.equal(over.model, 'gbm-v1')
    assert.ok(Math.abs(over.projection - 24.8) < 1e-12)
    assert.ok(Math.abs(over.modelProb - nbPOver(24.5, 24.8, 0.08)) < 1e-12)
    assert.equal(over.push, 0)
    assert.ok(over.projectionAgeHours !== null && Math.abs(over.projectionAgeHours - 3) < 1e-9)
  })
  it('market probability is the margin-free average of the books that quote both sides', () => {
    const want = (devigPair(1.9, 1.9) + devigPair(1.95, 1.85)) / 2
    assert.ok(Math.abs(over.marketProb! - want) < 1e-12)
    assert.ok(Math.abs(under.marketProb! - (1 - want)) < 1e-12)
  })
  it('blend, price and expected value follow the documented formulas', () => {
    assert.ok(Math.abs(over.prob - blendProb(over.modelProb, over.marketProb)) < 1e-12)
    assert.equal(over.price, 1.95) // best price across books
    assert.equal(over.book, 'FanDuel')
    assert.ok(Math.abs(over.ev - (over.prob * 1.95 - 1)) < 1e-12)
    assert.ok(Math.abs(over.impliedProb - 1 / 1.95) < 1e-12)
  })
  it('over and under are complementary on a half-point line', () => {
    assert.ok(Math.abs(over.prob + under.prob - 1) < 1e-12)
    assert.ok(Math.abs(over.modelProb + under.modelProb - 1) < 1e-12)
  })
  it('model weight is the documented constant, not a function of any score', () => {
    const lowGap = blendProb(0.55, 0.5)
    assert.ok(Math.abs(lowGap - (0.5 * (1 - MODEL_WEIGHT) + 0.55 * MODEL_WEIGHT)) < 1e-12)
  })
})

describe('a whole-number line (regression: the tie used to be handed to the Under)', () => {
  const r = buildPicks(base({
    events: [event(market('Jaylen Brown', 25, [{ book: 'DraftKings', over: 1.95, under: 1.95 }, { book: 'FanDuel', over: 1.9, under: 2.0 }]))],
    projections: [projection(7, 'pts', 25, 0.08)],
  }))
  const over = find(r, 'over')!
  const under = find(r, 'under')!
  const truth = outcomeProbs(25, { kind: 'nb', mu: 25, alpha: 0.08 })!

  it('reports a real chance of a refund', () => {
    assert.ok(over.push > 0.03 && Math.abs(over.push - truth.push) < 1e-12)
  })
  it('each side is the chance of winning given no refund, so the two model probabilities sum to 1', () => {
    assert.ok(Math.abs(over.modelProb - truth.over / (truth.over + truth.under)) < 1e-12)
    assert.ok(Math.abs(under.modelProb - truth.under / (truth.over + truth.under)) < 1e-12)
    assert.ok(Math.abs(over.modelProb + under.modelProb - 1) < 1e-12)
  })
  it('expected value is scaled by the stake that is actually at risk', () => {
    assert.ok(Math.abs(over.ev - expectedValue(over.prob, over.push, over.price)) < 1e-12)
    assert.ok(Math.abs(over.ev - (1 - over.push) * (over.prob * over.price - 1)) < 1e-12)
  })
  it('hit rate ignores ties', () => {
    // newest first: three ties at 25, then 30, 28, 26, 27 (all over) and 20 (under)
    const tied = buildPicks(base({
      events: [event(market('Jaylen Brown', 25, [{ book: 'DraftKings', over: 1.9, under: 1.9 }]))],
      history: history(7, [25, 25, 25, 30, 28, 26, 27, 20]),
    }))
    assert.equal(find(tied, 'over')!.hitRate10, 4 / 5) // 4 wins of 5 decided games; counting ties as losses would give 4/8
    assert.equal(find(tied, 'under')!.hitRate10, 1 / 5)
  })
})

describe('freshness: stale or unverifiable projections are not used', () => {
  const stale = (extra: Partial<ProjectionRow>) => buildPicks(base({ projections: [projection(7, 'pts', 30, 0.1, 3, extra)] }))
  it('older than the limit falls back to the simpler model and says so', () => {
    const r = stale({ created_at: stamp(40) })
    assert.equal(find(r, 'over')!.model, 'baseline-v2')
    assert.deepEqual(r.diagnostics.staleProjectionPlayers, ['Jaylen Brown'])
    assert.equal(find(r, 'over')!.projectionAgeHours, null)
  })
  it('a projection with no timestamp cannot be verified, so it is not used', () => {
    for (const created_at of [null, undefined, 'not a date']) assert.equal(find(stale({ created_at }), 'over')!.model, 'baseline-v2')
  })
  it('a timestamp in the future (clock skew beyond an hour) is rejected too', () => {
    assert.equal(find(stale({ created_at: stamp(-5) }), 'over')!.model, 'baseline-v2')
  })
  it('exactly at the limit is still accepted; just past it is not', () => {
    assert.equal(find(stale({ created_at: stamp(35.9) }), 'over')!.model, 'gbm-v1')
    assert.equal(find(stale({ created_at: stamp(36.5) }), 'over')!.model, 'baseline-v2')
  })
  it('an invalid stored mean or dispersion is rejected instead of producing a number', () => {
    for (const bad of [{ mean: NaN }, { alpha: -1 }, { mean: 9999 }]) {
      const r = buildPicks(base({ projections: [{ ...projection(7, 'pts', 25, 0.1), ...bad }] }))
      assert.equal(find(r, 'over')!.model, 'baseline-v2', JSON.stringify(bad))
    }
  })
})

describe('missing data is reported, never papered over', () => {
  it('players the odds mention but we have not synced', () => {
    const r = buildPicks(base({ events: [event(market('Someone Unknown', 10.5, [{ book: 'DraftKings', over: 1.9, under: 1.9 }]))] }))
    assert.equal(r.picks.length, 0)
    assert.deepEqual(r.diagnostics.unmatchedPlayers, ['Someone Unknown'])
  })
  it('too little history', () => {
    const r = buildPicks(base({ history: history(7, [20, 22, 24]) }))
    assert.equal(r.picks.length, 0)
    assert.deepEqual(r.diagnostics.insufficientHistory, ['Jaylen Brown'])
  })
  it('a player with no history rows at all', () => {
    const r = buildPicks(base({ history: [] }))
    assert.deepEqual(r.diagnostics.insufficientHistory, ['Jaylen Brown'])
  })
  it('malformed quotes are counted and skipped', () => {
    const bad = [
      { key: 'x', title: 'X', markets: [{ key: 'player_points', outcomes: [
        { name: 'Over', description: 'Jaylen Brown', price: 0.5, point: 24.5 },      // price <= 1
        { name: 'Over', description: 'Jaylen Brown', price: NaN, point: 24.5 },
        { name: 'Under', description: 'Jaylen Brown', price: 1.9, point: NaN },
        { name: 'Maybe', description: 'Jaylen Brown', price: 1.9, point: 24.5 },
        { name: 'Over', price: 1.9, point: 24.5 },                                    // no player
      ] }] },
    ]
    const r = buildPicks(base({ events: [event(bad as never)] }))
    assert.equal(r.picks.length, 0)
    assert.equal(r.diagnostics.invalidQuotes, 5)
  })
  it('a one-sided market has no market probability and a pulled-toward-50% blend', () => {
    const r = buildPicks(base({ events: [event(market('Jaylen Brown', 24.5, [{ book: 'DraftKings', over: 1.9 }]))] }))
    const p = find(r, 'over')!
    assert.equal(p.marketProb, null)
    assert.ok(Math.abs(p.prob - blendProb(p.modelProb, null)) < 1e-12)
    assert.equal(find(r, 'under'), undefined)
  })
})

describe('matching and selection', () => {
  it('matches names across accents and suffixes', () => {
    assert.equal(normName('Luka Dončić'), normName('Luka Doncic'))
    assert.equal(normName('Jaren Jackson Jr.'), normName('Jaren Jackson'))
    const r = buildPicks(base({
      events: [event(market('Luka Dončić', 29.5, [{ book: 'DraftKings', over: 1.9, under: 1.9 }]))],
      players: [player(9, 'Luka Doncic', 'LAL')], history: history(9, vals),
    }))
    assert.ok(r.picks.length > 0 && r.picks[0].teamName === 'Los Angeles Lakers')
  })
  it('keeps at most a best-value side and a safest side per player and stat', () => {
    const r = buildPicks(base({ selection: 'best' }))
    assert.ok(r.picks.length <= 2)
  })
  it('the bigGap flag fires when model and market disagree by more than 25 points', () => {
    const r = buildPicks(base({
      events: [event(market('Jaylen Brown', 24.5, [{ book: 'DraftKings', over: 1.9, under: 1.9 }]))],
      projections: [projection(7, 'pts', 40, 0.02)], // model is nearly sure of the over; market says 50%
    }))
    assert.equal(find(r, 'over')!.bigGap, true)
  })
})

describe('determinism and purity', () => {
  it('identical inputs give identical outputs and are not mutated', () => {
    const input = base({ projections: [projection(7, 'pts', 25.2, 0.09)] })
    const snapshot = JSON.stringify(input)
    const a = buildPicks(input)
    const b = buildPicks(input)
    assert.deepEqual(a, b)
    assert.equal(JSON.stringify(input), snapshot)
  })
})

describe('fuzz: whatever the odds and history look like, every number is finite and in range', () => {
  it('2000 random scenarios', () => {
    let s = 12345
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
    for (let i = 0; i < 2000; i++) {
      const level = 1 + rnd() * 30
      const line = rnd() < 0.5 ? Math.floor(level) : Math.floor(level) + 0.5
      const hist = Array.from({ length: 5 + Math.floor(rnd() * 40) }, () => Math.max(0, Math.round(level + (rnd() - 0.5) * level)))
      const books = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => ({
        book: `B${k}`, over: rnd() < 0.9 ? 1.2 + rnd() * 2 : undefined, under: rnd() < 0.9 ? 1.2 + rnd() * 2 : undefined,
      }))
      const withProj = rnd() < 0.5
      const r = buildPicks(base({
        events: [event(market('Jaylen Brown', line, books))],
        history: history(7, hist),
        projections: withProj ? [projection(7, 'pts', level * (0.7 + rnd() * 0.6), rnd() * 0.5, rnd() * 60)] : [],
      }))
      for (const p of r.picks) {
        for (const k of ['modelProb', 'prob', 'push', 'ev', 'impliedProb', 'projection'] as const) assert.ok(Number.isFinite(p[k]), `${k} in scenario ${i}`)
        for (const k of ['modelProb', 'prob', 'push', 'impliedProb'] as const) assert.ok(p[k] >= 0 && p[k] <= 1, `${k}=${p[k]} in scenario ${i}`)
        if (p.marketProb != null) assert.ok(p.marketProb >= 0 && p.marketProb <= 1)
        assert.ok(p.hitRate10 === null || (p.hitRate10 >= 0 && p.hitRate10 <= 1))
        assert.ok(p.ev <= p.price - 1 + 1e-9, 'cannot expect to win more than the full payout')
        assert.ok(p.ev >= -1 - 1e-9, 'cannot lose more than the stake')
        if (Number.isInteger(p.line)) assert.ok(p.push >= 0)
        else assert.equal(p.push, 0)
      }
    }
  })
})
