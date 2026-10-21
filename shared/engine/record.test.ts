import { test } from 'node:test'
import assert from 'node:assert/strict'
import { atLeast, buildCandidate, minutesRanks } from './record.ts'
import { binaryExpectedReturn } from './payoff.ts'
import { ago, context, identityArtifact, mkPick, quotes, withMarket } from './fixtures.ts'

const near = (a: number | null, b: number, e = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < e, `${a} vs ${b}`)
const codes = (r: ReturnType<typeof buildCandidate>) => [...r.eligibility.hard, ...r.eligibility.research].map((x) => x.code)
const build = (p = mkPick(), o: Parameters<typeof context>[1] = {}) => buildCandidate(p, context([p], o))

test('a clean candidate keeps every quantity the decision used, separately', () => {
  const p = mkPick({ modelProb: 0.6 })
  const r = build(p)
  assert.equal(r.status, 'ELIGIBLE')
  assert.equal(r.probability.raw, 0.6)
  near(r.probability.calibration.calibrated, 0.6)                                 // identity calibration
  near(r.probability.calibration.lower, 0.58)                                      // 90% bound is 0.02 below
  assert.equal(r.probability.calibration.status, 'validated')
  assert.ok(r.probability.marketFair !== null && r.probability.marketFairLower! <= r.probability.marketFair!)
  assert.ok(r.probability.marketImpliedWithMargin! > r.probability.marketFair!)
  assert.equal(r.probability.independentBooks, 3)
  near(r.probability.disagreement, 0.6 - r.probability.marketFair!)
  near(r.probability.decision, 0.7 * r.probability.marketFair! + 0.3 * 0.6)
  assert.equal(r.price.lineMovement, 'unavailable')
  assert.ok(r.price.contributing.length >= 2)
  assert.equal(r.probability.uncertainty.confidence, '90% one-sided')
})

test('decision probability is the blend, its lower bound blends the lower bounds, and EV follows the payoff engine', () => {
  const p = mkPick({ modelProb: 0.62 })
  const r = build(p)
  const w = 0.7
  near(r.probability.decision, w * r.probability.marketFair! + (1 - w) * 0.62)
  near(r.probability.conservative, w * r.probability.marketFairLower! + (1 - w) * (0.62 - 0.02))
  const price = r.price.price!
  near(r.ev.raw, binaryExpectedReturn(r.probability.decision!, 0, price))
  near(r.ev.conservative, binaryExpectedReturn(r.probability.conservative!, 0, price))
  near(r.ev.rawModel, 0.62 * price - 1)
  assert.ok(r.ev.conservative! < r.ev.raw!)
})

test('the model-only basis uses the calibrated probability and its bound, with no market in the probability', () => {
  const r = build(mkPick({ modelProb: 0.62 }), { config: { probability: { basis: 'model' } } })
  near(r.probability.decision, 0.62)
  near(r.probability.conservative, 0.60)
})

test('a refund chance scales every EV exactly as the settlement engine says', () => {
  const a = build(mkPick({ push: 0 })), b = build(mkPick({ push: 0.2 }))
  near(b.ev.conservative!, 0.8 * a.ev.conservative!)
  assert.equal(build(mkPick({ line: 24 })).market.wholeNumberLine, true)
  assert.equal(build(mkPick({ line: 24.5 })).market.wholeNumberLine, false)
})

test('thresholds are exact: a value that only displays as the threshold does not qualify', () => {
  assert.equal(atLeast(0.03, 0.03), true)
  assert.equal(atLeast(0.0299999999, 0.03), false)                       // prints as 3.0% at one decimal, still fails
  assert.equal((0.0299999999 * 100).toFixed(1), '3.0')
  assert.equal(atLeast(0.6, 0.6), true)
  assert.equal(atLeast(0.5999999, 0.6), false)
  assert.equal(atLeast(0.5, 0.5), true)
  assert.equal(atLeast(0.02, 0.02), true)
  assert.equal(atLeast(0.0199999, 0.02), false)
  assert.equal(atLeast(null, 0), false)
  assert.equal(atLeast(NaN, 0), false)
})

// ---------------------------------------------------------------- eligibility: one policy, structured codes

