import type { Pick } from '../../shared/picks.ts'

// One definition of a pick, shared with the Worker that builds it, so the two cannot drift apart.
export type { Pick }

export const pickKey = (p: Pick) => `${p.eventId}|${p.playerId}|${p.stat}|${p.side}|${p.line}`

// ---- tabs ----

/** Best expected profit first. Only numbers from the authoritative engine count: the legacy simple blend is never ranked as value. */
export const valuePicks = (all: Pick[]) =>
  all.filter((p) => p.basis === 'authoritative' && p.ev > 0).sort((a, b) => b.ev - a.ev).slice(0, 15)

/** Most likely to land, with enough games behind the estimate to trust it. A likely pick is not a good-value or low-risk one: its expected value can be negative. */
export const likelyPicks = (all: Pick[]) =>
  all.filter((p) => p.prob >= 0.58 && p.sample >= 10).sort((a, b) => b.prob - a.prob).slice(0, 12)

/** Biggest payouts that the numbers don't rule out. Expect to lose most of these. */
export const longshotPicks = (all: Pick[]) =>
  all.filter((p) => p.ev > -0.05 && p.price >= 2.2).sort((a, b) => b.price - a.price).slice(0, 12)

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
