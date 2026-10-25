// Pure logic for the cheat sheet: for a player's recent games, the highest threshold they cleared in (almost) every one.
// "Jaylen Brown 15+ points, 3/3 in his last 3". It describes history only. It says nothing about price, opponent or what happens next.

export type CheatStat = 'pts' | 'reb' | 'ast' | 'fg3m' | 'pra'

export interface RecentGame { date: string; minutes: number; pts: number; reb: number; ast: number; fg3m: number }

/** The thresholds a bettor thinks in, per statistic. Only these are offered, so "17+" never appears. */
export const LADDER: Record<CheatStat, number[]> = {
  pts: [5, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40],
  reb: [2, 3, 4, 5, 6, 8, 10, 12, 14, 16],
  ast: [2, 3, 4, 5, 6, 8, 10, 12, 14],
  fg3m: [1, 2, 3, 4, 5, 6, 7, 8],
  pra: [10, 15, 20, 25, 30, 35, 40, 45, 50],
}
export const STAT_NAME: Record<CheatStat, string> = { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', pra: 'PRA' }

export const gameValue = (g: RecentGame, s: CheatStat) => (s === 'pra' ? g.pts + g.reb + g.ast : g[s])

export interface Streak {
  stat: CheatStat
  /** "t+": the player reached at least this many. */
  threshold: number
  hits: number
  /** Games considered: the window, or fewer if the player has played fewer. */
  games: number
  /** Values in the window, oldest first, for the bars. */
  values: number[]
  average: number
  minutes: number
}

/**
 * The highest ladder threshold cleared in at least `minRate` of the player's last `window` games (newest first in `games`).
 * Null if the player has fewer than `window` games (a 3/3 over two games is not a 3-game streak) or clears none.
 */
export function bestStreak(games: RecentGame[], stat: CheatStat, window: number, minRate = 1): Streak | null {
  if (window < 1 || games.length < window) return null
  const recent = games.slice(0, window)
  const values = recent.map((g) => gameValue(g, stat))
  for (const t of [...LADDER[stat]].reverse()) {
    const hits = values.filter((v) => v >= t).length
    if (hits / window >= minRate - 1e-9) {
      return { stat, threshold: t, hits, games: window, values: values.slice().reverse(), average: values.reduce((a, b) => a + b, 0) / window, minutes: recent.reduce((a, g) => a + g.minutes, 0) / window }
    }
  }
  return null
}

export const SORTS = [
  { key: 'level', label: 'Highest threshold' },
  { key: 'rate', label: 'Hit rate, then threshold' },
  { key: 'name', label: 'Player A to Z' },
] as const
export type SortKey = (typeof SORTS)[number]['key']

export interface Row { playerId: number; player: string; team: string | null; streak: Streak }

/** Ranks rows. Thresholds are compared within one statistic only: 25+ points is not 25+ rebounds, so the order is stat first when mixed. */
export function sortRows(rows: Row[], key: SortKey): Row[] {
  const rate = (r: Row) => r.streak.hits / r.streak.games
  const by: Record<SortKey, (a: Row, b: Row) => number> = {
    level: (a, b) => b.streak.threshold / LADDER[b.streak.stat][LADDER[b.streak.stat].length - 1] - a.streak.threshold / LADDER[a.streak.stat][LADDER[a.streak.stat].length - 1] || b.streak.average - a.streak.average,
    rate: (a, b) => rate(b) - rate(a) || b.streak.threshold / LADDER[b.streak.stat][LADDER[b.streak.stat].length - 1] - a.streak.threshold / LADDER[a.streak.stat][LADDER[a.streak.stat].length - 1],
    name: (a, b) => a.player.localeCompare(b.player),
  }
  return [...rows].sort(by[key])
}
