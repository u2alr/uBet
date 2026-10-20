// Turns OddsBlaze responses (one per sportsbook) into the OddsEvent shape the pick builder already uses.
// Pure: no network, no clock. The local runner (minds/run.mjs) does the fetching, because a single response can be
// 8-11 MB, far too heavy to parse inside a Cloudflare Worker.
//
// Findings from real responses (October 2026) that shape this file:
//  - event ids are shared across sportsbooks, so games merge by id
//  - DraftKings, Fanatics and Caesars quote real two-way (Over AND Under) lines; BetRivers, betPARX and Bally Bet
//    quote one-sided ladders only, so they cannot give a margin-free price and are not used by default
//  - prices arrive as strings; ask for price=decimal
import type { OddsBook, OddsEvent, OddsOutcome } from './picks.ts'

export interface BlazeOdd {
  id: string
  market: string
  name?: string
  price: string | number
  selection?: { name?: string; side?: string; line?: number }
  player?: { name?: string }
}
export interface BlazeEvent {
  id: string
  teams: { away: { name: string }; home: { name: string } }
  date: string
  live?: boolean
  odds: BlazeOdd[]
}
export interface BlazeResponse {
  sportsbook: { id: string; name: string }
  events: BlazeEvent[]
}

/** OddsBlaze market name -> the market key shared/picks.ts understands. */
export const BLAZE_MARKETS: Record<string, string> = {
  'Player Points': 'player_points',
  'Player Rebounds': 'player_rebounds',
  'Player Assists': 'player_assists',
  'Player Threes Made': 'player_threes',
}

/** Books that quote both sides of a line. These are the only ones that can supply a margin-free market price. */
export const TWO_WAY_BOOKS = ['draftkings', 'fanatics', 'caesars']

export interface NormalizeStats {
  kept: number
  skipped: { market: number; side: number; price: number; line: number; player: number; live: number }
}

export function normalizeOddsBlaze(responses: BlazeResponse[]): { events: OddsEvent[]; stats: NormalizeStats } {
  const stats: NormalizeStats = { kept: 0, skipped: { market: 0, side: 0, price: 0, line: 0, player: 0, live: 0 } }
  const events = new Map<string, OddsEvent>()

  for (const r of responses) {
    for (const e of r.events) {
      if (e.live) { stats.skipped.live += e.odds.length; continue }
      const ev = events.get(e.id) ?? events.set(e.id, {
        id: e.id, commence_time: e.date, home_team: e.teams.home.name, away_team: e.teams.away.name, bookmakers: [],
      }).get(e.id)!

      const markets = new Map<string, OddsOutcome[]>()
      for (const o of e.odds) {
        const key = BLAZE_MARKETS[o.market]
        if (!key) { stats.skipped.market++; continue }
        const side = o.selection?.side
        if (side !== 'Over' && side !== 'Under') { stats.skipped.side++; continue }
        const price = Number(o.price)
        if (!Number.isFinite(price) || price <= 1) { stats.skipped.price++; continue }
        const line = o.selection?.line
        if (typeof line !== 'number' || !Number.isFinite(line)) { stats.skipped.line++; continue }
        const player = o.player?.name ?? o.selection?.name
        if (!player) { stats.skipped.player++; continue }
        ;(markets.get(key) ?? markets.set(key, []).get(key)!).push({ name: side, description: player, price, point: line, id: o.id })
        stats.kept++
      }
      if (!markets.size) continue
      const book: OddsBook = { key: r.sportsbook.id, title: r.sportsbook.name, markets: [...markets].map(([key, outcomes]) => ({ key, outcomes })) }
      ev.bookmakers!.push(book)
    }
  }
  return { events: [...events.values()].sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time)), stats }
}
