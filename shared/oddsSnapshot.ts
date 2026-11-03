// What the local odds sync stores in `odds_snapshot`, and how the Worker reads it back. Pure: no network, no database, no clock.
// Props are split by market so each stored row stays far below D1's statement size limit; reading puts the game back together.
import type { OddsBook, OddsEvent, OddsOutcome } from './picks.ts'
import type { GameOddsEvent } from './sharpapi.ts'
import { sqlValue } from './oddsArchive.ts'

export interface SnapshotRow {
  kind: 'games' | 'props'
  eventId: string
  /** '' for a game's team odds; the market key for props. */
  part: string
  commenceTime: string
  homeTeam: string
  awayTeam: string
  /** ms since the epoch: when the provider answered. */
  fetchedAt: number
  body: string
}

interface PropPart { key: string; title: string; outcomes: OddsOutcome[] }

const head = (e: { id: string; commence_time: string; home_team: string; away_team: string }) => ({ eventId: e.id, commenceTime: e.commence_time, homeTeam: e.home_team, awayTeam: e.away_team })

export function gamesRow(g: GameOddsEvent, fetchedAt: number): SnapshotRow {
  return { kind: 'games', part: '', ...head(g), fetchedAt, body: JSON.stringify(g.bookmakers) }
}

/** One row per market that has quotes. A quote's provider id is dropped: nothing reads it back, and it is most of the size. */
export function propsRows(ev: OddsEvent, fetchedAt: number): SnapshotRow[] {
  const parts = new Map<string, PropPart[]>()
  for (const b of ev.bookmakers ?? [])
    for (const m of b.markets) {
      if (!m.outcomes.length) continue
      const list = parts.get(m.key) ?? parts.set(m.key, []).get(m.key)!
      list.push({ key: b.key, title: b.title, outcomes: m.outcomes.map(({ id: _id, ...o }) => o) })
    }
  return [...parts].map(([part, books]) => ({ kind: 'props' as const, part, ...head(ev), fetchedAt, body: JSON.stringify(books) }))
}

export function upsertSql(r: SnapshotRow): string {
  return `INSERT OR REPLACE INTO odds_snapshot (kind, event_id, part, commence_time, home_team, away_team, fetched_at, body) VALUES (${[r.kind, r.eventId, r.part, r.commenceTime, r.homeTeam, r.awayTeam, r.fetchedAt, r.body].map(sqlValue).join(', ')});`
}

/** Removes everything for a game and its markets before a new snapshot of it is written, so a market that disappeared does not linger. */
export const clearEventSql = (kind: SnapshotRow['kind'], eventId: string) => `DELETE FROM odds_snapshot WHERE kind = ${sqlValue(kind)} AND event_id = ${sqlValue(eventId)};`
/** Games that started more than a day ago are of no use to anyone. */
export const pruneSql = (now: number) => `DELETE FROM odds_snapshot WHERE commence_time < ${sqlValue(new Date(now - 24 * 3600_000).toISOString())};`

export interface StoredRow { event_id: string; part: string; commence_time: string; home_team: string; away_team: string; fetched_at: number; body: string }

const parse = <T>(s: string): T | null => { try { return JSON.parse(s) as T } catch { return null } }

export function assembleGames(rows: StoredRow[]): GameOddsEvent[] {
  const out: GameOddsEvent[] = []
  for (const r of rows) {
    const bookmakers = parse<GameOddsEvent['bookmakers']>(r.body)
    if (bookmakers) out.push({ id: r.event_id, commence_time: r.commence_time, home_team: r.home_team, away_team: r.away_team, bookmakers })
  }
  return out.sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
}

/** One game's props from its stored markets. `fetchedAt` is the OLDEST market's time, so the age shown is never flattering. Null when nothing is stored. */
export function assembleProps(rows: StoredRow[]): { event: OddsEvent; fetchedAt: number } | null {
  if (!rows.length) return null
  const books = new Map<string, OddsBook>()
  for (const r of rows) {
    for (const p of parse<PropPart[]>(r.body) ?? []) {
      const b = books.get(p.key) ?? books.set(p.key, { key: p.key, title: p.title, markets: [] }).get(p.key)!
      b.markets.push({ key: r.part, outcomes: p.outcomes })
    }
  }
  const r0 = rows[0]
  return {
    event: { id: r0.event_id, commence_time: r0.commence_time, home_team: r0.home_team, away_team: r0.away_team, bookmakers: [...books.values()] },
    fetchedAt: Math.min(...rows.map((r) => r.fetched_at)),
  }
}
