import type { Pick } from './picks.ts'
import { opponentOf } from './propsBoard.ts'

export interface H2HGame { date: string; minutes: number; pts: number; reb: number; ast: number; fg3m: number }
export type H2H = Record<string, H2HGame[]>
/** Head-to-head is 'loading' until it arrives, and 'error' if the request failed: a failure must never read as "no earlier games". */
export type H2HState = { status: 'loading' | 'error' } | { status: 'ok'; data: H2H }

/** A meeting's value for a stat; PRA is points + rebounds + assists. */
export const h2hValue = (r: H2HGame, stat: string): number => (stat === 'pra' ? r.pts + r.reb + r.ast : r[stat as 'pts' | 'reb' | 'ast' | 'fg3m'])
export const h2hRows = (h: H2HState, p: Pick): H2HGame[] | undefined => (h.status === 'ok' ? h.data[`${p.playerId}:${opponentOf(p)}`] ?? [] : undefined)

