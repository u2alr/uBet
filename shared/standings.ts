// Parses ESPN's standings feed into plain rows. Pure: no network, no clock.
import { normAbbr } from './teamCodes.ts'

export interface StandingRow {
  abbr: string; team: string; seed: number; wins: number; losses: number; winPct: number; gamesBehind: number
  home: string; road: string; last10: string; streak: string; diff: number; ptsFor: number; ptsAgainst: number
}
export interface Conference { name: string; rows: StandingRow[] }

type Stat = { name?: string; displayValue?: string; value?: number }
interface Entry { team?: { abbreviation?: string; displayName?: string }; stats?: Stat[] }

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

export function parseStandings(feed: unknown): Conference[] {
  const kids = (feed as { children?: { name?: string; standings?: { entries?: Entry[] } }[] } | null)?.children
  if (!Array.isArray(kids)) return []
  return kids.filter((k) => k && typeof k === 'object').map((k) => {
    const rows: StandingRow[] = []
    for (const e of Array.isArray(k.standings?.entries) ? k.standings.entries : []) {
      if (!e || typeof e !== 'object') continue
      const abbr = e.team?.abbreviation
      if (!abbr || !e.team?.displayName) continue
      const by = new Map((e.stats ?? []).map((s) => [s.name ?? '', s]))
      const v = (n: string) => num(by.get(n)?.value)
      const d = (n: string, fallback = '–') => by.get(n)?.displayValue ?? fallback
      rows.push({
        abbr: normAbbr(abbr), team: e.team.displayName, seed: v('playoffSeed') || 99, wins: v('wins'), losses: v('losses'),
        winPct: v('winPercent'), gamesBehind: v('gamesBehind'), home: d('Home'), road: d('Road'), last10: d('Last Ten Games'),
        streak: d('streak', ''), diff: v('pointDifferential'), ptsFor: v('pointsFor'), ptsAgainst: v('pointsAgainst'),
      })
    }
    // Seed first (ESPN's own order); ties and missing seeds fall back to record.
    rows.sort((a, b) => a.seed - b.seed || b.winPct - a.winPct || b.wins - a.wins || a.team.localeCompare(b.team))
    return { name: String(k.name ?? 'Conference').replace(/ Conference$/, ''), rows }
  })
}

/** Where a seed stands: direct playoff spot (1-6), play-in (7-10) or out. The NBA format since 2021. */
export const seedZone = (seed: number): 'playoffs' | 'play-in' | 'out' => (seed <= 6 ? 'playoffs' : seed <= 10 ? 'play-in' : 'out')
