// Pure logic behind the Props board: grouping sides into cards, the sort orders, and honest labels for each number.
// Kept apart from the components so it can be unit tested.
import type { Pick } from './picks.ts'
import { teamByName } from './teams.ts'

export interface Card { key: string; over: Pick | null; under: Pick | null; lead: Pick }

/** One card per player, stat and line, holding both sides. The lead side is the one with the higher expected value. */
export function toCards(picks: Pick[]): Card[] {
  const m = new Map<string, Card>()
  for (const p of picks) {
    const key = `${p.playerId}|${p.stat}|${p.line}`
    const c = m.get(key) ?? { key, over: null, under: null, lead: p }
    if (p.side === 'over') c.over = p; else c.under = p
    if (p.ev > c.lead.ev) c.lead = p
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

export const SORTS = [
  { key: 'ev', label: 'Expected value (EV)', hint: 'Expected profit per unit staked at the best price. The only order that ranks by value.' },
  { key: 'hit', label: 'Recent hit rate (history only)', hint: 'How often the lead side landed in recent games. Says nothing about price or value.' },
  { key: 'line', label: 'Line, high to low', hint: 'The betting line itself.' },
  { key: 'name', label: 'Player A to Z', hint: 'Alphabetical.' },
] as const
export type SortKey = (typeof SORTS)[number]['key']

export function sortCards(cards: Card[], key: SortKey): Card[] {
  const by: Record<SortKey, (a: Card, b: Card) => number> = {
    ev: (a, b) => b.lead.ev - a.lead.ev,
    hit: (a, b) => hitRate(b) - hitRate(a) || b.lead.ev - a.lead.ev,
    line: (a, b) => b.lead.line - a.lead.line || b.lead.ev - a.lead.ev,
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
