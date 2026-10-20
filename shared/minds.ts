// Rule-based "minds": each reads the day's picks and chooses bets in its own style. Pure; frozen config.
// The rules and why they are what they are: research/PREREG_MINDS.md. Do not edit MINDS_V1 after the first card.
import type { Pick } from './picks.ts'

export const MINDS_VERSION = 'minds-v1'
export const MINDS_V1 = {
  maxBetsPerDay: 5,
  maxLegs: 5,
  minMarketBooks: 2,
  minSample: 10,
  sam: { singleProb: 0.68, singles: 3, doubleLegProb: 0.65 },
  val: { minEv: 0.04, minProb: 0.52, singles: 3, doubleEv: 0.08 },
  lou: { legProb: 0.4, legPrice: 1.8, minOdds: 8, combos: 2, minLegs: 3 },
  cat: { minGap: 0.1, minEv: 0.03, singles: 3 },
  control: { singles: 3 },
} as const

export type MindId = 'sam' | 'val' | 'lou' | 'cat' | 'control'
export const MIND_NAMES: Record<MindId, string> = {
  sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat', control: 'Control',
}

export interface Bet {
  mind: MindId
  kind: 'single' | 'combo'
  legs: Pick[]
  /** Product of leg prices (decimal). */
  odds: number
  /** Stated win probability: product of leg probabilities, legs assumed independent. */
  prob: number
  /** Expected profit per unit staked. */
  ev: number
}

export const legKey = (p: Pick) => `${p.playerId}|${p.stat}|${p.line}|${p.side}`

function bet(mind: MindId, legs: Pick[]): Bet {
  const odds = legs.reduce((a, l) => a * l.price, 1)
  const prob = legs.reduce((a, l) => a * l.prob, 1)
  return { mind, kind: legs.length === 1 ? 'single' : 'combo', legs, odds, prob, ev: prob * odds - 1 }
}

/** Picks every mind may use. */
export function sharedPool(picks: Pick[]): Pick[] {
  const c = MINDS_V1
  return picks.filter((p) => p.model === 'gbm-v1' && p.sample >= c.minSample && p.marketBooks >= c.minMarketBooks
    && Number.isFinite(p.prob) && Number.isFinite(p.ev) && p.price > 1)
}

const byDesc = (f: (p: Pick) => number) => (a: Pick, b: Pick) => f(b) - f(a)
const noPush = (p: Pick) => p.push === 0

/** Take legs in order, at most one per player and one per game, up to `n`. */
function distinct(sorted: Pick[], n: number, used = new Set<string>()): Pick[] {
  const out: Pick[] = []
  const games = new Set<string>(), players = new Set<number>()
  for (const p of sorted) {
    if (out.length >= n) break
    if (used.has(legKey(p)) || games.has(p.eventId) || players.has(p.playerId)) continue
    out.push(p); games.add(p.eventId); players.add(p.playerId)
  }
  return out
}

/** One single per player+stat+line: a mind never takes both sides of the same line. */
function singles(sorted: Pick[], n: number): Pick[] {
  const seen = new Set<string>(), out: Pick[] = []
  for (const p of sorted) {
    const k = `${p.playerId}|${p.stat}|${p.line}`
    if (out.length >= n) break
    if (seen.has(k)) continue
    seen.add(k); out.push(p)
  }
  return out
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const seedFromString = (s: string) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7)

/**
 * `done` lists the minds that already have a card for `day`: they are skipped, so running the job again never adds
 * bets past the daily cap or rewrites a card that was supposed to be frozen.
 */
export function runMinds(allPicks: Pick[], day: string, done: ReadonlySet<string> = new Set()): Bet[] {
  const c = MINDS_V1
  const pool = sharedPool(allPicks)
  const bets: Bet[] = []
  const cap = (mind: MindId, list: Bet[]) => { if (!done.has(mind)) bets.push(...list.slice(0, c.maxBetsPerDay)) }

  // Safe Sam
  {
    const out = singles(pool.filter((p) => p.prob >= c.sam.singleProb).sort(byDesc((p) => p.prob)), c.sam.singles).map((p) => bet('sam', [p]))
    const dbl = distinct(pool.filter((p) => p.prob >= c.sam.doubleLegProb && noPush(p)).sort(byDesc((p) => p.prob)), 2)
    if (dbl.length === 2) out.push(bet('sam', dbl))
    cap('sam', out)
  }
  // Value Val
  {
    const ok = pool.filter((p) => p.ev >= c.val.minEv && p.prob >= c.val.minProb)
    const out = singles(ok.sort(byDesc((p) => p.ev)), c.val.singles).map((p) => bet('val', [p]))
    const dbl = distinct(ok.filter(noPush).sort(byDesc((p) => p.ev)), 2)
    if (dbl.length === 2) { const b = bet('val', dbl); if (b.ev >= c.val.doubleEv) out.push(b) }
    cap('val', out)
  }
  // Longshot Lou
  {
    const ok = pool.filter((p) => p.prob >= c.lou.legProb && p.price >= c.lou.legPrice && noPush(p)).sort(byDesc((p) => p.ev))
    const used = new Set<string>(), out: Bet[] = []
    for (let i = 0; i < c.lou.combos; i++) {
      const legs: Pick[] = []
      const games = new Set<string>(), players = new Set<number>()
      for (const p of ok) {
        if (legs.length >= MINDS_V1.maxLegs) break
        if (used.has(legKey(p)) || games.has(p.eventId) || players.has(p.playerId)) continue
        legs.push(p); games.add(p.eventId); players.add(p.playerId)
        if (legs.length >= c.lou.minLegs && legs.reduce((a, l) => a * l.price, 1) >= c.lou.minOdds) break
      }
      const b = bet('lou', legs)
      if (legs.length < c.lou.minLegs || b.odds < c.lou.minOdds) break
      legs.forEach((l) => used.add(legKey(l)))
      out.push(b)
    }
    cap('lou', out)
  }
  // Contrarian Cat
  {
    const gap = (p: Pick) => Math.abs(p.modelProb - (p.marketProb ?? p.modelProb))
    const ok = pool.filter((p) => p.marketProb !== null && gap(p) >= c.cat.minGap && p.ev >= c.cat.minEv).sort(byDesc(gap))
    cap('cat', singles(ok, c.cat.singles).map((p) => bet('cat', [p])))
  }
  // Control: random singles from the pool, deterministic per day
  {
    const rng = mulberry32(seedFromString(day))
    const shuffled = [...pool].sort((a, b) => legKey(a).localeCompare(legKey(b)))
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
    cap('control', singles(shuffled, c.control.singles).map((p) => bet('control', [p])))
  }
  return bets
}
