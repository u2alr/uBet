// Pure logic behind the Props board: grouping sides into cards, the sort orders, and honest labels for each number.
// Kept apart from the components so it can be unit tested.
import type { Pick } from './picks.ts'
import { teamByName } from './teams.ts'

export interface Card { key: string; over: Pick | null; under: Pick | null; lead: Pick }

/** One card per event, player, stat and line, holding both sides. The lead side is the one with the higher expected value (authoritative numbers first). */
export function toCards(picks: Pick[]): Card[] {
  const m = new Map<string, Card>()
  for (const p of picks) {
    const key = `${p.eventId}|${p.playerId}|${p.stat}|${p.line}`     // the event is part of the key: one line in two games is two markets
    const c = m.get(key) ?? { key, over: null, under: null, lead: p }
    if (p.side === 'over') c.over = p; else c.under = p
    if (evRank(p) > evRank(c.lead)) c.lead = p
    m.set(key, c)
  }
  return [...m.values()]
}

/** Share of the last games (up to 10) that landed on the lead side, ties excluded; -1 when there is no history. */
export function hitRate(c: Card): number {
  const p = c.lead
  const landed = p.recent.filter((v) => (p.side === 'over' ? v > p.line : v < p.line)).length
  const decided = p.recent.filter((v) => v !== p.line).length
  return decided ? landed / decided : -1
}

/**
 * A sortable expected value. Authoritative numbers rank above legacy simple-blend numbers whatever their size: the two are different
 * calculations and are never interleaved by value.
 */
export const evRank = (p: Pick): number => (p.basis === 'authoritative' ? 1000 + p.ev : p.ev)

export const SORTS = [
  { key: 'ev', label: 'Expected value (EV)', hint: 'Expected profit per unit staked at the best price. The only order that ranks by value.' },
  { key: 'hit', label: 'Recent hit rate (history only)', hint: 'How often the lead side landed in recent games. Says nothing about price or value.' },
  { key: 'line', label: 'Line, high to low', hint: 'The betting line itself.' },
  { key: 'name', label: 'Player A to Z', hint: 'Alphabetical.' },
] as const
export type SortKey = (typeof SORTS)[number]['key']

export function sortCards(cards: Card[], key: SortKey): Card[] {
  const by: Record<SortKey, (a: Card, b: Card) => number> = {
    ev: (a, b) => evRank(b.lead) - evRank(a.lead),
    hit: (a, b) => hitRate(b) - hitRate(a) || evRank(b.lead) - evRank(a.lead),
    line: (a, b) => b.lead.line - a.lead.line || evRank(b.lead) - evRank(a.lead),
    name: (a, b) => a.lead.player.localeCompare(b.lead.player) || a.lead.stat.localeCompare(b.lead.stat),
  }
  return [...cards].sort(by[key])
}

/** Expected value as a signed percentage of the stake, e.g. "+8.4%". It is a return on stake, not a probability. */
export const evText = (ev: number) => `${ev > 0 ? '+' : ''}${(ev * 100).toFixed(1)}%`

export type ProjectionState = 'ok' | 'stale' | 'fallback' | 'missing'
/** Whether the projection behind a pick can be trusted at face value. */
export function projectionState(p: Pick): ProjectionState {
  if (!Number.isFinite(p.projection)) return 'missing'
  if (p.projectionAgeHours != null && p.projectionAgeHours > 24) return 'stale'
  if (p.model !== 'gbm-v1') return 'fallback'
  return 'ok'
}

/** Projection minus line, signed to the lead side (positive = the projection favours the bet). Null without a projection. */
export function projectionEdge(p: Pick): number | null {
  if (!Number.isFinite(p.projection)) return null
  return p.side === 'over' ? p.projection - p.line : p.line - p.projection
}

/** The opponent's abbreviation: the other team in "Away @ Home". Null when the team names are unknown. */
export function opponentOf(p: Pick): string | null {
  const [away, home] = p.game.split(' @ ')
  const other = p.teamName === away ? home : p.teamName === home ? away : null
  return other ? teamByName(other)?.[0] ?? null : null
}

/** ESPN's team codes that differ from NBA.com's (the codes used everywhere else in the app). */
const ESPN_ABBR: Record<string, string> = { GS: 'GSW', SA: 'SAS', NY: 'NYK', NO: 'NOP', WSH: 'WAS', UTAH: 'UTA' }
export const normAbbr = (abbr: string) => ESPN_ABBR[abbr] ?? abbr

export interface FavoriteInput { home: { abbr: string }; away: { abbr: string }; odds?: { spread: number | null; total: number | null; homeWinProb: number | null } | null }
export interface Favorite { abbr: string; prob: number; spread: number | null; total: number | null; tossUp: boolean }

/**
 * Who the betting market favours. This is the books' no-margin win chance averaged over books, NOT a model forecast of the game:
 * the app has no game-winner model. Null when no team odds are available. Within half a point of 50% it is a toss-up.
 */
export function favorite(g: FavoriteInput): Favorite | null {
  const p = g.odds?.homeWinProb
  if (p == null || !Number.isFinite(p)) return null
  const home = p >= 0.5
  const prob = home ? p : 1 - p
  const spread = g.odds?.spread
  return {
    abbr: normAbbr(home ? g.home.abbr : g.away.abbr), prob, tossUp: prob < 0.505,
    // The feed gives the home team's spread; show it from the favourite's side (always negative or zero).
    spread: spread == null ? null : -Math.abs(spread), total: g.odds?.total ?? null,
  }
}
