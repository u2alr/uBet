// Turns SharpAPI /odds rows (https://docs.sharpapi.io) into the shapes the pick builder and the team-odds view already use. Pure: no network, no clock.
// SharpAPI returns one flat row per book, market, selection and line; the app wants events with books, markets and outcomes.
import type { OddsBook, OddsEvent, OddsOutcome } from './picks.ts'

export const SHARP_BASE = 'https://api.sharpapi.io/api/v1'
/** The two books the free plan quotes; both are kept because both quote both sides of every prop. */
export const SHARP_BOOKS = ['draftkings', 'fanduel']
export const SHARP_PROP_MARKETS = 'player_points,player_rebounds,player_assists,player_made_threes,player_points_+_rebounds_+_assists'
export const SHARP_TEAM_MARKETS = 'moneyline,point_spread,total_points'

/** SharpAPI market id -> the market key the pick builder reads (shared/picks.ts MARKET_STAT). */
const PROP_KEY: Record<string, string> = {
  player_points: 'player_points',
  player_rebounds: 'player_rebounds',
  player_assists: 'player_assists',
  player_made_threes: 'player_threes',
  'player_points_+_rebounds_+_assists': 'player_points_rebounds_assists',
}
const TEAM_KEY: Record<string, string> = { moneyline: 'h2h', point_spread: 'spreads', total_points: 'totals' }
const TITLE: Record<string, string> = { draftkings: 'DraftKings', fanduel: 'FanDuel' }

export interface SharpQuote {
  id: string
  sportsbook: string
  event_id: string
  home_team: string
  away_team: string
  market_type: string
  selection: string
  selection_type: string
  odds_decimal: number
  line: number | null
  event_start_time: string
  timestamp?: string
  player_name?: string
  is_live?: boolean
  is_active?: boolean
  is_main_line?: boolean
  is_stale_pregame_price?: boolean
}

export interface SharpStats { kept: number; skipped: { book: number; side: number; price: number; line: number; player: number; inactive: number }; booksSeen: string[] }

const usable = (q: SharpQuote) => q.is_active !== false && !q.is_live && !q.is_stale_pregame_price
const priceOk = (q: SharpQuote) => Number.isFinite(q.odds_decimal) && q.odds_decimal > 1
const iso = (s: string) => (Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : s)

/** Player props: events with one book entry per sportsbook, each market holding every Over/Under quote. Main lines only, as the API is asked to send. */
export function normalizeSharpProps(rows: SharpQuote[], allowed: readonly string[] = SHARP_BOOKS): { events: OddsEvent[]; stats: SharpStats } {
  const stats: SharpStats = { kept: 0, skipped: { book: 0, side: 0, price: 0, line: 0, player: 0, inactive: 0 }, booksSeen: [] }
  const seen = new Set<string>()
  const events = new Map<string, { ev: OddsEvent; books: Map<string, Map<string, Map<string, OddsOutcome>>> }>()
  for (const q of rows) {
    const key = PROP_KEY[q.market_type]
    if (!key) continue
    seen.add(q.sportsbook)
    if (!allowed.includes(q.sportsbook)) { stats.skipped.book++; continue }
    if (!usable(q)) { stats.skipped.inactive++; continue }
    const side = q.selection_type === 'over' ? 'Over' : q.selection_type === 'under' ? 'Under' : null
    if (!side) { stats.skipped.side++; continue }
    if (!priceOk(q)) { stats.skipped.price++; continue }
    if (typeof q.line !== 'number' || !Number.isFinite(q.line)) { stats.skipped.line++; continue }
    if (!q.player_name) { stats.skipped.player++; continue }
    const e = events.get(q.event_id) ?? events.set(q.event_id, {
      ev: { id: q.event_id, commence_time: iso(q.event_start_time), home_team: q.home_team, away_team: q.away_team, bookmakers: [] }, books: new Map(),
    }).get(q.event_id)!
    const book = e.books.get(q.sportsbook) ?? e.books.set(q.sportsbook, new Map()).get(q.sportsbook)!
    const market = book.get(key) ?? book.set(key, new Map()).get(key)!
    // A repeated row (the same price seen on two pages) keeps the newer one.
    const id = `${q.player_name}|${side}|${q.line}`
    const prev = market.get(id)
    if (prev && (prev.updated ?? '') >= (q.timestamp ?? '')) continue
    if (!prev) stats.kept++
    market.set(id, { name: side, description: q.player_name, price: q.odds_decimal, point: q.line, id: q.id, updated: q.timestamp, updatedSource: q.timestamp ? 'quote' : 'feed', main: q.is_main_line ?? undefined })
  }
  stats.booksSeen = [...seen].sort()
  const out: OddsEvent[] = []
  for (const { ev, books } of events.values()) {
    const bookmakers: OddsBook[] = [...books].map(([k, markets]) => ({
      key: k, title: TITLE[k] ?? k, markets: [...markets].map(([mk, o]) => ({ key: mk, outcomes: [...o.values()] })).filter((m) => m.outcomes.length),
    })).filter((b) => b.markets.length)
    if (bookmakers.length) out.push({ ...ev, bookmakers })
  }
  return { events: out.sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time)), stats }
}

export interface GameOddsEvent {
  id: string; commence_time: string; home_team: string; away_team: string
  bookmakers: { key: string; title: string; markets: { key: string; outcomes: { name: string; price: number; point?: number }[] }[] }[]
}

/** Moneyline, spread and total per game, in the h2h / spreads / totals shape parseGameOdds reads. Outcomes are named by the game's own team names. */
export function normalizeSharpGames(rows: SharpQuote[], allowed: readonly string[] = SHARP_BOOKS): GameOddsEvent[] {
  const events = new Map<string, GameOddsEvent>()
  for (const q of rows) {
    const key = TEAM_KEY[q.market_type]
    if (!key || !allowed.includes(q.sportsbook) || !usable(q) || !priceOk(q)) continue
    const name = q.selection_type === 'home' ? q.home_team : q.selection_type === 'away' ? q.away_team : q.selection_type === 'over' ? 'Over' : q.selection_type === 'under' ? 'Under' : null
    if (!name) continue
    const needsLine = key !== 'h2h'
    if (needsLine && (typeof q.line !== 'number' || !Number.isFinite(q.line))) continue
    const ev = events.get(q.event_id) ?? events.set(q.event_id, { id: q.event_id, commence_time: iso(q.event_start_time), home_team: q.home_team, away_team: q.away_team, bookmakers: [] }).get(q.event_id)!
    const book = ev.bookmakers.find((b) => b.key === q.sportsbook) ?? (ev.bookmakers.push({ key: q.sportsbook, title: TITLE[q.sportsbook] ?? q.sportsbook, markets: [] }), ev.bookmakers[ev.bookmakers.length - 1])
    const market = book.markets.find((m) => m.key === key) ?? (book.markets.push({ key, outcomes: [] }), book.markets[book.markets.length - 1])
    if (market.outcomes.some((o) => o.name === name)) continue
    market.outcomes.push(needsLine ? { name, price: q.odds_decimal, point: q.line! } : { name, price: q.odds_decimal })
  }
  return [...events.values()].sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
}
