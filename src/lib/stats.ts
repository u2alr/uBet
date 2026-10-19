import type { Stat } from '../../shared/baseline'

export interface GameRow {
  date: string; season: number; gameType: 'regular' | 'playoffs' | 'preseason'; opp: string | null; home: 0 | 1; won: 0 | 1; minutes: number
  pts: number; reb: number; ast: number; fg3m: number; stl: number; blk: number
  fgm: number; fga: number; fg3a: number; ftm: number; fta: number
  oreb: number; dreb: number; tov: number; pf: number; plusMinus: number
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

const ratio = (a: number, b: number) => (b ? (a / b) * 100 : null)
export const fgPct = (g: GameRow) => ratio(g.fgm, g.fga)
export const fg3Pct = (g: GameRow) => ratio(g.fg3m, g.fg3a)
export const ftPct = (g: GameRow) => ratio(g.ftm, g.fta)

/** True shooting %: points over 2 * (FGA + 0.44 FTA). */
export const tsPct = (g: GameRow) => ratio(g.pts, 2 * (g.fga + 0.44 * g.fta))

/** Oldest-first series for a stat with a trailing rolling average. */
export function trend(games: GameRow[], stat: Stat, window = 5, limit = 30) {
  const asc = [...games].reverse()
  return asc.map((g, i) => ({
    date: g.date.slice(5),
    opp: g.opp,
    value: g[stat],
    minutes: g.minutes,
    rolling: Number(mean(asc.slice(Math.max(0, i - window + 1), i + 1).map((x) => x[stat])).toFixed(1)),
  })).slice(-limit)
}

export function shootingTrend(games: GameRow[], limit = 30) {
  const asc = [...games].reverse().slice(-limit)
  return asc.map((g) => ({
    date: g.date.slice(5),
    fg: fgPct(g), three: fg3Pct(g), ft: ftPct(g), ts: tsPct(g),
  }))
}

/** Average of `stat` split by a predicate: [label, avg, games]. */
export function split(games: GameRow[], stat: Stat, groups: [string, (g: GameRow) => boolean][]) {
  return groups.map(([label, fn]) => {
    const sub = games.filter(fn)
    return { label, avg: Number(mean(sub.map((g) => g[stat])).toFixed(1)), games: sub.length }
  })
}

export function byOpponent(games: GameRow[], stat: Stat) {
  const m = new Map<string, number[]>()
  for (const g of games) if (g.opp) m.set(g.opp, [...(m.get(g.opp) ?? []), g[stat]])
  return [...m]
    .map(([opp, v]) => ({ opp, avg: Number(mean(v).toFixed(1)), games: v.length }))
    .sort((a, b) => b.avg - a.avg)
}

/** Histogram of a stat: how often each value occurred. */
export function distribution(games: GameRow[], stat: Stat) {
  const counts = new Map<number, number>()
  for (const g of games) counts.set(g[stat], (counts.get(g[stat]) ?? 0) + 1)
  if (!counts.size) return []
  const lo = Math.min(...counts.keys()), hi = Math.max(...counts.keys())
  return Array.from({ length: hi - lo + 1 }, (_, i) => ({ value: lo + i, count: counts.get(lo + i) ?? 0 }))
}

/** Season-by-season averages across the stats shown in the log. */
export function perSeason(games: GameRow[]) {
  const m = new Map<string, GameRow[]>()
  for (const g of games) {
    const k = `${g.season}|${g.gameType}`
    m.set(k, [...(m.get(k) ?? []), g])
  }
  return [...m]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([, gs]) => ({
      season: `${gs[0].season}-${String(gs[0].season + 1).slice(2)}${gs[0].gameType === 'playoffs' ? ' PO' : ''}`,
      games: gs.length,
      min: mean(gs.map((g) => g.minutes)),
      pts: mean(gs.map((g) => g.pts)),
      reb: mean(gs.map((g) => g.reb)),
      ast: mean(gs.map((g) => g.ast)),
      fg3m: mean(gs.map((g) => g.fg3m)),
      fgPct: ratio(gs.reduce((a, g) => a + g.fgm, 0), gs.reduce((a, g) => a + g.fga, 0)),
      ts: ratio(gs.reduce((a, g) => a + g.pts, 0), 2 * gs.reduce((a, g) => a + g.fga + 0.44 * g.fta, 0)),
    }))
}
