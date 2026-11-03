import { test } from 'node:test'
import assert from 'node:assert/strict'
import { favouriteOf, review, tierKey, type ReviewRow } from './seasonReview.ts'

const row = (o: Partial<ReviewRow> = {}): ReviewRow => ({ date: '2026-10-25', home: 'DET', away: 'PHI', p_home: 0.7, home_won: 1, srs_gap: 4, talent_diff: 0, rest_diff: 0, b2b_home: 0, b2b_away: 0, ...o })

test('the favourite is whoever the model gave more than half, and the result is judged from their side', () => {
  const home = favouriteOf(row({ p_home: 0.7, home_won: 1 }))
  assert.deepEqual([home.favourite, home.underdog, home.home, home.won, home.prob], ['DET', 'PHI', true, true, 0.7])
  const road = favouriteOf(row({ p_home: 0.3, home_won: 1 }))
  assert.deepEqual([road.favourite, road.home, road.won, Math.round(road.prob * 100)], ['PHI', false, false, 70])
})

test('context is read from the favourite\'s side, so the same situation means the same thing whether the favourite is home or away', () => {
  const h = favouriteOf(row({ p_home: 0.7, srs_gap: 5, talent_diff: 20, rest_diff: -2 }))
  const a = favouriteOf(row({ p_home: 0.3, srs_gap: -5, talent_diff: -20, rest_diff: 2 }))
  assert.equal(h.factors.ratingGap, 5); assert.equal(a.factors.ratingGap, 5)
  assert.equal(h.factors.talentMissing, 20); assert.equal(a.factors.talentMissing, 20)
  assert.equal(h.factors.restAdvantage, -2); assert.equal(a.factors.restAdvantage, -2)
  assert.equal(h.factors.onRoad, false); assert.equal(a.factors.onRoad, true)
})

test('an upset names what was visibly different, a win names nothing, and an upset with nothing visible says it was variance', () => {
  const lost = favouriteOf(row({ p_home: 0.3, home_won: 1, srs_gap: -1, talent_diff: -30, b2b_away: 1, b2b_home: 0, rest_diff: 2 }))
  assert.equal(lost.won, false)
  const text = lost.why.join(' | ')
  assert.match(text, /narrow rating gap/); assert.match(text, /missing more talent/); assert.match(text, /on the road/); assert.match(text, /back-to-back/)
  assert.deepEqual(favouriteOf(row({ home_won: 1 })).why, [])
  assert.match(favouriteOf(row({ p_home: 0.7, home_won: 0, srs_gap: 6 })).why[0], /ordinary variance/)
})

test('tiers share one set of cut points with the page', () => {
  assert.deepEqual([0.9, 0.78, 0.7, 0.65, 0.6, 0.56, 0.52].map(tierKey), ['heavy', 'heavy', 'clear', 'clear', 'slight', 'slight', 'tossup'])
})

test('upsets are counted against what the model expected, and a normal number is called normal', () => {
  // 100 games at 70%: 30 upsets expected. 33 is within normal variance; 45 is not.
  const mk = (losses: number) => Array.from({ length: 100 }, (_, i) => row({ p_home: 0.7, home_won: i < losses ? 0 : 1 }))
  const normal = review(mk(33))
  assert.equal(normal.upsets.observed, 33)
  assert.ok(Math.abs(normal.upsets.expected - 30) < 1e-9)
  assert.match(normal.upsets.verdict, /within normal variance/)
  assert.match(review(mk(45)).upsets.verdict, /More upsets than the model expected/)
  assert.match(review(mk(15)).upsets.verdict, /Fewer upsets/)
})

test('each tier reports stated against actual, and a gap inside the noise is flagged as noise', () => {
  const rows = [...Array.from({ length: 10 }, (_, i) => row({ p_home: 0.85, home_won: i < 9 ? 1 : 0 })), ...Array.from({ length: 200 }, (_, i) => row({ p_home: 0.72, home_won: i < 120 ? 1 : 0 }))]
  const r = review(rows)
  const heavy = r.tiers.find((t) => t.key === 'heavy')!, clear = r.tiers.find((t) => t.key === 'clear')!
  assert.equal(heavy.n, 10); assert.ok(Math.abs(heavy.actual! - 0.9) < 1e-9); assert.equal(heavy.withinNoise, true)
  assert.equal(clear.n, 200); assert.ok(Math.abs(clear.actual! - 0.6) < 1e-9); assert.equal(clear.withinNoise, false, 'stated 72%, won 60% over 200 games is outside two standard errors')
  const few = review(Array.from({ length: 40 }, (_, i) => row({ p_home: 0.72, home_won: i < 24 ? 1 : 0 }))).tiers.find((t) => t.key === 'clear')!
  assert.equal(few.withinNoise, true, 'the same 12-point gap over only 40 games is inside the noise')
  assert.equal(r.tiers.find((t) => t.key === 'slight')!.actual, null)
})

test('every game is listed newest first with the call and the result, and the upsets are the subset the favourite lost', () => {
  const r = review([row({ date: '2026-10-20', home_won: 1 }), row({ date: '2026-10-22', p_home: 0.3, home_won: 1 }), row({ date: '2026-10-21', home_won: 1 })])
  assert.deepEqual(r.allGames.map((g) => g.date), ['2026-10-22', '2026-10-21', '2026-10-20'])
  assert.deepEqual(r.allGames.map((g) => g.won), [false, true, true])
  assert.equal(r.upsetGames.length, 1)
  assert.equal(r.upsetGames[0].date, '2026-10-22')
})

test('a small season carries a caution, an empty one does not fail, and the log loss is the model\'s own', () => {
  assert.match(review([row()]).caution, /small sample/)
  const empty = review([])
  assert.equal(empty.games, 0); assert.equal(empty.logLoss, null); assert.match(empty.upsets.verdict, /Too few/)
  const r = review([row({ p_home: 0.8, home_won: 1 }), row({ p_home: 0.8, home_won: 0 })])
  assert.ok(Math.abs(r.logLoss! - (-(Math.log(0.8) + Math.log(0.2)) / 2)) < 1e-9)
})
