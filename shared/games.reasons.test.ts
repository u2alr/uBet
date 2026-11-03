import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eloHomeProb, gameReasons, type GameLeanRow } from './games.ts'

const row = (p: number, extra: Partial<GameLeanRow> = {}): GameLeanRow => ({ date: '2026-11-01', home: 'GSW', away: 'ATL', model_home_prob: p, elo_home: 1550, elo_away: 1500, home_net10: null, away_net10: null, home_off20: null, home_def20: null, away_off20: null, away_def20: null, as_of: 'x', ...extra })
const kinds = (rs: ReturnType<typeof gameReasons>) => Object.fromEntries(rs.map((r) => [r.label, r.kind]))

test('a home favourite with the stronger rating and an opponent missing rotation players gets reasons for', () => {
  const k = kinds(gameReasons(row(0.7, { elo_home: 1600, elo_away: 1500, absent_away: 'Star (30 min)' }), 0.65))
  assert.equal(k['Home court'], 'for'); assert.equal(k['Team strength'], 'for'); assert.equal(k['Their absences'], 'for'); assert.equal(k['Market'], 'for')
})

test('a road favourite carries a home-court reason against, and its own absences count against it', () => {
  const rs = gameReasons(row(0.4, { elo_home: 1500, elo_away: 1600, absent_away: 'Guy (20 min)' }), null)
  const k = kinds(rs)
  assert.ok(rs.find((r) => r.label === 'Home court')!.text.includes('ATL'))
  assert.equal(k['Home court'], 'against'); assert.equal(k['Own absences'], 'against'); assert.equal(k['Market'], 'context')
})

test('a lean against the market is a caution, and Questionable players the model cannot see are named for these two teams only', () => {
  const rs = gameReasons(row(0.45), 0.58, [{ team: 'GSW', name: 'Curry', status: 'questionable' }, { team: 'LAL', name: 'Other', status: 'doubtful' }])
  const text = rs.find((r) => r.label === 'Not seen by the model')!.text
  assert.equal(kinds(rs)['Market'], 'caution')
  assert.match(text, /GSW Curry/); assert.doesNotMatch(text, /LAL/)
})

test('net rating is context, never support; cautions precede context and the limits are always stated', () => {
  const rs = gameReasons(row(0.6, { home_net10: 8, away_net10: -2 }), null)
  assert.equal(kinds(rs)['Recent form'], 'context')
  assert.equal(rs.filter((r) => r.label === 'Limits').length, 1)
  const firstContext = rs.findIndex((r) => r.kind === 'context')
  assert.ok(rs.slice(firstContext).every((r) => r.kind === 'context'))
})

test('the plain Elo reference matches the standard formula and is shown only when the model moves it by 3 points', () => {
  assert.ok(Math.abs(eloHomeProb(1500, 1500) - 1 / (1 + 10 ** -0.25)) < 1e-12)
  assert.equal(kinds(gameReasons(row(eloHomeProb(1550, 1500)), null))['Beyond Elo'], undefined)
  assert.equal(kinds(gameReasons(row(0.8), null))['Beyond Elo'], 'context')
})

test('games-v2 adds opponent-adjusted ratings, an expected margin and common opponents as reasons, and only for rows the v2 model scored', () => {
  const v2 = { model_version: 'games-v2', srs_home: 5.2, srs_away: -1.4, pred_margin: 8.1, co_diff: 0.6 }
  const rs = gameReasons(row(0.72, v2), null)
  const k = kinds(rs)
  assert.equal(k['Opponent-adjusted rating'], 'for'); assert.equal(k['Common opponents'], 'for'); assert.equal(k['Expected margin'], 'context')
  assert.match(rs.find((r) => r.label === 'Expected margin')!.text, /GSW to win by about 8\.1 points/)
  const road = kinds(gameReasons(row(0.4, { ...v2, srs_home: -2, srs_away: 4, pred_margin: -2.5, co_diff: -0.5 }), null))
  assert.equal(road['Opponent-adjusted rating'], 'for', 'the road favourite is the better-rated team')
  assert.equal(road['Common opponents'], 'for')
  const v1 = kinds(gameReasons(row(0.72), null))
  assert.equal(v1['Opponent-adjusted rating'], undefined); assert.equal(v1['Common opponents'], undefined)
})
