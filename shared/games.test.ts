import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEAN_GAP, lean, leanText, ratingFacts, type GameLeanRow } from './games.ts'

const row = (p: number, extra: Partial<GameLeanRow> = {}): GameLeanRow => ({ date: '2026-11-01', home: 'GSW', away: 'ATL', model_home_prob: p, elo_home: 1550, elo_away: 1500, home_net10: null, away_net10: null, home_off20: null, home_def20: null, away_off20: null, away_def20: null, as_of: 'x', ...extra })

test('the threshold is the pre-registered 7 points', () => assert.equal(LEAN_GAP, 0.07))

test('agreement: both favour the same team, no lean', () => {
  const l = lean(row(0.62), 0.58)
  assert.deepEqual([l.modelPick, l.marketPick, l.agree, l.lean], ['GSW', 'GSW', true, false])
  assert.match(leanText(l), /both favour GSW \(62% and 58%\)/)
})

test('different favourite but a small gap is noise, not a lean', () => {
  const l = lean(row(0.52), 0.48)
  assert.equal(l.agree, false)
  assert.equal(l.lean, false)
  assert.match(leanText(l), /small enough to be noise/)
})

test('different favourite with a gap of at least 7 points is a lean, worded as a prompt to check the news', () => {
  const l = lean(row(0.45), 0.58)
  assert.deepEqual([l.modelPick, l.marketPick, l.lean], ['ATL', 'GSW', true])
  assert.ok(Math.abs(l.gap! + 0.13) < 1e-9)
  const t = leanText(l)
  assert.match(t, /model leans ATL \(55%\)/)
  assert.match(t, /check the news/)
  assert.doesNotMatch(t, /\bbet\b|value|edge/i)
})

test('a gap in the same direction is never a lean even when large', () => {
  assert.equal(lean(row(0.85), 0.6).lean, false)
})

test('without a market price there is no comparison and no lean', () => {
  for (const m of [null, undefined, NaN]) {
    const l = lean(row(0.4), m as number | null)
    assert.deepEqual([l.marketPick, l.gap, l.agree, l.lean], [null, null, null, false])
    assert.match(leanText(l), /no market price/)
  }
})

test('rating facts are descriptive, skip what is missing, and call out a large gap', () => {
  assert.deepEqual(ratingFacts(row(0.5)), [])
  const f = ratingFacts(row(0.5, { home_net10: 6.2, away_net10: -1.1, home_off20: 118.2, home_def20: 112, away_off20: 111, away_def20: 117 }))
  assert.equal(f.length, 2)
  assert.match(f[0], /GSW \+6\.2, ATL -1\.1/)
  assert.match(f[0], /7-point gap in favour of GSW/)
})
