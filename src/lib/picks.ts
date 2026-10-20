import type { Pick } from '../../shared/picks.ts'

// One definition of a pick, shared with the Worker that builds it, so the two cannot drift apart.
export type { Pick }

export const pickKey = (p: Pick) => `${p.playerId}|${p.stat}|${p.side}|${p.line}`

// ---- tabs ----

/** Best expected profit first. */
export const valuePicks = (all: Pick[]) =>
  all.filter((p) => p.ev > 0).sort((a, b) => b.ev - a.ev).slice(0, 15)

/** Most likely to land, with enough games behind the estimate to trust it. */
export const safestPicks = (all: Pick[]) =>
  all.filter((p) => p.prob >= 0.58 && p.sample >= 10).sort((a, b) => b.prob - a.prob).slice(0, 12)

/** Biggest payouts that the numbers don't rule out. Expect to lose most of these. */
export const riskiestPicks = (all: Pick[]) =>
  all.filter((p) => p.ev > -0.05 && p.price >= 2.2).sort((a, b) => b.price - a.price).slice(0, 12)

// ---- parlays ----

export interface Parlay {
  name: string
  blurb: string
  legs: Pick[]
}

/**
 * Combined parlay figures, ASSUMING the legs are independent. They are not: legs from the same game, or the same player,
 * move together, and nothing here knows by how much. Treat these as rough, not as an accurate combined probability.
 *  odds  payout multiple if every leg wins
 *  prob  chance that no leg loses (a leg that ties on a whole-number line is refunded and drops out)
 *  ev    expected profit per 1 staked: the product of each leg's expected multiplier, minus 1
 */
export function combine(legs: Pick[]) {
  const push = (l: Pick) => l.push ?? 0 // legs saved in a browser before this field existed have none
  const odds = legs.reduce((a, l) => a * l.price, 1)
  const prob = legs.reduce((a, l) => a * ((1 - push(l)) * l.prob + push(l)), 1)
  const ev = legs.reduce((a, l) => a * ((1 - push(l)) * l.prob * l.price + push(l)), 1) - 1
  return { odds, prob, ev }
}

/** One leg per player, and one per game when possible (legs from the same game are correlated). */
function take(list: Pick[], n: number): Pick[] {
  const out: Pick[] = []
  const players = new Set<number>()
  const games = new Set<string>()
  for (const strict of [true, false]) {
    for (const p of list) {
      if (out.length >= n) break
      if (players.has(p.playerId) || out.includes(p)) continue
      if (strict && games.has(p.game)) continue
      out.push(p)
      players.add(p.playerId)
      games.add(p.game)
    }
  }
  return out
}

export function suggestParlays(all: Pick[]): Parlay[] {
  const result: Parlay[] = []
  const safe = take(safestPicks(all), 3)
  if (safe.length === 3)
    result.push({ name: 'Safe', blurb: 'Three of the likeliest legs, from different games.', legs: safe })

  const balanced = take(valuePicks(all).filter((p) => p.prob >= 0.5), 4)
  if (balanced.length >= 3)
    result.push({ name: 'Value', blurb: 'The best expected-profit legs that are still better than a coin flip.', legs: balanced })

  const long = take(riskiestPicks(all), 3)
  if (long.length === 3)
    result.push({ name: 'Longshot', blurb: 'Big payout, low chance. Small stake only.', legs: long })
  return result
}

// ---- grouping ----

export interface TeamGroup { team: string; picks: Pick[] }
export interface GameGroup { game: string; teams: TeamGroup[] }

/** Games in the order their first pick appears; inside each game, one block per team. */
export function groupByGame(picks: Pick[]): GameGroup[] {
  const games = new Map<string, Map<string, Pick[]>>()
  for (const p of picks) {
    const teams = games.get(p.game) ?? games.set(p.game, new Map()).get(p.game)!
    const t = p.teamName ?? 'Other'
    teams.set(t, [...(teams.get(t) ?? []), p])
  }
  return [...games].map(([game, teams]) => {
    // Away team first, to match the "Away @ Home" heading.
    const [away, home] = game.split(' @ ')
    const order = (t: string) => (t === away ? 0 : t === home ? 1 : 2)
    return {
      game,
      teams: [...teams].map(([team, ps]) => ({ team, picks: ps })).sort((a, b) => order(a.team) - order(b.team)),
    }
  })
}
