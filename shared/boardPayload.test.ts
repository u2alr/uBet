// Run: npm test. The picks payload must never drop a posted market, merge distinct markets, or cut single sides.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPicks, etDate, type HistoryRow, type OddsEvent, type PlayerRow, type ProjectionRow } from './picks.ts'
import { MAX_PICKS, boardPayload, slim } from './boardPayload.ts'
import { mkPick, resetFixtureCounter } from './engine/fixtures.ts'

const NOW = Date.parse('2026-10-20T15:00:00Z')
const TIP = '2026-10-21T00:30:00Z'
const DATE = etDate(TIP)
const vals = [24, 27, 22, 30, 19, 25, 28, 21, 26, 23, 29, 20, 24, 27, 25]
const stamp = (h: number) => new Date(NOW - h * 3600_000).toISOString().slice(0, 19).replace('T', ' ')

/** `n` players, each with one line quoted by two books on both sides. */
function slate(n: number, opts: { alternateLines?: boolean; eventId?: string; duplicateBook?: boolean } = {}) {
  const players: PlayerRow[] = [], history: HistoryRow[] = [], projections: ProjectionRow[] = []
  const bookmakers = ['DraftKings', 'FanDuel'].map((title) => ({ key: title.toLowerCase(), title, markets: [{ key: 'player_points', outcomes: [] as { name: string; description: string; price: number; point: number }[] }] }))
  for (let i = 1; i <= n; i++) {
    const name = `Player ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x${i}`
    players.push({ id: i, name, team: 'BOS' })
    for (const v of vals) history.push({ player_id: i, type: 'regular', pts: v, reb: 0, ast: 0, fg3m: 0 })
    projections.push({ player_id: i, game_date: DATE, stat: 'pts', mean: 24.8, alpha: 0.08, model: 'gbm-v1', created_at: stamp(3) })
    const lines = opts.alternateLines ? [22.5, 24.5, 26.5] : [24.5]
    for (const point of lines) for (const b of bookmakers) {
      b.markets[0].outcomes.push({ name: 'Over', description: name, price: 1.9, point }, { name: 'Under', description: name, price: 1.9, point })
      if (opts.duplicateBook) b.markets[0].outcomes.push({ name: 'Over', description: name, price: 1.85, point })        // the same quote listed twice
    }
  }
  const events: OddsEvent[] = [{ id: opts.eventId ?? 'e1', commence_time: TIP, home_team: 'Detroit Pistons', away_team: 'Boston Celtics', bookmakers }]
  return { events, players, history, projections, now: NOW }
}

describe('every side of every posted line is returned (the old endpoint kept at most 80, by value)', () => {
  it('120 players, all of them, both sides: 240 picks, none dropped by selection', () => {
    const r = buildPicks({ ...slate(120), selection: 'all' })
    assert.equal(r.picks.length, 240)
    const best = buildPicks({ ...slate(120), selection: 'best' })
    assert.ok(best.picks.length <= 80, 'the legacy selection still truncates; the Worker no longer uses it')
    const out = boardPayload(r.picks)
    assert.equal(out.picks.length, 240)
    assert.equal(out.coverage.total, 240); assert.equal(out.coverage.returned, 240); assert.deepEqual(out.coverage.omitted, [])
  })
  it('both sides of one line are both present and know the other exists', () => {
    const r = buildPicks({ ...slate(3), selection: 'all' })
    for (const id of [1, 2, 3]) {
      const sides = r.picks.filter((p) => p.playerId === id)
      assert.deepEqual(sides.map((p) => p.side).sort(), ['over', 'under'])
      assert.ok(sides.every((p) => p.counterpart === 'posted'))
    }
  })
  it('a side no book quotes is marked not_posted, which is different from a side that was dropped', () => {
    const s = slate(1)
    s.events[0].bookmakers![0].markets[0].outcomes = s.events[0].bookmakers![0].markets[0].outcomes.filter((o) => o.name === 'Over')
    s.events[0].bookmakers![1].markets[0].outcomes = s.events[0].bookmakers![1].markets[0].outcomes.filter((o) => o.name === 'Over')
    const r = buildPicks({ ...s, selection: 'all' })
    assert.equal(r.picks.length, 1)
    assert.equal(r.picks[0].side, 'over'); assert.equal(r.picks[0].counterpart, 'not_posted')
  })
  it('alternate lines are separate markets and none is lost', () => {
    const r = buildPicks({ ...slate(10, { alternateLines: true }), selection: 'all' })
    assert.equal(r.picks.length, 10 * 3 * 2)
    assert.deepEqual([...new Set(r.picks.filter((p) => p.playerId === 1).map((p) => p.line))].sort(), [22.5, 24.5, 26.5])
  })
  it('duplicate quotes from one book collapse to one price per book and do not create extra picks', () => {
    const r = buildPicks({ ...slate(5, { duplicateBook: true }), selection: 'all' })
    assert.equal(r.picks.length, 10)
    const over = r.picks.find((p) => p.side === 'over')!
    assert.equal(over.prices.length, 2); assert.equal(over.price, 1.9, 'the better of the duplicate quotes at the same book is kept')
  })
  it('the same line for the same player in two different games is two markets', () => {
    const a = slate(1, { eventId: 'gameA' }), b = slate(1, { eventId: 'gameB' })
    const r = buildPicks({ events: [...a.events, ...b.events], players: a.players, history: a.history, projections: a.projections, now: NOW, selection: 'all' })
    assert.equal(r.picks.length, 4)
    const out = boardPayload(r.picks)
    assert.deepEqual(out.coverage.events.map((e) => e.eventId).sort(), ['gameA', 'gameB'])
  })
})

describe('the response limit removes whole games, never single sides, and says so', () => {
  const mk = (eventId: string, game: string, date: string, n: number) => Array.from({ length: n }, (_, i) => ({ ...mkPick({ playerId: 1000 + i }), eventId, game, gameDate: date }))
  it('over the cap the latest games are omitted whole and listed; the earliest game is always sent', () => {
    resetFixtureCounter()
    const picks = [...mk('g1', 'A @ B', '2026-10-21', 60), ...mk('g2', 'C @ D', '2026-10-22', 60), ...mk('g3', 'E @ F', '2026-10-23', 60)]
    const out = boardPayload(picks, { maxPicks: 130 })
    assert.equal(out.picks.length, 120)
    assert.deepEqual(out.coverage.omitted.map((e) => e.eventId), ['g3'])
    assert.equal(out.coverage.total, 180); assert.equal(out.coverage.events.length, 3)
    const tiny = boardPayload(picks, { maxPicks: 10 })
    assert.equal(tiny.picks.length, 60, 'the first game is never cut in half')
  })
  it('a single game can be requested by id (pagination by game)', () => {
    const picks = [...mk('g1', 'A @ B', '2026-10-21', 5), ...mk('g2', 'C @ D', '2026-10-22', 7)]
    const out = boardPayload(picks, { event: 'g2' })
    assert.equal(out.picks.length, 7); assert.ok(out.picks.every((p) => p.eventId === 'g2'))
    assert.equal(out.coverage.events.length, 2, 'coverage still lists every game')
    assert.equal(boardPayload(picks, { event: 'nope' }).picks.length, 0)
  })
  it('the default cap leaves room for fifteen full games, and the response drops the engine-only arrays', () => {
    assert.ok(MAX_PICKS >= 15 * 60)
    const p = mkPick({})
    assert.ok(p.bookQuotes && p.sideQuotes)
    const s = slim(p)
    assert.equal('bookQuotes' in s, false); assert.equal('sideQuotes' in s, false)
    assert.equal(s.player, p.player)
  })
})
