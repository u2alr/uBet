// Rule-based "minds": each reads the day's picks and chooses bets in its own style. Pure; frozen config.
// What changed from v2 and why: research/PREREG_MINDS_V3.md. Do not edit MINDS_V3 after the first v3 card; a change is minds-v4.
import type { Pick } from './picks.ts'

export const MINDS_VERSION = 'minds-v3'
export const MINDS_V3 = {
  /** Singles per team, per game, for Safe Sam, Value Val and Contrarian Cat (fewer if the team's pool cannot supply them). */
  betsPerTeamPerGame: 5,
  /** Extras that span games: doubles and parlays, per day. */
  samDoubles: 2,
  valDoubles: 1,
  louCombos: 5,
  maxLegs: 5,
  // Who is eligible: starters and stars only.
  /** The team's top N players by recent minutes (the starting five plus the sixth man). */
  starterTopN: 6,
  minRoleMinutes: 24,
  minutesDropFloor: -4,
  // Shared gates
  minMarketBooks: 2,
  minSample: 10,
  /** A model/market gap this big (see BIG_GAP) usually means news the model cannot see, not an edge. */
  maxGap: 0.25,
  // Diversification, per mind per day
  maxBetsPerPlayer: 2,
  /** Per team-game group of 5: at most this many all-Under bets (the model leans Under). */
  maxAllUnder: 3,
  sam: { singleProb: 0.6, singleEv: 0, doubleLegProb: 0.6 },
  val: { minEv: 0.03, minProb: 0.5, doubleLegEv: 0.03, doubleEv: 0.06 },
  lou: { legProb: 0.38, legPrice: 1.6, minOdds: 6, minLegs: 3, fillDoubleOdds: 4 },
  cat: { minGap: 0.1, minEv: 0.02, maxMarketProb: 0.5 },
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
const groupKey = (p: Pick) => `${p.eventId}|${p.team}`

function bet(mind: MindId, legs: Pick[]): Bet {
  const odds = legs.reduce((a, l) => a * l.price, 1)
  const prob = legs.reduce((a, l) => a * l.prob, 1)
  return { mind, kind: legs.length === 1 ? 'single' : 'combo', legs, odds, prob, ev: prob * odds - 1 }
}

/** Picks every mind may use, before the starters-and-stars cut. */
function gated(picks: Pick[]): Pick[] {
  const c = MINDS_V3
  return picks.filter((p) =>
    p.team != null
    && p.model === 'gbm-v1' && p.sample >= c.minSample && p.marketBooks >= c.minMarketBooks
    && Number.isFinite(p.prob) && Number.isFinite(p.ev) && p.price > 1
    && !p.injury                                                         // anyone listed (Out is already gone): leave it
    && p.role != null && p.role.min10 >= c.minRoleMinutes && (p.role.trend == null || p.role.trend > c.minutesDropFloor)
    && !p.bigGap
    && (p.marketProb == null || Math.abs(p.modelProb - p.marketProb) < c.maxGap),
  )
}

/**
 * Picks every mind may use: healthy, steady, and a starter or star, i.e. among the team's top players by minutes in that game.
 * Those are the players whose minutes (and so whose props) are the most predictable.
 */
export function sharedPool(picks: Pick[]): Pick[] {
  const ok = gated(picks)
  const minutes = new Map<string, Map<number, number>>()      // team-game -> player -> minutes
  for (const p of ok) {
    const g = minutes.get(groupKey(p)) ?? minutes.set(groupKey(p), new Map()).get(groupKey(p))!
    g.set(p.playerId, p.role!.min10)
  }
  const starters = new Set<string>()
  for (const [g, m] of minutes)
    [...m].sort((a, b) => b[1] - a[1]).slice(0, MINDS_V3.starterTopN).forEach(([id]) => starters.add(`${g}|${id}`))
  return ok.filter((p) => starters.has(`${groupKey(p)}|${p.playerId}`))
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

/** Keep the first `n` candidates (already in the mind's own order) that do not overload one player or lean all-Under. */
function pickDiverse(candidates: Bet[], n: number, players = new Map<number, number>()): Bet[] {
  const c = MINDS_V3
  const out: Bet[] = []
  let allUnder = 0
  for (const b of candidates) {
    if (out.length >= n) break
    const under = b.legs.every((l) => l.side === 'under')
    if (under && allUnder >= c.maxAllUnder) continue
    const ps = new Set(b.legs.map((l) => l.playerId))
    if ([...ps].some((id) => (players.get(id) ?? 0) >= c.maxBetsPerPlayer)) continue
    out.push(b)
    if (under) allUnder++
    ps.forEach((id) => players.set(id, (players.get(id) ?? 0) + 1))
  }
  return out
}

/** Singles for every team in every game: the first `betsPerTeamPerGame` of each group, in the order `rank` gives. */
function perTeamGame(mind: MindId, legs: Pick[], rank: (p: Pick) => number): Bet[] {
  const groups = new Map<string, Pick[]>()
  for (const p of legs) (groups.get(groupKey(p)) ?? groups.set(groupKey(p), []).get(groupKey(p))!).push(p)
  const players = new Map<number, number>()   // the per-player cap is per mind per day, across stats
  const out: Bet[] = []
  for (const list of groups.values())
    out.push(...pickDiverse(dedupeLines(list.sort(byDesc(rank))).map((p) => bet(mind, [p])), MINDS_V3.betsPerTeamPerGame, players))
  return out
}

/** `done` lists the minds that already have a card for the day: they are skipped, so a re-run cannot add bets or rewrite a card. */
export function runMinds(allPicks: Pick[], _day: string, done: ReadonlySet<string> = new Set()): Bet[] {
  const c = MINDS_V3
  const pool = sharedPool(allPicks)
  const bets: Bet[] = []
  const add = (mind: MindId, list: Bet[]) => { if (!done.has(mind)) bets.push(...list) }

  // Safe Sam: the likeliest outcomes. Singles per team-game, plus a couple of doubles of the likeliest pairs.
  {
    const legs = pool.filter((p) => p.prob >= c.sam.singleProb && p.ev >= c.sam.singleEv)
    const doubles = pairUp(dedupeLines(legs.filter((p) => p.prob >= c.sam.doubleLegProb && noPush(p)).sort(byDesc((p) => p.prob))))
      .map((l) => bet('sam', l)).sort((a, b) => b.prob - a.prob)
    add('sam', [...perTeamGame('sam', legs, (p) => p.prob), ...pickDiverse(doubles, c.samDoubles)])
  }
  // Value Val: the biggest expected profit per unit.
  {
    const legs = pool.filter((p) => p.ev >= c.val.minEv && p.prob >= c.val.minProb)
    const doubles = pairUp(dedupeLines(legs.filter((p) => p.ev >= c.val.doubleLegEv && noPush(p)).sort(byDesc((p) => p.ev))))
      .map((l) => bet('val', l)).filter((b) => b.ev >= c.val.doubleEv).sort((a, b) => b.ev - a.ev)
    add('val', [...perTeamGame('val', legs, (p) => p.ev), ...pickDiverse(doubles, c.valDoubles)])
  }
  // Longshot Lou: parlays of 3 to 5 legs across games, each leg used once on the card.
  {
    const ok = dedupeLines(pool.filter((p) => p.prob >= c.lou.legProb && p.price >= c.lou.legPrice && noPush(p)).sort(byDesc((p) => p.ev)))
    const used = new Set<string>(), combos: Bet[] = []
    for (let k = 0; k < c.louCombos; k++) {
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
    add('lou', pickDiverse([...combos, ...doubles], c.louCombos))
  }
  // Contrarian Cat: takes the side the market thinks LESS likely (below 50%) when the model rates it clearly higher. The
  // biggest gaps are the model's likeliest mistakes, so the shared gate caps them (maxGap) and a value floor still applies.
  {
    const legs = pool.filter((p) => p.marketProb !== null && p.marketProb < c.cat.maxMarketProb && p.modelProb - p.marketProb >= c.cat.minGap && p.ev >= c.cat.minEv)
    add('cat', perTeamGame('cat', legs, gapOf))
  }
  return bets
}
