import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PLAYERS_PER_QUERY, chunk, groupMeetings, parsePairs, type H2HRow } from './h2h.ts'

const row = (id: number, opp: string, date: string): H2HRow => ({ id, opp, date, minutes: 30, pts: 20, reb: 5, ast: 5, fg3m: 2 })

test('pairs are validated strictly and malformed input is refused as a whole', () => {
  assert.deepEqual(parsePairs(['12:BOS', '7:LAL']), [{ id: 12, opp: 'BOS' }, { id: 7, opp: 'LAL' }])
  for (const bad of ['x', '12:bos', '12:', ':BOS', '12:BOSTON', "1:BO'S", '-5:BOS']) assert.equal(parsePairs(['1:BOS', bad]), null, bad)
})

test('one query never binds more than D1 allows: 50 players + 30 teams stays under 100', () => {
  const players = Array.from({ length: 200 }, (_, i) => i + 1)
  const parts = chunk(players, MAX_PLAYERS_PER_QUERY)
  assert.equal(parts.length, 4)
  assert.ok(parts.every((p) => p.length + 30 <= 100))
  assert.deepEqual(parts.flat(), players, 'nothing is lost or duplicated')
  assert.deepEqual(chunk([], 5), [])
})

test('meetings are kept per requested pair only, newest first, capped', () => {
  const rows = [row(1, 'BOS', '2026-04-01'), row(1, 'BOS', '2026-02-01'), row(1, 'NYK', '2026-03-01'), row(2, 'BOS', '2026-01-01'), ...Array.from({ length: 12 }, (_, i) => row(3, 'BOS', `2025-${String(i + 1).padStart(2, '0')}-01`))]
  const out = groupMeetings(rows, [{ id: 1, opp: 'BOS' }, { id: 3, opp: 'BOS' }])
  assert.deepEqual(Object.keys(out).sort(), ['1:BOS', '3:BOS'])
  assert.deepEqual(out['1:BOS'].map((r) => r.date), ['2026-04-01', '2026-02-01'])
  assert.equal(out['3:BOS'].length, 8)
})
