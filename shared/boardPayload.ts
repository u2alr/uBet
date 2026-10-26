// What the picks endpoint returns, and how it is limited. Pure.
//
// The old endpoint kept at most 80 picks, chosen by value, and dropped the other side of most lines: a posted market could show as
// "not posted". Now every side of every line is returned. If a size cap is ever reached it removes WHOLE GAMES (the latest first), never
// single sides or lines, and says which games were left out so they can be requested one at a time (`?event=<id>`).
import type { Pick } from './picks.ts'

/** Safety limit on one response. Generous: three games are ~150 picks, fifteen games ~700. */
export const MAX_PICKS = 2500

export interface EventCoverage { eventId: string; game: string; gameDate: string; picks: number }
export interface Coverage {
  /** Picks the books posted and the engine could build, before any cap or filter. */
  total: number
  returned: number
  /** Whole games left out because of MAX_PICKS. Empty in normal use. */
  omitted: EventCoverage[]
  events: EventCoverage[]
}

/** The slim shape sent to the browser: the engine's heavy per-book arrays are not needed there. */
export function slim(p: Pick): Pick {
  const { bookQuotes: _b, sideQuotes: _s, ...rest } = p
  void _b; void _s
  return rest as Pick
}

export function boardPayload(picks: Pick[], opts: { event?: string | null; maxPicks?: number } = {}): { picks: Pick[]; coverage: Coverage } {
  const max = opts.maxPicks ?? MAX_PICKS
  const byEvent = new Map<string, Pick[]>()
  for (const p of picks) (byEvent.get(p.eventId) ?? byEvent.set(p.eventId, []).get(p.eventId)!).push(p)
  const events: EventCoverage[] = [...byEvent].map(([eventId, ps]) => ({ eventId, game: ps[0].game, gameDate: ps[0].gameDate, picks: ps.length }))
    .sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.game.localeCompare(b.game))
  const chosen = opts.event ? events.filter((e) => e.eventId === opts.event) : events
  const kept: Pick[] = [], omitted: EventCoverage[] = []
  for (const e of chosen) {
    if (kept.length + e.picks <= max || kept.length === 0) kept.push(...byEvent.get(e.eventId)!)   // the first game is always sent, even if alone it exceeds the cap
    else omitted.push(e)
  }
  return { picks: kept.map(slim), coverage: { total: picks.length, returned: kept.length, omitted, events } }
}
