import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOddsBlaze, type BlazeOdd, type BlazeResponse } from './oddsblaze.ts'
import { buildPicks } from './picks.ts'

const odd = (id: string, market: string, side: string, line: number, price: string, player = 'Jayson Tatum'): BlazeOdd => ({
  id, market, price, selection: { name: player, side, line }, player: { name: player },
})
const ev = (id: string, odds: BlazeOdd[], live = false) => ({
  id, date: '2026-10-21T23:00:00Z', live, teams: { away: { name: 'Boston Celtics' }, home: { name: 'New York Knicks' } }, odds,
})
const resp = (book: string, events: ReturnType<typeof ev>[]): BlazeResponse => ({ sportsbook: { id: book, name: book }, events })

test('merges books by event id and keeps odds ids', () => {
  const a = resp('draftkings', [ev('E1', [odd('dk-o', 'Player Points', 'Over', 27.5, '1.91'), odd('dk-u', 'Player Points', 'Under', 27.5, '1.91')])])
  const b = resp('caesars', [ev('E1', [odd('cz-o', 'Player Points', 'Over', 27.5, '1.87')])])
  const { events, stats } = normalizeOddsBlaze([a, b])
  assert.equal(events.length, 1)
  assert.equal(events[0].bookmakers!.length, 2)
  assert.equal(events[0].bookmakers![0].markets[0].key, 'player_points')
  assert.equal(events[0].bookmakers![0].markets[0].outcomes[0].id, 'dk-o')
  assert.equal(events[0].bookmakers![0].markets[0].outcomes[0].price, 1.91)
  assert.equal(stats.kept, 3)
})

test('drops live events, unknown markets, bad sides, prices and lines', () => {
  const r = resp('draftkings', [
    ev('L', [odd('x', 'Player Points', 'Over', 20.5, '1.9')], true),
    ev('E', [
      odd('a', 'Player Steals', 'Over', 1.5, '1.9'),
      odd('b', 'Player Points', 'Yes', 20.5, '1.9'),
      odd('c', 'Player Points', 'Over', 20.5, 'abc'),
      odd('d', 'Player Points', 'Over', 20.5, '1'),
      { ...odd('e', 'Player Points', 'Over', 20.5, '1.9'), selection: { side: 'Over' } },
      odd('f', 'Player Points', 'Over', 20.5, '1.9'),
    ]),
  ])
  const { events, stats } = normalizeOddsBlaze([r])
  assert.equal(stats.kept, 1)
  assert.equal(stats.skipped.live, 1)
  assert.equal(stats.skipped.market, 1)
  assert.equal(stats.skipped.side, 1)
  assert.equal(stats.skipped.price, 2)
  assert.equal(stats.skipped.line, 1)
  assert.equal(events[0].bookmakers![0].markets[0].outcomes.length, 1)
})

test('an event with nothing usable adds no book', () => {
  const { events } = normalizeOddsBlaze([resp('draftkings', [ev('E', [odd('a', 'Player Steals', 'Over', 1.5, '1.9')])])])
  assert.equal(events[0].bookmakers!.length, 0)
})

test('picks carry odds id, event id and number of two-sided books', () => {
  const lines = (book: string, p: string) => resp(book, [ev('E1', [
    odd(`${book}-o`, 'Player Points', 'Over', 27.5, p, 'Jaylen Brown'), odd(`${book}-u`, 'Player Points', 'Under', 27.5, p, 'Jaylen Brown')])])
  const { events } = normalizeOddsBlaze([lines('draftkings', '1.91'), lines('fanatics', '1.95')])
  const hist = Array.from({ length: 15 }, () => ({ player_id: 7, type: 'regular' as const, pts: 26, reb: 0, ast: 0, fg3m: 0 }))
  const { picks } = buildPicks({
    events, players: [{ id: 7, name: 'Jaylen Brown', team: 'BOS' }], history: hist, projections: [],
    now: Date.parse('2026-10-21T12:00:00Z'), selection: 'all',
  })
  assert.ok(picks.length >= 2)
  const over = picks.find((p) => p.side === 'over')!
  assert.equal(over.eventId, 'E1')
  assert.equal(over.marketBooks, 2)
  assert.equal(over.oddsId, 'fanatics-o')
})
