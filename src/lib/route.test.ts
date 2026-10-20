import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOME, formatRoute, parseRoute, type Route } from './route.ts'

test('every kind of route survives a format then parse', () => {
  const routes: Route[] = [
    HOME,
    { tab: 'Today', gameId: '401909834', playerId: null },
    { tab: 'Players', gameId: null, playerId: 1631114 },
    { tab: 'Players', gameId: null, playerId: null },
    { tab: 'Minds', gameId: null, playerId: null },
    { tab: 'Slip', gameId: null, playerId: null },
    { tab: 'Results', gameId: null, playerId: null },
  ]
  for (const r of routes) assert.deepEqual(parseRoute(formatRoute(r)), r, formatRoute(r))
})

test('an empty, unknown or hand-edited hash lands on the home page instead of failing', () => {
  for (const h of ['', '#', '#/', '#/nope', '#/Today/game/', '#/Today/game/../../x', '#/Players/abc', '#/Players/-5', '#/Players/99999999999999', '#/Today/game/<script>'])
    assert.equal(parseRoute(h).playerId, null, h)
  assert.deepEqual(parseRoute(''), HOME)
  assert.deepEqual(parseRoute('#/nope'), HOME)
  assert.equal(parseRoute('#/Today/game/../../x').gameId, null)
})

test('tab names are case-insensitive, and extra segments are ignored', () => {
  assert.equal(parseRoute('#/minds').tab, 'Minds')
  assert.equal(parseRoute('#/PLAYERS/7').playerId, 7)
  assert.equal(parseRoute('#/Minds/whatever').tab, 'Minds')
})

test('ids are only carried by the tab that uses them', () => {
  assert.equal(formatRoute({ tab: 'Minds', gameId: 'x', playerId: 5 }), '#/Minds')
  assert.equal(formatRoute({ tab: 'Today', playerId: 5 }), '#/Today')
})
