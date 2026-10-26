// Run: npm test. The odds archive must record what was seen, when, and never call a price something it is not.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { closingProxy, firstObserved, flatten, freshnessOf, marketKey, planArchive, runSql, type ObservedQuote, type Prior, type StoredQuote } from './oddsArchive.ts'
import type { OddsEvent } from './picks.ts'

const T0 = '2026-10-26T20:00:00Z'
const START = '2026-10-27T00:30:00Z'
const ev = (outcomes: { book: string; side: 'Over' | 'Under'; price: number; point?: number; updated?: string; main?: boolean; name?: string }[], id = 'e1'): OddsEvent => {
  const books = [...new Set(outcomes.map((o) => o.book))]
  return {
    id, commence_time: START, home_team: 'H', away_team: 'A',
    bookmakers: books.map((b) => ({ key: b.toLowerCase(), title: b, markets: [{ key: 'player_points', outcomes: outcomes.filter((o) => o.book === b).map((o) => ({
      name: o.side, description: o.name ?? 'Jaylen Brown', price: o.price, point: o.point ?? 24.5, updated: o.updated, updatedSource: o.updated ? ('quote' as const) : undefined, main: o.main })) }] })),
  }
}
const quotes = (e: OddsEvent) => flatten(e, 'theoddsapi').quotes
const priorOf = (qs: ObservedQuote[]) => new Map<string, Prior>(qs.map((q) => [marketKey(q), { price: q.price, marketStatus: 'open' as const, main: q.main }]))

describe('what is recorded from one response', () => {
  it('flattens valid Over/Under prices, keeps timestamps and where they came from, and skips junk', () => {
    const e = ev([{ book: 'DraftKings', side: 'Over', price: 1.9, updated: '2026-10-26T19:50:00Z' }, { book: 'DraftKings', side: 'Under', price: 1.9 }, { book: 'FanDuel', side: 'Over', price: 0.8 }])
    const { quotes: qs, skipped } = flatten(e, 'theoddsapi')
    assert.equal(qs.length, 2); assert.equal(skipped, 1)
    assert.deepEqual(qs.map((q) => q.timestampSource).sort(), ['quote', 'unknown'])
    assert.equal(qs[0].eventStart, START)
  })
  it('a new market is written, an unchanged one is not written again, a changed price is', () => {
    const e1 = ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }, { book: 'DraftKings', side: 'Under', price: 1.9 }])
    const first = planArchive(new Map(), quotes(e1), T0)
    assert.equal(first.written, 2)
    const again = planArchive(priorOf(quotes(e1)), quotes(e1), '2026-10-26T20:20:00Z')
    assert.equal(again.written, 0); assert.equal(again.seen, 2)
    const moved = planArchive(priorOf(quotes(e1)), quotes(ev([{ book: 'DraftKings', side: 'Over', price: 1.85 }, { book: 'DraftKings', side: 'Under', price: 1.9 }])), '2026-10-26T20:40:00Z')
    assert.deepEqual(moved.rows.map((r) => [r.side, r.priceOrNull]), [['over', 1.85]])
  })
  it('a market that disappears from a complete response is recorded as unavailable, once; a partial response never does that', () => {
    const e1 = ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }, { book: 'FanDuel', side: 'Over', price: 1.95 }])
    const prior = priorOf(quotes(e1))
    const gone = planArchive(prior, quotes(ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }])), '2026-10-26T21:00:00Z', { complete: true })
    assert.equal(gone.unavailable, 1)
    assert.deepEqual(gone.rows.map((r) => [r.book, r.marketStatus, r.priceOrNull]), [['FanDuel', 'unavailable', null]])
    const partial = planArchive(prior, quotes(ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }])), '2026-10-26T21:00:00Z', { complete: false })
    assert.equal(partial.unavailable, 0)
    const stillGone = new Map(prior); stillGone.set(marketKey(quotes(e1)[1]), { price: null, marketStatus: 'unavailable', main: null })
    assert.equal(planArchive(stillGone, quotes(ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }])), '2026-10-26T22:00:00Z').unavailable, 0, 'already recorded as unavailable')
    const back = planArchive(stillGone, quotes(e1), '2026-10-26T23:00:00Z')
    assert.deepEqual(back.rows.map((r) => [r.book, r.marketStatus]), [['FanDuel', 'open']])
  })
  it('the same book listing two prices for one market is a disagreement; the first is kept; identical duplicates are not', () => {
    const dup = ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }, { book: 'DraftKings', side: 'Over', price: 1.9 }])
    assert.deepEqual([planArchive(new Map(), quotes(dup), T0).written, planArchive(new Map(), quotes(dup), T0).disagreements], [1, 0])
    const conflict = ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }, { book: 'DraftKings', side: 'Over', price: 1.8 }])
    const p = planArchive(new Map(), quotes(conflict), T0)
    assert.equal(p.disagreements, 1); assert.equal(p.rows[0].priceOrNull, 1.9)
  })
  it('two providers for the same book are stored separately, never merged', () => {
    const a = flatten(ev([{ book: 'DraftKings', side: 'Over', price: 1.9 }]), 'theoddsapi').quotes
    const b = flatten(ev([{ book: 'DraftKings', side: 'Over', price: 1.95 }]), 'oddsblaze').quotes
    const p = planArchive(new Map(), [...a, ...b], T0)
    assert.equal(p.written, 2); assert.deepEqual(new Set(p.rows.map((r) => r.source)), new Set(['theoddsapi', 'oddsblaze']))
  })
  it('stale and untimed quotes are flagged when seen, not trusted and not dropped', () => {
    const e = ev([{ book: 'DraftKings', side: 'Over', price: 1.9, updated: '2026-10-26T15:00:00Z' }, { book: 'FanDuel', side: 'Over', price: 1.9, updated: '2026-10-26T19:55:00Z' }, { book: 'Caesars', side: 'Over', price: 1.9 }])
    const p = planArchive(new Map(), quotes(e), T0)
    const by = Object.fromEntries(p.rows.map((r) => [r.book, r.freshness]))
    assert.deepEqual(by, { DraftKings: 'stale', FanDuel: 'fresh', Caesars: 'unknown' }); assert.equal(p.stale, 1)
    assert.equal(freshnessOf('2026-10-26T20:30:00Z', T0), 'fresh', 'a quote a little in the future is clock skew, not staleness')
  })
  it('alternate lines are separate markets', () => {
    const e = ev([{ book: 'DraftKings', side: 'Over', price: 1.9, point: 22.5 }, { book: 'DraftKings', side: 'Over', price: 2.4, point: 26.5 }])
    assert.equal(planArchive(new Map(), quotes(e), T0).written, 2)
  })
})

