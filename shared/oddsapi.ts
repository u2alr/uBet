// Turns The Odds API v4 per-event responses into the OddsEvent shape the pick builder uses. Pure: no network, no clock.
// Only the books we trust to quote both sides are kept. bet365 is listed under the uk/eu regions, DraftKings and FanDuel under us.
import type { OddsBook, OddsEvent, OddsOutcome } from './picks.ts'

export const ODDS_API_BOOKS = ['fanduel', 'draftkings', 'bet365']
export const ODDS_API_REGIONS = 'us,uk,eu'
export const ODDS_API_MARKETS = 'player_points,player_rebounds,player_assists,player_threes'

export interface ApiOutcome { name: string; description?: string; price: number; point?: number }
export interface ApiMarket { key: string; last_update?: string; outcomes: ApiOutcome[] }
export interface ApiBook { key: string; title: string; last_update?: string; markets: ApiMarket[] }
export interface ApiEventOdds { id: string; commence_time: string; home_team: string; away_team: string; bookmakers: ApiBook[] }

export interface ApiStats { kept: number; skipped: { book: number; side: number; price: number; line: number; player: number }; booksSeen: string[] }

/** Each market has its own last_update, so quotes get a 'quote' timestamp; the book's last_update is the fallback ('feed'). */
export function normalizeOddsApi(events: ApiEventOdds[], allowed: readonly string[] = ODDS_API_BOOKS): { events: OddsEvent[]; stats: ApiStats } {
  const stats: ApiStats = { kept: 0, skipped: { book: 0, side: 0, price: 0, line: 0, player: 0 }, booksSeen: [] }
  const seen = new Set<string>()
  const out: OddsEvent[] = []
  for (const e of events) {
    const books: OddsBook[] = []
    for (const b of e.bookmakers ?? []) {
      seen.add(b.key)
      if (!allowed.includes(b.key)) { stats.skipped.book += b.markets.reduce((a, m) => a + m.outcomes.length, 0); continue }
      const markets = b.markets.map((m) => {
        const outcomes: OddsOutcome[] = []
        for (const o of m.outcomes) {
          if (o.name !== 'Over' && o.name !== 'Under') { stats.skipped.side++; continue }
          if (!Number.isFinite(o.price) || o.price <= 1) { stats.skipped.price++; continue }
          if (typeof o.point !== 'number' || !Number.isFinite(o.point)) { stats.skipped.line++; continue }
          if (!o.description) { stats.skipped.player++; continue }
          const updated = m.last_update ?? b.last_update
          outcomes.push({ name: o.name, description: o.description, price: o.price, point: o.point, updated, updatedSource: m.last_update ? 'quote' : 'feed' })
          stats.kept++
        }
        return { key: m.key, outcomes }
      }).filter((m) => m.outcomes.length)
      if (markets.length) books.push({ key: b.key, title: b.title, markets })
    }
    if (books.length) out.push({ id: e.id, commence_time: e.commence_time, home_team: e.home_team, away_team: e.away_team, bookmakers: books })
  }
  stats.booksSeen = [...seen].sort()
  return { events: out.sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time)), stats }
}
