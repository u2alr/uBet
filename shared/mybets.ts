// Validation and totals for the bets the user actually placed. Pure: no network, no database.
import { LIMITS, STATS, type Stat } from './baseline.ts'

export interface MyBetLegInput { playerId: number; player: string; stat: Stat; side: 'over' | 'under'; line: number; price: number; book: string | null; gameDate: string }
export interface MyBetInput { stake: number; note: string | null; legs: MyBetLegInput[] }
export type Parsed = { ok: true; bet: MyBetInput } | { ok: false; error: string }

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
export const MAX_LEGS = 12

/** Strict parse of a posted bet. Anything unexpected is refused as a whole: a half-valid bet is never stored. */
export function parseMyBet(body: unknown): Parsed {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' }
  const b = body as Record<string, unknown>
  const stake = num(b.stake, 0.01, 1_000_000)
  if (stake === null) return { ok: false, error: 'stake must be a number from 0.01 to 1,000,000' }
  if (!Array.isArray(b.legs) || b.legs.length < 1 || b.legs.length > MAX_LEGS) return { ok: false, error: `a bet needs 1 to ${MAX_LEGS} legs` }
  const legs: MyBetLegInput[] = []
  const seen = new Set<string>()
  for (const raw of b.legs) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'each leg must be an object' }
    const l = raw as Record<string, unknown>
    const playerId = num(l.playerId, 1, 1e12), line = num(l.line, 0, LIMITS.maxLine), price = num(l.price, 1.01, 1000)
    if (playerId === null || !Number.isInteger(playerId)) return { ok: false, error: 'bad player id' }
    if (typeof l.player !== 'string' || !l.player.trim() || l.player.length > 80) return { ok: false, error: 'bad player name' }
    if (typeof l.stat !== 'string' || !(STATS as readonly string[]).includes(l.stat)) return { ok: false, error: 'bad stat' }
    if (l.side !== 'over' && l.side !== 'under') return { ok: false, error: 'side must be over or under' }
    if (line === null) return { ok: false, error: 'bad line' }
    if (price === null) return { ok: false, error: 'odds must be decimal odds above 1.01' }
    if (typeof l.gameDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.gameDate)) return { ok: false, error: 'gameDate must be YYYY-MM-DD' }
    const book = typeof l.book === 'string' && l.book.trim() ? l.book.trim().slice(0, 40) : null
    const key = `${playerId}|${l.stat}|${l.side}|${line}`
    if (seen.has(key)) return { ok: false, error: 'the same leg appears twice' }
    seen.add(key)
    legs.push({ playerId, player: l.player.trim(), stat: l.stat as Stat, side: l.side, line, price, book, gameDate: l.gameDate })
  }
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 200) : null
  return { ok: true, bet: { stake, note, legs } }
}

export interface MyBetRow { stake: number; status: 'open' | 'won' | 'lost' | 'push' | 'void'; profit: number | null }
export interface MyBetTotals { bets: number; open: number; settled: number; won: number; lost: number; push: number; void: number; staked: number; profit: number; roi: number | null }

/** Money in, money out. ROI is profit over stake on settled bets with a decision (won or lost); pushes and voids return the stake and are not counted as risked. */
export function myBetTotals(rows: MyBetRow[]): MyBetTotals {
  const t: MyBetTotals = { bets: rows.length, open: 0, settled: 0, won: 0, lost: 0, push: 0, void: 0, staked: 0, profit: 0, roi: null }
  for (const r of rows) {
    if (r.status === 'open') { t.open++; continue }
    t.settled++; t[r.status]++
    t.profit += r.profit ?? 0
    if (r.status === 'won' || r.status === 'lost') t.staked += r.stake
  }
  t.roi = t.staked > 0 ? t.profit / t.staked : null
  return t
}
