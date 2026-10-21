import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildConsensus, devigPower, devigProportional, median, selectExecutablePrice, type BookQuote, type ConsensusSettings, type SideQuote } from './consensus.ts'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const S: ConsensusSettings = { now: NOW, maxQuoteAgeMinutes: 120, feedGroups: {}, outlierMinDeviation: 0.04, outlierMadK: 3, maxBookDisagreement: 0.08 }
const P = { ...S, priceCorroboration: 1.03, staleLineRatio: 1.15 }
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`)
const q = (book: string, over: number | null, under: number | null, min = 5): BookQuote => ({ book, over, under, overUpdated: ago(min), underUpdated: ago(min), timestampSource: 'quote' })

test('margin removal: both methods return a probability pair that sums to 1, and a longshot keeps less under the power method', () => {
  const [a, b] = devigProportional(1.91, 1.91)
  near(a, 0.5); near(b, 0.5)
  const [po, pu] = devigProportional(1.5, 2.6)
  near(po + pu, 1)
  const [wo, wu] = devigPower(1.5, 2.6)
  near(wo + wu, 1, 1e-9)
  assert.ok(wu < pu, 'the power method takes more margin from the longshot side')
  assert.ok(wo > po)
})

test('margin removal with no margin or an arbitrage falls back to the proportional split, never a negative margin', () => {
  const [o, u] = devigPower(2.0, 2.0)
  near(o, 0.5); near(u, 0.5)
  const [ao, au] = devigPower(2.1, 2.1)                 // implied sum below 1
  near(ao + au, 1); near(ao, 0.5)
})

test('consensus is the median over independent feeds, with the lower envelope and the implied-with-margin kept', () => {
  const c = buildConsensus([q('draftkings', 1.91, 1.91), q('fanatics', 1.87, 1.95), q('caesars', 1.95, 1.87)], 'over', S)
  assert.equal(c.independentFeeds, 3)
  assert.ok(c.fair !== null && Math.abs(c.fair - 0.5) < 0.03)
  assert.ok(c.fairLower! <= c.fair!)
  assert.ok(c.corroborated)
  assert.ok(c.impliedWithMargin! > c.fair!, 'the margin makes the implied probability larger than the fair one')
  assert.equal(c.contributors.length, 3)
  const u = buildConsensus([q('draftkings', 1.91, 1.91), q('fanatics', 1.87, 1.95)], 'under', S)
  const o = buildConsensus([q('draftkings', 1.91, 1.91), q('fanatics', 1.87, 1.95)], 'over', S)
  near(u.fair! + o.fair!, 1, 1e-9)
})

test('a quote with no timestamp, a stale one, a one-sided one and an invalid price are excluded, each with its reason', () => {
  const quotes: BookQuote[] = [
    q('fresh', 1.9, 1.9),
    { book: 'nots', over: 1.9, under: 1.9, overUpdated: null, underUpdated: null },
    q('old', 1.9, 1.9, 121),
    q('oneside', 1.9, null),
    q('junk', 1.0, 1.9),
    { book: 'half', over: 1.9, under: 1.9, overUpdated: ago(5), underUpdated: null },
    { book: 'badts', over: 1.9, under: 1.9, overUpdated: 'not a date', underUpdated: ago(5) },
    q('future', 1.9, 1.9, -60),
  ]
  const c = buildConsensus(quotes, 'over', S)
  assert.equal(c.independentFeeds, 1)
  const by = Object.fromEntries(c.exclusions.map((e) => [e.book, e.reason]))
  assert.deepEqual(by, { nots: 'MISSING_TIMESTAMP', old: 'STALE_QUOTE', oneside: 'ONE_SIDED', junk: 'INVALID_PRICE', half: 'MISSING_TIMESTAMP', badts: 'MISSING_TIMESTAMP', future: 'STALE_QUOTE' })
  assert.equal(c.corroborated, false, 'one feed cannot corroborate itself')
})

test('the freshness limit is inclusive at exactly the limit and exclusive just past it', () => {
  assert.equal(buildConsensus([q('a', 1.9, 1.9, 120)], 'over', S).independentFeeds, 1)
  assert.equal(buildConsensus([q('a', 1.9, 1.9, 120.1)], 'over', S).independentFeeds, 0)
  assert.deepEqual(buildConsensus([], 'over', S).flags, ['NO_USABLE_QUOTES'])
})

test('books that republish one feed count once', () => {
  const g = { ...S, feedGroups: { betrivers: 'kambi', unibet: 'kambi' } }
  const c = buildConsensus([q('betrivers', 1.9, 1.9), q('unibet', 1.9, 1.9), q('draftkings', 1.88, 1.92)], 'over', g)
  assert.equal(c.independentFeeds, 2)
  assert.ok(c.exclusions.some((e) => e.reason === 'DUPLICATE_FEED'))
  assert.equal(buildConsensus([q('betrivers', 1.9, 1.9), q('unibet', 1.9, 1.9)], 'over', g).independentFeeds, 1)
})

test('with three or more feeds an outlier is dropped; with two, disagreement means no corroboration', () => {
  const c = buildConsensus([q('a', 1.9, 1.9), q('b', 1.88, 1.92), q('c', 1.7, 2.3)], 'over', S)   // c says the over is ~58%
  assert.equal(c.independentFeeds, 2)
  assert.deepEqual(c.exclusions.map((e) => [e.book, e.reason]), [['c', 'OUTLIER']])
  assert.ok(Math.abs(c.fair! - 0.5) < 0.02, 'the consensus is not dragged by the outlier')
  const two = buildConsensus([q('a', 1.9, 1.9), q('b', 1.6, 2.5)], 'over', S)
  assert.equal(two.independentFeeds, 2)
  assert.equal(two.corroborated, false)
  assert.ok(two.flags.includes('BOOKS_DISAGREE'))
})

test('median helper', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
})

// ---------------------------------------------------------------- executable price

const sq = (book: string, price: number, min = 5, extra: Partial<SideQuote> = {}): SideQuote => ({ book, price, updated: ago(min), timestampSource: 'quote', ...extra })

test('executable price: the best fresh price, capped at 3% above the next-best independent one', () => {
  const ok = selectExecutablePrice([sq('a', 2.0), sq('b', 1.95)], P)
  assert.equal(ok.price, 2.0)
  assert.equal(ok.corroboratedBy, 'b')
  assert.equal(ok.rejection, null)
  const capped = selectExecutablePrice([sq('a', 2.1), sq('b', 1.95)], P)       // 2.1 / 1.95 = 1.077: not stale, but capped
  near(capped.price!, 1.95 * 1.03)
  assert.equal(capped.best, 2.1)
  assert.equal(capped.contributing.length, 2)
})

test('executable price: a lone price, a stale line, and missing or stale quotes are all refused, never trusted', () => {
  assert.equal(selectExecutablePrice([sq('a', 2.0)], P).rejection, 'UNVERIFIED_PRICE')
  assert.equal(selectExecutablePrice([sq('a', 2.4), sq('b', 1.95)], P).rejection, 'STALE_LINE_SUSPECT')   // 2.4/1.95 = 1.23
  assert.equal(selectExecutablePrice([], P).rejection, 'NO_FRESH_QUOTE')
  assert.equal(selectExecutablePrice([sq('a', 2.0, 200), sq('b', 1.95, 200)], P).rejection, 'NO_FRESH_QUOTE')
  assert.equal(selectExecutablePrice([sq('a', 2.0), sq('b', 1.95, 200)], P).rejection, 'UNVERIFIED_PRICE', 'a stale runner-up cannot corroborate')
  assert.equal(selectExecutablePrice([sq('a', 2.0), { book: 'b', price: 1.95, updated: null }], P).rejection, 'UNVERIFIED_PRICE')
  assert.equal(selectExecutablePrice([sq('a', 2.0), sq('b', 1.0)], P).rejection, 'UNVERIFIED_PRICE')
  const bounds = selectExecutablePrice([sq('a', 1.15 * 1.9), sq('b', 1.9)], P)
  assert.equal(bounds.rejection, null, 'exactly at the stale ratio is allowed')
  assert.equal(selectExecutablePrice([sq('a', 1.15 * 1.9 + 0.001), sq('b', 1.9)], P).rejection, 'STALE_LINE_SUSPECT')
})

test('executable price: two books on one feed are one quote, so they cannot corroborate each other', () => {
  const g = { ...P, feedGroups: { betrivers: 'kambi', unibet: 'kambi' } }
  assert.equal(selectExecutablePrice([sq('betrivers', 2.0), sq('unibet', 1.95)], g).rejection, 'UNVERIFIED_PRICE')
  assert.equal(selectExecutablePrice([sq('betrivers', 2.0), sq('unibet', 1.95), sq('draftkings', 1.97)], g).rejection, null)
})

test('executable price reports its own age as that of the oldest quote it rests on', () => {
  const r = selectExecutablePrice([sq('a', 2.0, 10), sq('b', 1.95, 90)], P)
  assert.equal(r.ageMinutes, 90)
  assert.equal(r.asOf, ago(90))
})
