import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOddsApi, type ApiEventOdds } from './oddsapi.ts'

const ev = (): ApiEventOdds => ({
  id: 'e1', commence_time: '2026-10-22T00:00:00Z', home_team: 'Boston Celtics', away_team: 'Detroit Pistons',
  bookmakers: [
    { key: 'fanduel', title: 'FanDuel', last_update: '2026-10-21T20:00:00Z', markets: [{ key: 'player_points', last_update: '2026-10-21T20:01:00Z', outcomes: [
      { name: 'Over', description: 'Jayson Tatum', price: 1.9, point: 27.5 }, { name: 'Under', description: 'Jayson Tatum', price: 1.9, point: 27.5 }] }] },
    { key: 'betmgm', title: 'BetMGM', markets: [{ key: 'player_points', outcomes: [{ name: 'Over', description: 'Jayson Tatum', price: 1.9, point: 27.5 }] }] },
    { key: 'bet365', title: 'bet365', last_update: '2026-10-21T20:02:00Z', markets: [{ key: 'player_points', outcomes: [
      { name: 'Over', description: 'Jayson Tatum', price: 1.95, point: 27.5 }, { name: 'Yes', description: 'x', price: 2, point: 1 }, { name: 'Under', description: 'Jayson Tatum', price: 1, point: 27.5 }] }] },
  ],
})

test('only FanDuel, DraftKings and bet365 are kept; other books are counted and dropped', () => {
  const { events, stats } = normalizeOddsApi([ev()])
  assert.deepEqual(events[0].bookmakers!.map((b) => b.key), ['fanduel', 'bet365'])
  assert.equal(stats.skipped.book, 1)
  assert.deepEqual(stats.booksSeen, ['bet365', 'betmgm', 'fanduel'])
})

test('bad sides and prices are skipped, and timestamps say where they came from', () => {
  const { events, stats } = normalizeOddsApi([ev()])
  assert.equal(stats.skipped.side, 1); assert.equal(stats.skipped.price, 1); assert.equal(stats.kept, 3)
  const fd = events[0].bookmakers![0].markets[0].outcomes[0]
  assert.equal(fd.updatedSource, 'quote'); assert.equal(fd.updated, '2026-10-21T20:01:00Z')
  const b365 = events[0].bookmakers![1].markets[0].outcomes[0]
  assert.equal(b365.updatedSource, 'feed'); assert.equal(b365.updated, '2026-10-21T20:02:00Z')
})