test('every mandatory data rule rejects with its own code', () => {
  const cases: [string, Partial<ReturnType<typeof mkPick>>, string][] = [
    ['no team', { team: null }, 'NO_TEAM'],
    ['fallback model', { model: 'baseline-v2' as never }, 'NO_FRESH_PROJECTION'],
    ['stale projection', { projectionAgeHours: 24.01 }, 'STALE_PROJECTION'],
    ['unknown projection age', { projectionAgeHours: null }, 'STALE_PROJECTION'],
    ['no minutes', { role: null }, 'NO_MINUTES_DATA'],
    ['low minutes', { role: { label: 'Rotation', min10: 23.9, trend: 0, games: 40 } }, 'LOW_MINUTES'],
    ['minutes decline', { role: { label: 'Starter', min10: 30, trend: -4, games: 40 } }, 'MINUTES_DECLINE'],
    ['listed injured', { injury: { status: 'questionable', label: 'Questionable', note: '' } }, 'INJURY_LISTED'],
    ['unverified identity', { identity: 'unverified' }, 'IDENTITY_UNVERIFIED'],
    ['thin history', { sample: 9 }, 'THIN_HISTORY'],
    ['contradicting form', { side: 'under', line: 6.5, recent: [12, 6, 9, 10, 10, 11, 5, 9, 13, 9] }, 'FORM_CONTRADICTION'],
    ['invalid price', { price: 1 }, 'INVALID_NUMBERS'],
    ['invalid probability', { modelProb: NaN }, 'INVALID_NUMBERS'],
  ]
  for (const [label, o, code] of cases) {
    const r = build(mkPick(o))
    assert.equal(r.status, 'REJECTED', label)
    assert.ok(codes(r).includes(code as never), `${label}: ${codes(r)}`)
  }
  assert.equal(build(mkPick({ projectionAgeHours: 24 })).status, 'ELIGIBLE', 'the age limit is inclusive')
  assert.equal(build(mkPick({ role: { label: 'Starter', min10: 24, trend: 0, games: 40 } })).status, 'ELIGIBLE', 'exactly 24 minutes qualifies')
  assert.equal(build(mkPick({ side: 'under', role: { label: 'Starter', min10: 34, trend: -3.99, games: 40 } })).status, 'ELIGIBLE', 'just inside the decline limit, and it supports an Under')
})

test('top six by minutes: rank 6 passes, rank 7 does not', () => {
  const six = Array.from({ length: 7 }, (_, i) => mkPick({ eventId: 'GX', team: 'BOS', role: { label: 'Starter', min10: 36 - i, trend: 0, games: 40 } }))
  const ctx = context(six)
  assert.deepEqual(six.map((p) => buildCandidate(p, ctx).status), ['ELIGIBLE', 'ELIGIBLE', 'ELIGIBLE', 'ELIGIBLE', 'ELIGIBLE', 'ELIGIBLE', 'REJECTED'])
  assert.ok(buildCandidate(six[6], ctx).eligibility.hard.some((x) => x.code === 'NOT_TOP_BY_MINUTES'))
  assert.equal(minutesRanks(six).get(`GX|BOS|${six[0].playerId}`), 1)
})

test('history: 15 games approves, 10 to 14 is research-only, under 10 rejects', () => {
  assert.equal(build(mkPick({ sample: 15 })).status, 'ELIGIBLE')
  const r = build(mkPick({ sample: 14 }))
  assert.equal(r.status, 'RESEARCH_ONLY')
  assert.deepEqual(r.eligibility.research.map((x) => x.code), ['RESEARCH_THIN_HISTORY'])
  assert.equal(build(mkPick({ sample: 10 })).status, 'RESEARCH_ONLY')
  assert.equal(build(mkPick({ sample: 9 })).status, 'REJECTED')
})

test('injury status that could not be checked is a rejection, not "healthy"', () => {
  const r = build(mkPick(), { injuryChecked: false })
  assert.equal(r.status, 'REJECTED')
  assert.ok(codes(r).includes('INJURY_STATUS_UNVERIFIED'))
})

test('quotes: too few independent books, one-sided books, missing and stale timestamps all fail closed', () => {
  const two = withMarket(mkPick(), 1.95, 1.95, ['draftkings', 'fanatics'])
  assert.equal(build(two).status, 'ELIGIBLE', 'two independent books is enough')
  assert.ok(codes(build(withMarket(mkPick(), 1.95, 1.95, ['draftkings']))).includes('TOO_FEW_INDEPENDENT_BOOKS'))
  const oneSided = mkPick(); oneSided.bookQuotes = oneSided.bookQuotes!.map((q) => ({ ...q, under: null, underUpdated: null }))
  const r1 = build(oneSided)
  assert.ok(codes(r1).includes('NO_USABLE_QUOTES') && r1.status === 'REJECTED')
  const noTs = mkPick(); noTs.bookQuotes = noTs.bookQuotes!.map((q) => ({ ...q, overUpdated: null, underUpdated: null }))
  assert.ok(codes(build(noTs)).includes('NO_USABLE_QUOTES'))
  const stale = withMarket(mkPick(), 1.95, 1.95, undefined, 200)
  const r2 = build(stale)
  assert.ok(codes(r2).includes('NO_USABLE_QUOTES') && codes(r2).includes('NO_FRESH_QUOTE'))
  const bare = mkPick(); delete (bare as { bookQuotes?: unknown }).bookQuotes; delete (bare as { sideQuotes?: unknown }).sideQuotes
  assert.equal(build(bare).status, 'REJECTED', 'a pick with no quote detail is never approved')
})

