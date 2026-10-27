// Live / final box score from ESPN's public game summary (site.api.espn.com .../summary?event=ID). Pure parsing, defensive: any missing piece becomes null, never a guess.

export interface BoxLine { id: number; name: string; starter: boolean; minutes: number | null; pts: number | null; reb: number | null; ast: number | null; fg3m: number | null }
export interface BoxTeam { abbr: string; players: BoxLine[] }
export interface LiveBox { status: string; state: 'pre' | 'in' | 'post'; teams: BoxTeam[] }

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

export function parseLiveBox(feed: any): LiveBox | null {
  const comp = feed?.header?.competitions?.[0]
  const type = comp?.status?.type ?? feed?.header?.status?.type
  const state = type?.state
  if (state !== 'pre' && state !== 'in' && state !== 'post') return null
  const teams: BoxTeam[] = []
  for (const t of feed?.boxscore?.players ?? []) {
    const block = t?.statistics?.[0]
    const names: string[] = block?.names ?? block?.keys ?? []
    const at = (k: string) => names.indexOf(k)
    const iMin = at('MIN'), iPts = at('PTS'), iReb = at('REB'), iAst = at('AST'), i3 = at('3PT')
    const players: BoxLine[] = []
    for (const a of block?.athletes ?? []) {
      const id = num(a?.athlete?.id)
      if (id === null || !a?.athlete?.displayName) continue
      const s: unknown[] = a.stats ?? []
      // 3PT arrives as "made-attempted".
      const three = i3 >= 0 && typeof s[i3] === 'string' ? num(String(s[i3]).split('-')[0]) : null
      players.push({
        id, name: String(a.athlete.displayName), starter: !!a.starter,
        minutes: iMin >= 0 ? num(s[iMin]) : null, pts: iPts >= 0 ? num(s[iPts]) : null,
        reb: iReb >= 0 ? num(s[iReb]) : null, ast: iAst >= 0 ? num(s[iAst]) : null, fg3m: three,
      })
    }
    if (t?.team?.abbreviation) teams.push({ abbr: String(t.team.abbreviation), players: players.filter((p) => p.minutes === null || p.minutes > 0 || p.pts) })
  }
  return { status: String(type?.shortDetail ?? ''), state, teams }
}
