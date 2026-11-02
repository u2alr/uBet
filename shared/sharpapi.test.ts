import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSharpGames, normalizeSharpProps, type SharpQuote } from './sharpapi.ts'

const base = { event_id: 'nba_cavaliers_thunder_2026-11-02_b3', home_team: 'Cleveland Cavaliers', away_team: 'Oklahoma City Thunder', event_start_time: '2026-11-03T00:10Z', is_active: true, is_live: false, is_main_line: true }
const prop = (o: Partial<SharpQuote>): SharpQuote => ({ ...base, id: '1', sportsbook: 'draftkings', market_type: 'player_points', selection: 'Over', selection_type: 'over', odds_decimal: 1.9, line: 24.5, player_name: 'Evan Mobley', timestamp: '2026-11-02T11:00:00Z', ...o })

test('props are grouped into one event with a book per sportsbook and the market key the pick builder reads', () => {
  const { events, stats } = normalizeSharpProps([
    prop({}), prop({ id: '2', selection: 'Under', selection_type: 'under', odds_decimal: 1.9 }),
    prop({ id: '3', sportsbook: 'fanduel', market_type: 'player_made_threes', line: 1.5 }),
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0].commence_time, '2026-11-03T00:10:00.000Z')
  assert.deepEqual(events[0].bookmakers!.map((b) => [b.key, b.title]), [['draftkings', 'DraftKings'], ['fanduel', 'FanDuel']])
  assert.deepEqual(events[0].bookmakers![1].markets.map((m) => m.key), ['player_threes'])
  const o = events[0].bookmakers![0].markets[0].outcomes
  assert.deepEqual(o.map((x) => [x.name, x.description, x.point, x.price]), [['Over', 'Evan Mobley', 24.5, 1.9], ['Under', 'Evan Mobley', 24.5, 1.9]])
  assert.equal(o[0].updatedSource, 'quote')
  assert.equal(stats.kept, 3)
})

test('live, inactive, stale, unpriced and half-described quotes are counted and left out', () => {
  const { events, stats } = normalizeSharpProps([
    prop({ is_live: true }), prop({ is_active: false }), prop({ is_stale_pregame_price: true }),
    prop({ odds_decimal: 1 }), prop({ line: null }), prop({ player_name: undefined }),
    prop({ selection_type: 'home' }), prop({ sportsbook: 'pinnacle' }), prop({ market_type: 'player_blocks' }),
  ])
  assert.equal(events.length, 0)
  assert.deepEqual(stats.skipped, { book: 1, side: 1, price: 1, line: 1, player: 1, inactive: 3 })
  assert.deepEqual(stats.booksSeen, ['draftkings', 'pinnacle'])
})

test('the same quote arriving on two pages is kept once, as the newer one', () => {
  const { events, stats } = normalizeSharpProps([prop({ odds_decimal: 1.8, timestamp: '2026-11-02T11:00:00Z' }), prop({ odds_decimal: 2.0, timestamp: '2026-11-02T11:05:00Z' }), prop({ odds_decimal: 1.7, timestamp: '2026-11-02T10:00:00Z' })])
  assert.equal(stats.kept, 1)
  assert.equal(events[0].bookmakers![0].markets[0].outcomes[0].price, 2.0)
})

const team = (o: Partial<SharpQuote>): SharpQuote => ({ ...base, id: 't', sportsbook: 'draftkings', market_type: 'moneyline', selection: 'x', selection_type: 'home', odds_decimal: 1.556, line: null, player_name: undefined, ...o })

test('team markets come out in the h2h / spreads / totals shape, with outcomes named by the game\'s teams', () => {
  const [g] = normalizeSharpGames([
    team({}), team({ selection_type: 'away', odds_decimal: 2.5 }),
    team({ market_type: 'point_spread', line: -4.5, odds_decimal: 1.95 }), team({ market_type: 'point_spread', selection_type: 'away', line: 4.5, odds_decimal: 1.87 }),
    team({ market_type: 'total_points', selection_type: 'over', line: 228.5, odds_decimal: 1.95 }), team({ market_type: 'total_points', selection_type: 'under', line: 228.5, odds_decimal: 1.87 }),
    team({ market_type: 'point_spread', selection_type: 'home', line: null }),
  ])
  const m = Object.fromEntries(g.bookmakers[0].markets.map((x) => [x.key, x.outcomes]))
  assert.deepEqual(m.h2h, [{ name: 'Cleveland Cavaliers', price: 1.556 }, { name: 'Oklahoma City Thunder', price: 2.5 }])
  assert.deepEqual(m.spreads.map((o) => [o.name, o.point]), [['Cleveland Cavaliers', -4.5], ['Oklahoma City Thunder', 4.5]])
  assert.deepEqual(m.totals.map((o) => [o.name, o.point]), [['Over', 228.5], ['Under', 228.5]])
})
