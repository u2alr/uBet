import assert from 'node:assert/strict'
import { test } from 'node:test'
import { combineLegs, conflicts, parlayLabel, teamLegKey, teamLegsFromGames, type GameForTeamBets } from './teamBets.ts'

const game = (id: string, home: string, away: string, odds: GameForTeamBets['odds'], state: GameForTeamBets['state'] = 'pre'): GameForTeamBets =>
  ({ id, date: '2026-11-01T00:00:00Z', state, home: { abbr: home, name: `${home} Team` }, away: { abbr: away, name: `${away} Team` }, odds })

test('every game with a price gives both sides, and the two chances add to one', () => {
  const legs = teamLegsFromGames([game('1', 'GSW', 'ATL', { homeWinProb: 0.6, bestMoneyline: { home: 1.7, away: 2.3 } })])
  assert.equal(legs.length, 2)
  const [h, a] = legs
  assert.deepEqual([h.team, h.opponent, h.home, h.price], ['GSW', 'ATL', true, 1.7])
  assert.deepEqual([a.team, a.opponent, a.home, a.price], ['ATL', 'GSW', false, 2.3])
  assert.ok(Math.abs(h.marketProb + a.marketProb - 1) < 1e-12)
})

test('a price is never invented: no odds, no probability, a bad price, or a game already started gives no legs', () => {
  assert.equal(teamLegsFromGames([game('1', 'A', 'B', null)]).length, 0)
  assert.equal(teamLegsFromGames([game('1', 'A', 'B', { homeWinProb: null, bestMoneyline: { home: 1.7, away: 2.3 } })]).length, 0)
  assert.equal(teamLegsFromGames([game('1', 'A', 'B', { homeWinProb: 0.5, bestMoneyline: { home: 1, away: 2.3 } })]).length, 0)
  assert.equal(teamLegsFromGames([game('1', 'A', 'B', { homeWinProb: 0.5, bestMoneyline: null })]).length, 0)
  assert.equal(teamLegsFromGames([game('1', 'A', 'B', { homeWinProb: 0.5, bestMoneyline: { home: 1.9, away: 1.9 } }, 'in')]).length, 0)
})

test('abbreviations are normalised with the supplied function', () => {
  const legs = teamLegsFromGames([game('1', 'GS', 'NY', { homeWinProb: 0.5, bestMoneyline: { home: 1.9, away: 1.9 } })], (a) => ({ GS: 'GSW', NY: 'NYK' } as Record<string, string>)[a] ?? a)
  assert.deepEqual(legs.map((l) => l.team), ['GSW', 'NYK'])
})

test('two teams from one game conflict; teams from different games do not', () => {
  const legs = teamLegsFromGames([game('1', 'GSW', 'ATL', { homeWinProb: 0.6, bestMoneyline: { home: 1.7, away: 2.3 } }), game('2', 'LAL', 'MIN', { homeWinProb: 0.55, bestMoneyline: { home: 1.8, away: 2.1 } })])
  assert.equal(conflicts([legs[0], legs[1]]), true)
  assert.equal(conflicts([legs[0], legs[2]]), false)
  assert.notEqual(teamLegKey(legs[0]), teamLegKey(legs[1]))
})

test('a four-team parlay multiplies prices and chances, and labels the teams in order', () => {
  const picks = [{ price: 1.7, prob: 0.58, team: 'ATL' }, { price: 2.0, prob: 0.49, team: 'GSW' }, { price: 1.5, prob: 0.65, team: 'MIN' }, { price: 1.9, prob: 0.51, team: 'LAL' }]
  const c = combineLegs(picks)
  assert.ok(Math.abs(c.odds - 1.7 * 2.0 * 1.5 * 1.9) < 1e-9)
  assert.ok(Math.abs(c.prob - 0.58 * 0.49 * 0.65 * 0.51) < 1e-12)
  assert.ok(Math.abs(c.ev - (c.prob * c.odds - 1)) < 1e-12)
  assert.equal(parlayLabel(picks), 'ATL + GSW + MIN + LAL')
  assert.deepEqual(combineLegs([]), { odds: 1, prob: 1, ev: 0 })
})
