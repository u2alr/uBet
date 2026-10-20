// Rule-based "minds": each reads the day's picks and chooses bets in its own style. Pure; frozen config.
// What changed from v1 and why: research/PREREG_MINDS_V2.md. Do not edit MINDS_V2 after the first v2 card; a change is minds-v3.
import type { Pick } from './picks.ts'

export const MINDS_VERSION = 'minds-v2'
export const MINDS_V2 = {
  /** Every mind aims to place exactly this many bets a day (fewer only if the pool cannot supply them). */
  betsPerDay: 5,
  maxLegs: 5,
  // Shared gates
  minMarketBooks: 2,
  minSample: 10,
  /** Minutes role: the model does not see minutes or injuries, so players whose role is shaky are left alone. */
  minRoleMinutes: 18,
  minutesDropFloor: -4,
  /** A model/market gap this big (see BIG_GAP) usually means news the model cannot see, not an edge. */
  maxGap: 0.25,
  // Diversification, per mind per day
  maxBetsPerPlayer: 2,
  maxBetsPerGame: 3,
  /** Bets where every leg is an Under. The model leans Under (see AUDIT notes), so a card is never all Unders. */
  maxAllUnder: 3,
  sam: { singleProb: 0.6, singleEv: 0, singles: 3, doubleLegProb: 0.6, doubles: 2 },
  val: { minEv: 0.03, minProb: 0.5, singles: 4, doubleLegEv: 0.03, doubleEv: 0.06, doubles: 1 },
  lou: { legProb: 0.38, legPrice: 1.6, minOdds: 6, minLegs: 3, combos: 5, fillDoubleOdds: 4 },
  cat: { minGap: 0.1, minEv: 0.02, maxMarketProb: 0.5, singles: 5 },
} as const

export type MindId = 'sam' | 'val' | 'lou' | 'cat'
export const MIND_IDS: readonly MindId[] = ['sam', 'val', 'lou', 'cat']
export const MIND_NAMES: Record<MindId, string> = {
  sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat',
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
  const c = MINDS_V2
  return picks.filter((p) =>
    p.model === 'gbm-v1' && p.sample >= c.minSample && p.marketBooks >= c.minMarketBooks
    && Number.isFinite(p.prob) && Number.isFinite(p.ev) && p.price > 1
    && !p.injury                                                         // anyone listed (Out is already gone): leave it
    && p.role != null && p.role.min10 >= c.minRoleMinutes && (p.role.trend == null || p.role.trend > c.minutesDropFloor)
    && !p.bigGap
    && (p.marketProb == null || Math.abs(p.modelProb - p.marketProb) < c.maxGap),
  )
}

const byDesc = (f: (p: Pick) => number) => (a: Pick, b: Pick) => f(b) - f(a)
const noPush = (p: Pick) => p.push === 0
const gapOf = (p: Pick) => Math.abs(p.modelProb - (p.marketProb ?? p.modelProb))

/** One leg per player+stat+line: a mind never takes both sides of the same line. */
function dedupeLines(sorted: Pick[]): Pick[] {
  const seen = new Set<string>(), out: Pick[] = []
  for (const p of sorted) {
    const k = `${p.playerId}|${p.stat}|${p.line}`
    if (seen.has(k)) continue
    seen.add(k); out.push(p)
  }
  return out
}

/** Disjoint pairs, two legs from different games and players, taken greedily down the sorted list. */
function pairUp(sorted: Pick[]): Pick[][] {
  const pairs: Pick[][] = []
  const taken = new Set<string>()
  for (let i = 0; i < sorted.length; i++) {
    if (taken.has(legKey(sorted[i]))) continue
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j]
      if (taken.has(legKey(b)) || a.eventId === b.eventId || a.playerId === b.playerId) continue
      pairs.push([a, b]); taken.add(legKey(a)); taken.add(legKey(b))
      break
    }
  }
  return pairs
}

/**
 * Walk the candidates in the mind's own order and keep each bet that does not overload one player or one game.
 * This is what stops a mind from putting its whole card on the same two players.
 */
function pickDiverse(candidates: Bet[], n: number): Bet[] {
  const c = MINDS_V2
  const out: Bet[] = []
  const players = new Map<number, number>(), games = new Map<string, number>()
  let allUnder = 0
  for (const b of candidates) {
    if (out.length >= n) break
    const under = b.legs.every((l) => l.side === 'under')
    if (under && allUnder >= c.maxAllUnder) continue
    const ps = new Set(b.legs.map((l) => l.playerId)), gs = new Set(b.legs.map((l) => l.eventId))
    if ([...ps].some((id) => (players.get(id) ?? 0) >= c.maxBetsPerPlayer)) continue
    if ([...gs].some((g) => (games.get(g) ?? 0) >= c.maxBetsPerGame)) continue
    out.push(b)
    if (under) allUnder++
    ps.forEach((id) => players.set(id, (players.get(id) ?? 0) + 1))
    gs.forEach((g) => games.set(g, (games.get(g) ?? 0) + 1))
  }
  return out
}

