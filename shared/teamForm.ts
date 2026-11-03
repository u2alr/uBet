// Team head-to-head and common-opponent evidence for one game, from past results. The app feeds it THIS SEASON's regular-season results only. Pure: no network, no database, no clock.
// "ATL beat the Lakers and MEM lost to the Lakers" is a common-opponent comparison: weak evidence on its own (rosters change, venues differ, one game is noisy),
// so it is shown as facts with a tally and is NOT part of the win chance. Results are win or loss only: the stored box scores are not complete enough for margins.

export interface TeamResult {
  /** ISO date of the game. */
  date: string
  /** Team abbreviation, and the opponent's. */
  team: string
  opp: string
  home: boolean
  won: boolean
}

export interface Meeting { date: string; winner: string; home: string }
export interface VsOpponent { date: string; won: boolean; home: boolean }

export interface CommonOpponent {
  opp: string
  a: VsOpponent[]
  b: VsOpponent[]
  /** 'a' or 'b': that team did better against this opponent; 'even': they got the same result. Judged on each team's most recent game against them. */
  verdict: 'a' | 'b' | 'even'
}

export interface TeamForm {
  a: string
  b: string
  /** Meetings between the two, newest first. */
  meetings: Meeting[]
  aWins: number
  bWins: number
  common: CommonOpponent[]
  /** How many common opponents favour each side (those with the same result for both are not counted). */
  tally: { a: number; b: number; even: number }
}

const byNewest = (x: { date: string }, y: { date: string }) => y.date.localeCompare(x.date)

/**
 * `results` holds both teams' games (either team may appear as `team`). `asOf` (ISO date) leaves out games on or after it, so the same function can
 * judge a past game with only what was known then. `perOpponent` caps how many recent games against one opponent count.
 */
export function teamForm(a: string, b: string, results: TeamResult[], asOf?: string, perOpponent = 2): TeamForm {
  const past = results.filter((r) => !asOf || r.date < asOf).sort(byNewest)

  // Direct meetings: seen from either side, counted once per date.
  const seen = new Set<string>()
  const meetings: Meeting[] = []
  for (const r of past) {
    if (!((r.team === a && r.opp === b) || (r.team === b && r.opp === a))) continue
    if (seen.has(r.date)) continue
    seen.add(r.date)
    const winner = r.won ? r.team : r.opp
    meetings.push({ date: r.date, winner, home: r.home ? r.team : r.opp })
  }

  const vs = (team: string) => {
    const m = new Map<string, VsOpponent[]>()
    for (const r of past) {
      if (r.team !== team || r.opp === a || r.opp === b) continue
      const list = m.get(r.opp) ?? m.set(r.opp, []).get(r.opp)!
      if (list.length < perOpponent) list.push({ date: r.date, won: r.won, home: r.home })
    }
    return m
  }
  const va = vs(a), vb = vs(b)
  const common: CommonOpponent[] = []
  for (const [opp, la] of va) {
    const lb = vb.get(opp)
    if (!lb) continue
    const verdict = la[0].won === lb[0].won ? 'even' : la[0].won ? 'a' : 'b'
    common.push({ opp, a: la, b: lb, verdict })
  }
  // Informative comparisons first, then the most recent.
  const rank = (c: CommonOpponent) => (c.verdict === 'even' ? 1 : 0)
  common.sort((x, y) => rank(x) - rank(y) || byNewest(x.a[0], y.a[0]))

  const tally = { a: common.filter((c) => c.verdict === 'a').length, b: common.filter((c) => c.verdict === 'b').length, even: common.filter((c) => c.verdict === 'even').length }
  return { a, b, meetings, aWins: meetings.filter((m) => m.winner === a).length, bWins: meetings.filter((m) => m.winner === b).length, common, tally }
}

/** The side the common opponents favour, or null when they do not point one way. */
export function commonLean(f: TeamForm): 'a' | 'b' | null {
  if (f.tally.a === f.tally.b) return null
  return f.tally.a > f.tally.b ? 'a' : 'b'
}
