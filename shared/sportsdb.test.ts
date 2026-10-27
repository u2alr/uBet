import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSportsDbEvents } from './sportsdb.ts'

const abbr = (n: string) => ({ 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN' } as Record<string, string>)[n]

test('maps upcoming events to games and reads the timestamp as UTC', () => {
  const g = parseSportsDbEvents({ events: [{ idEvent: '1', strTimestamp: '2026-10-27T23:30:00', strHomeTeam: 'Boston Celtics', strAwayTeam: 'Brooklyn Nets' }] }, abbr)
  assert.equal(g.length, 1)
  assert.equal(g[0].date, '2026-10-27T23:30:00.000Z')
  assert.equal(g[0].home.abbr, 'BOS')
  assert.equal(g[0].state, 'pre')
})

test('skips events with unknown teams, bad times or a missing feed', () => {
  assert.equal(parseSportsDbEvents({ events: [{ idEvent: '2', strTimestamp: 'nope', strHomeTeam: 'Boston Celtics', strAwayTeam: 'Brooklyn Nets' }, { idEvent: '3', strTimestamp: '2026-10-27T23:30:00', strHomeTeam: 'Nobody', strAwayTeam: 'Brooklyn Nets' }] }, abbr).length, 0)
  assert.equal(parseSportsDbEvents(null, abbr).length, 0)
})