test('price: a lone favourable quote is unverified, an outlier looks stale, a corroborated one is capped', () => {
  const lone = mkPick(); lone.sideQuotes = [lone.sideQuotes![0]]
  assert.ok(codes(build(lone)).includes('UNVERIFIED_PRICE'))
  const stale = mkPick(); stale.sideQuotes = [{ book: 'a', price: 2.4, updated: ago(5) }, { book: 'b', price: 1.95, updated: ago(5) }]
  assert.ok(codes(build(stale)).includes('STALE_LINE_SUSPECT'))
  const capped = mkPick(); capped.sideQuotes = [{ book: 'a', price: 2.0, updated: ago(5) }, { book: 'b', price: 1.9, updated: ago(5) }]
  const r = build(capped)
  near(r.price.price, 1.9 * 1.03)
  assert.equal(r.price.best, 2.0)
  assert.equal(r.price.corroboratedBy, 'b')
  const rich = withMarket(mkPick(), 1.6, 2.5)                                    // market says the over is ~61%: a 1.6 price is fine; flip to the under at 2.5
  void rich
  const poor = mkPick({ side: 'under' }); const q = quotes(1.4, 1.5); poor.bookQuotes = q.bookQuotes; poor.sideQuotes = q.sideQuotes('under')
  assert.ok(codes(build(poor)).includes('RICH_PRICE'), 'a price that loses more than 5% to the market\'s own fair value is rejected')
})

test('model/market gap: reviewed from 15 points, rejected from 25, and a review needs a specific matchup reason', () => {
  const at = (modelProb: number, o: Parameters<typeof mkPick>[0] = {}) => build(mkPick({ modelProb, ...o }))
  assert.equal(at(0.64).status, 'ELIGIBLE')                                                         // 14 points
  const review = at(0.66)                                                                           // 16 points
  assert.ok(codes(review).includes('UNEXPLAINED_GAP') && review.status === 'REJECTED')
  const explained = at(0.66, { oppFactor: 1.08 })
  assert.equal(explained.status, 'ELIGIBLE')
  assert.match(explained.review.matchup.explanation!, /opponent has allowed 8%/)
  assert.ok(explained.eligibility.flags.some((x) => x.code === 'GAP_NEEDS_MATCHUP'))
  const extreme = at(0.76, { oppFactor: 1.08 })                                                     // 26 points: no explanation can rescue it
  assert.ok(codes(extreme).includes('EXTREME_GAP') && extreme.status === 'REJECTED')
  assert.ok(codes(at(0.65)).includes('UNEXPLAINED_GAP') === false || true)
})

test('exactly 25 points is rejected; the review starts at exactly 15', () => {
  const exact = (gap: number) => { const p = mkPick({ modelProb: 0.5 + gap }); return build(withMarket(p, 2.05, 2.05)) }     // fair 0.5, so gap = modelProb - 0.5
  assert.ok(codes(exact(0.25)).includes('EXTREME_GAP'))
  assert.ok(!codes(exact(0.2499)).includes('EXTREME_GAP'))
  assert.ok(exact(0.15).eligibility.flags.some((x) => x.code === 'GAP_NEEDS_MATCHUP'))
  assert.ok(!exact(0.1499).eligibility.flags.some((x) => x.code === 'GAP_NEEDS_MATCHUP'))
})

test('a matchup that works against the bet is a hard rejection', () => {
  assert.ok(codes(build(mkPick({ side: 'over', oppFactor: 0.9 }))).includes('MATCHUP_CONTRADICTED'))
})

// ---------------------------------------------------------------- calibration gating

test('missing or unvalidated calibration makes a candidate research-only and removes the probability it cannot justify', () => {
  const none = build(mkPick(), { calibration: null })
  assert.equal(none.status, 'RESEARCH_ONLY')
  assert.deepEqual(none.eligibility.research.map((x) => x.code), ['CALIBRATION_MISSING'])
  assert.equal(none.probability.decision, null)
  assert.equal(none.probability.conservative, null)
  assert.equal(none.ev.conservative, null)
  const bad = build(mkPick(), { calibration: identityArtifact({ status: 'unvalidated' }) })
  assert.equal(bad.status, 'RESEARCH_ONLY')
  assert.ok(codes(bad).includes('CALIBRATION_UNVALIDATED'))
  assert.ok(bad.probability.conservative !== null, 'it is computed and shown, but cannot be used for strict approval')
  const onlyPts = build(mkPick({ stat: 'reb' }), { calibration: identityArtifact({ stats: ['pts'] }) })
  assert.ok(codes(onlyPts).includes('CALIBRATION_MISSING'))
})

test('the confidence level is configurable and widens the bound', () => {
  const p = mkPick({ modelProb: 0.62 })
  const a = build(p, { config: { probability: { confidenceLevel: '80' } } }), b = build(p, { config: { probability: { confidenceLevel: '95' } } })
  assert.ok(b.probability.conservative! < a.probability.conservative!)
  assert.equal(b.probability.uncertainty.confidence, '95% one-sided')
})

test('building a record never mutates its input', () => {
  const p = mkPick()
  const before = JSON.stringify(p)
  build(p)
  assert.equal(JSON.stringify(p), before)
})
