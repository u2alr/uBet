import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commonLean, teamForm, type TeamResult } from './teamForm.ts'

const r = (date: string, team: string, opp: string, won: boolean, home = true): TeamResult => ({ date, team, opp, won, home })
// Each real game appears from both sides, as the database stores it.
const game = (date: string, winner: string, loser: string, home = winner): TeamResult[] => [r(date, winner, loser, true, home === winner), r(date, loser, winner, false, home !== winner)]

test('the ATL / MEM example: ATL beat the Lakers and MEM lost to them, so the Lakers game favours ATL', () => {
  const f = teamForm('ATL', 'MEM', [...game('2026-10-20', 'ATL', 'LAL'), ...game('2026-10-22', 'LAL', 'MEM')])
  assert.equal(f.common.length, 1)
  assert.equal(f.common[0].opp, 'LAL')
  assert.equal(f.common[0].verdict, 'a')
  assert.deepEqual(f.tally, { a: 1, b: 0, even: 0 })
  assert.equal(commonLean(f), 'a')
})

test('the same result against a common opponent says nothing, and is counted as even', () => {
  const f = teamForm('ATL', 'MEM', [...game('2026-10-20', 'ATL', 'LAL'), ...game('2026-10-22', 'MEM', 'LAL')])
  assert.equal(f.common[0].verdict, 'even')
  assert.equal(commonLean(f), null)
})

test('a direct meeting is counted once, however many rows the box scores gave, and games show who won and who hosted', () => {
  const f = teamForm('ATL', 'MEM', [...game('2026-10-25', 'MEM', 'ATL'), ...game('2026-01-10', 'ATL', 'MEM', 'MEM')])
  assert.deepEqual(f.meetings.map((m) => [m.date, m.winner, m.home]), [['2026-10-25', 'MEM', 'MEM'], ['2026-01-10', 'ATL', 'MEM']])
  assert.equal(f.aWins, 1)
  assert.equal(f.bWins, 1)
})

test('an opponent only one team has played is not a common opponent, and the two teams themselves are excluded', () => {
  const f = teamForm('ATL', 'MEM', [...game('2026-10-20', 'ATL', 'LAL'), ...game('2026-10-21', 'ATL', 'MEM')])
  assert.equal(f.common.length, 0)
  assert.equal(f.meetings.length, 1)
})

test('only each team\'s most recent games against an opponent count, and the newest decides the verdict', () => {
  const f = teamForm('ATL', 'MEM', [...game('2026-10-01', 'LAL', 'ATL'), ...game('2026-10-20', 'ATL', 'LAL'), ...game('2026-10-22', 'LAL', 'MEM')])
  assert.equal(f.common[0].a.length, 2)
  assert.equal(f.common[0].verdict, 'a', 'ATL\'s newest result (a win) against MEM\'s loss')
})

test('asOf judges a past game with only what was known before it', () => {
  const rows = [...game('2026-10-20', 'ATL', 'LAL'), ...game('2026-10-22', 'LAL', 'MEM'), ...game('2026-11-05', 'MEM', 'ATL')]
  assert.equal(teamForm('ATL', 'MEM', rows, '2026-11-05').meetings.length, 0)
  assert.equal(teamForm('ATL', 'MEM', rows).meetings.length, 1)
})

test('the lean follows the larger tally and is null when it is level', () => {
  const rows = [...game('2026-10-01', 'ATL', 'LAL'), ...game('2026-10-02', 'LAL', 'MEM'), ...game('2026-10-03', 'ATL', 'BOS'), ...game('2026-10-04', 'BOS', 'MEM'), ...game('2026-10-05', 'LAL', 'ATL', 'LAL')]
  const f = teamForm('ATL', 'MEM', rows)
  assert.equal(f.tally.a >= 1, true)
  assert.ok(['a', 'b', null].includes(commonLean(f)))
  assert.equal(commonLean(teamForm('ATL', 'MEM', [])), null)
})
