import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assembleGames, assembleProps, clearEventSql, gamesRow, propsRows, pruneSql, upsertSql, type StoredRow } from './oddsSnapshot.ts'
import type { OddsEvent } from './picks.ts'
import type { GameOddsEvent } from './sharpapi.ts'

const ev: OddsEvent = {
  id: 'nba_a_b', commence_time: '2026-11-03T00:10:00.000Z', home_team: 'B Team', away_team: 'A Team',
  bookmakers: [
    { key: 'draftkings', title: 'DraftKings', markets: [
      { key: 'player_points', outcomes: [{ name: 'Over', description: 'Ann', price: 1.9, point: 20.5, id: 'x1', updated: 't' }, { name: 'Under', description: 'Ann', price: 1.9, point: 20.5, id: 'x2', updated: 't' }] },
      { key: 'player_assists', outcomes: [{ name: 'Over', description: 'Ann', price: 2, point: 5.5 }] },
    ] },
    { key: 'fanduel', title: 'FanDuel', markets: [{ key: 'player_points', outcomes: [{ name: 'Over', description: 'Ann', price: 1.95, point: 20.5 }] }, { key: 'player_rebounds', outcomes: [] }] },
  ],
}
const stored = (rows: ReturnType<typeof propsRows>): StoredRow[] => rows.map((r) => ({ event_id: r.eventId, part: r.part, commence_time: r.commenceTime, home_team: r.homeTeam, away_team: r.awayTeam, fetched_at: r.fetchedAt, body: r.body }))

test('props are stored one row per market, and read back as the same game with every book and quote', () => {
  const rows = propsRows(ev, 1000)
  assert.deepEqual(rows.map((r) => r.part).sort(), ['player_assists', 'player_points'], 'an empty market is not stored')
  const back = assembleProps(stored(rows))!
  assert.equal(back.event.id, 'nba_a_b')
  assert.equal(back.event.home_team, 'B Team')
  const dk = back.event.bookmakers!.find((b) => b.key === 'draftkings')!
  assert.deepEqual(dk.markets.map((m) => m.key).sort(), ['player_assists', 'player_points'])
  assert.equal(dk.markets.find((m) => m.key === 'player_points')!.outcomes.length, 2)
  assert.equal(back.event.bookmakers!.find((b) => b.key === 'fanduel')!.markets.length, 1)
})

test('the stored quotes keep what the engine reads (side, player, price, line, time) and drop the provider id', () => {
  const [pts] = propsRows(ev, 1000).filter((r) => r.part === 'player_points')
  const o = JSON.parse(pts.body)[0].outcomes[0]
  assert.deepEqual(o, { name: 'Over', description: 'Ann', price: 1.9, point: 20.5, updated: 't' })
})

test('a game is as old as its oldest market, and nothing stored reads as null rather than an empty game', () => {
  const a = stored(propsRows(ev, 1000))
  a[0].fetched_at = 500
  assert.equal(assembleProps(a)!.fetchedAt, 500)
  assert.equal(assembleProps([]), null)
})

test('team odds round-trip and come back in start order; a corrupt row is skipped, not fatal', () => {
  const g = (id: string, at: string): GameOddsEvent => ({ id, commence_time: at, home_team: 'H', away_team: 'A', bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: [{ key: 'h2h', outcomes: [{ name: 'H', price: 1.5 }] }] }] })
  const rows = [gamesRow(g('late', '2026-11-04T00:00:00.000Z'), 1), gamesRow(g('early', '2026-11-03T00:00:00.000Z'), 1)].map((r) => ({ event_id: r.eventId, part: r.part, commence_time: r.commenceTime, home_team: r.homeTeam, away_team: r.awayTeam, fetched_at: r.fetchedAt, body: r.body }))
  rows.push({ ...rows[0], event_id: 'bad', body: '{not json' })
  assert.deepEqual(assembleGames(rows).map((x) => x.id), ['early', 'late'])
})

test('the SQL quotes every value, so a name with an apostrophe cannot break or inject into a statement', () => {
  const sql = upsertSql({ ...propsRows(ev, 1)[0], homeTeam: "O'Brien's Team" })
  assert.match(sql, /'O''Brien''s Team'/)
  assert.match(clearEventSql('props', "x'; DROP TABLE players;--"), /'x''; DROP TABLE players;--'/)
  assert.match(pruneSql(Date.parse('2026-11-03T00:00:00Z')), /'2026-11-02T00:00:00.000Z'/)
})