describe('opening and closing labels are earned', () => {
  const h = (mins: number, price: number | null, extra: Partial<StoredQuote> = {}): StoredQuote => ({ capturedAt: new Date(Date.parse(START) - mins * 60_000).toISOString(), price, marketStatus: price === null ? 'unavailable' : 'open', freshness: 'fresh', timestampSource: 'quote', ...extra })
  it('the first observed price is the first one WE saw, not the bookmaker opening line', () => {
    const f = firstObserved([h(60, 1.85), h(400, 1.9), h(10, 1.8)])!
    assert.equal(f.price, 1.9)
    assert.equal(firstObserved([]), null)
  })
  it('a closing proxy is the last observation at or before the cutoff and says it is not a true close', () => {
    const r = closingProxy([h(400, 1.9), h(30, 1.85), h(12, 1.8), h(2, 1.7)], START, { cutoffMinutes: 5, maxGapMinutes: 20 })
    assert.ok(r.ok)
    if (r.ok) { assert.equal(r.proxy.price, 1.8); assert.equal(r.proxy.isTrueClosingLine, false); assert.equal(r.proxy.kind, 'closing_proxy'); assert.ok(Math.abs(r.proxy.gapToCutoffMinutes - 7) < 1e-6) }
  })
  it('no usable observation means no proxy, with the reason, rather than a stale number', () => {
    assert.deepEqual(closingProxy([h(400, 1.9)], START), { ok: false, reason: 'OBSERVATION_TOO_OLD' })
    assert.deepEqual(closingProxy([h(3, 1.9)], START), { ok: false, reason: 'NO_OBSERVATION_BEFORE_CUTOFF' })
    assert.deepEqual(closingProxy([], START), { ok: false, reason: 'NO_OBSERVATION_BEFORE_CUTOFF' })
    assert.deepEqual(closingProxy([h(10, null)], START), { ok: false, reason: 'MARKET_UNAVAILABLE_AT_CUTOFF' })
    assert.deepEqual(closingProxy([h(10, 1.9, { freshness: 'stale' })], START), { ok: false, reason: 'STALE_QUOTE' })
  })
})

describe('SQL for scripts', () => {
  it('escapes every value and writes the run once', () => {
    const e = ev([{ book: "O'Brien's Book", side: 'Over', price: 1.9, name: "De'Aaron Fox" }])
    const plan = planArchive(new Map(), quotes(e), T0)
    const sql = runSql({ source: 'theoddsapi', kind: 'daily', eventId: 'e1', eventStart: START, capturedAt: T0, status: 'ok', plan })
    assert.equal(sql.length, 2)
    assert.match(sql[1], /'De''Aaron Fox'/); assert.match(sql[1], /'O''Brien''s Book'/)
    assert.ok(!/DROP|;\s*DELETE/i.test(sql.join('\n')))
  })
})

describe('reading the latest state back', () => {
  it('prior rows become the map the planner compares against, so a repeat capture writes nothing', async () => {
    const { priorFromRows } = await import('./oddsArchive.ts')
    const e = ev([{ book: 'DraftKings', side: 'Over', price: 1.9, main: true }])
    const qs = quotes(e)
    const prior = priorFromRows('e1', [{ playerName: 'Jaylen Brown', stat: 'pts', line: 24.5, side: 'over', book: 'DraftKings', source: 'theoddsapi', price: 1.9, marketStatus: 'open', main: 1 }])
    assert.equal(planArchive(prior, qs, T0).written, 0)
    assert.equal(planArchive(new Map(), qs, T0).written, 1)
  })
})