/** The first `quota` of each class, then whatever is left of either, so a thin class never leaves the card short. */
function fill(classes: Bet[][], quotas: number[], n: number): Bet[] {
  const head = classes.flatMap((list, i) => list.slice(0, quotas[i]))
  const rest = classes.flatMap((list, i) => list.slice(quotas[i]))
  return pickDiverse([...head, ...rest], n)
}

/** `done` lists the minds that already have a card for the day: they are skipped, so a re-run cannot add bets or rewrite a card. */
export function runMinds(allPicks: Pick[], _day: string, done: ReadonlySet<string> = new Set()): Bet[] {
  const c = MINDS_V2
  const pool = sharedPool(allPicks)
  const bets: Bet[] = []
  const add = (mind: MindId, list: Bet[]) => { if (!done.has(mind)) bets.push(...list.slice(0, c.betsPerDay)) }

  // Safe Sam: the likeliest outcomes, as singles and doubles of the likeliest pairs.
  {
    const legs = dedupeLines(pool.filter((p) => p.prob >= c.sam.singleProb && p.ev >= c.sam.singleEv).sort(byDesc((p) => p.prob)))
    const singles = legs.map((p) => bet('sam', [p]))
    const doubles = pairUp(legs.filter((p) => p.prob >= c.sam.doubleLegProb && noPush(p))).map((l) => bet('sam', l)).sort((a, b) => b.prob - a.prob)
    add('sam', fill([singles, doubles], [c.sam.singles, c.sam.doubles], c.betsPerDay))
  }
  // Value Val: the biggest expected profit per unit, as singles and one double of the best pair.
  {
    const ok = dedupeLines(pool.filter((p) => p.ev >= c.val.minEv && p.prob >= c.val.minProb).sort(byDesc((p) => p.ev)))
    const singles = ok.map((p) => bet('val', [p]))
    const doubles = pairUp(ok.filter((p) => p.ev >= c.val.doubleLegEv && noPush(p))).map((l) => bet('val', l)).filter((b) => b.ev >= c.val.doubleEv).sort((a, b) => b.ev - a.ev)
    add('val', fill([singles, doubles], [c.val.singles, c.val.doubles], c.betsPerDay))
  }
  // Longshot Lou: parlays of 3 to 5 legs, each leg used once across the card.
  {
    const ok = dedupeLines(pool.filter((p) => p.prob >= c.lou.legProb && p.price >= c.lou.legPrice && noPush(p)).sort(byDesc((p) => p.ev)))
    const used = new Set<string>(), combos: Bet[] = []
    for (let k = 0; k < c.lou.combos; k++) {
      const legs: Pick[] = []
      const games = new Set<string>(), players = new Set<number>()
      for (const p of ok) {
        if (legs.length >= c.maxLegs) break
        if (used.has(legKey(p)) || games.has(p.eventId) || players.has(p.playerId)) continue
        legs.push(p); games.add(p.eventId); players.add(p.playerId)
        if (legs.length >= c.lou.minLegs && legs.reduce((a, l) => a * l.price, 1) >= c.lou.minOdds) break
      }
      const b = bet('lou', legs)
      if (legs.length < c.lou.minLegs || b.odds < c.lou.minOdds) break
      legs.forEach((l) => used.add(legKey(l)))
      combos.push(b)
    }
    // If the pool cannot supply five parlays, the card is topped up with 2-leg longshots that still pay well.
    const doubles = pairUp(ok.filter((p) => !used.has(legKey(p)))).map((l) => bet('lou', l)).filter((b) => b.odds >= c.lou.fillDoubleOdds).sort((a, b) => b.ev - a.ev)
    add('lou', pickDiverse([...combos, ...doubles], c.betsPerDay))
  }
  // Contrarian Cat: takes the side the market thinks LESS likely (below 50%) when the model rates it clearly higher. The
  // biggest gaps are the model's likeliest mistakes, so the shared gate caps them (maxGap) and a value floor still applies.
  {
    const ok = dedupeLines(pool.filter((p) => p.marketProb !== null && p.marketProb < c.cat.maxMarketProb && p.modelProb - p.marketProb >= c.cat.minGap && p.ev >= c.cat.minEv).sort(byDesc(gapOf)))
    add('cat', pickDiverse(ok.map((p) => bet('cat', [p])), c.betsPerDay))
  }
  return bets
}
