// Projected lineups with each player's injury status, the way a lineup page reads: five likely starters per team, flagged Out / Doubtful / Questionable / Probable.
// Pure: no network, no database, no clock.
//
// Two honest limits. Starters are PROJECTED, not confirmed: they are the five players with the most minutes per game over the team's last 10 games (a game a player missed counts as 0
// minutes, so someone out for weeks drops away). Real lineups are posted about 30 minutes before tip and are not available here. And a status is a listing, not a prediction: the
// league's report says "Questionable", not how likely he is to play.
import { normName } from './picks.ts'
import type { Injury, InjuryStatus } from './injuries.ts'

export type LineupStatus = 'out' | 'doubtful' | 'questionable' | 'probable' | 'gtd'
export const STATUS_LABEL: Record<LineupStatus, string> = { out: 'Out', doubtful: 'Doubtful', questionable: 'Questionable', probable: 'Probable', gtd: 'Game-time' }
const SEVERITY: Record<LineupStatus, number> = { out: 5, doubtful: 4, questionable: 3, gtd: 2, probable: 1 }
export const STARTERS = 5
export const NEXT_UP = 3
/** An official report older than this is not trusted for tonight's games. */
export const MAX_REPORT_AGE_HOURS = 36

export interface Listing { status: LineupStatus; reason: string; source: 'official' | 'espn'; /** A longer news line (ESPN's), for a tooltip only. */ note?: string }
export interface Candidate { id: number; name: string; /** Minutes per game over the team's last games, a missed game counting as 0. */ avgMin: number }
export interface LineupPlayer { id: number; name: string; avgMin: number; listing: Listing | null }
export interface TeamLineup {
  starters: LineupPlayer[]
  /** The next players by minutes who are not listed Out or Doubtful: who steps in when a starter is out. */
  nextUp: LineupPlayer[]
  /** Listed players who are not in the five or the next three (an injured reserve, a rotation player on the report). */
  alsoListed: { name: string; listing: Listing }[]
  source: 'official' | 'espn' | 'none'
}

/** Letters only, lower case, accents and generational suffixes removed: the form two spellings of one name share ("Jaren Jackson Jr." and "JacksonJr.,Jaren"). */
export function nameKey(s: string): string {
  const k = normName(s).replace(/[^a-z]/g, '')
  return k.replace(/(jr|sr|iii|ii|iv)$/, '')
}

/** The league's PDF prints "Last,First" with the spaces removed. Its key is the same as the roster spelling's. */
export const officialKey = (printed: string): string => {
  const [last, ...rest] = printed.split(',')
  return nameKey(`${rest.join('')}${last}`)
}

/** "YanicKonan" -> "Yanic Konan", "CenacJr." -> "Cenac Jr.": enough to read a name the PDF ran together. */
const unglue = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\w)(Jr\.?|Sr\.?|III|II|IV)$/, '$1 $2')
export function officialDisplay(printed: string): string {
  const [last, ...rest] = printed.split(',')
  return `${unglue(rest.join(''))} ${unglue(last)}`.trim()
}

export function statusFromOfficial(raw: string): LineupStatus | null {
  const s = raw.toLowerCase()
  if (s === 'out') return 'out'
  if (s === 'doubtful') return 'doubtful'
  if (s === 'questionable') return 'questionable'
  if (s === 'probable') return 'probable'
  return null                                   // "Available": nothing to flag
}

export function statusFromEspn(s: InjuryStatus): LineupStatus | null {
  return s === 'out' ? 'out' : s === 'doubtful' ? 'doubtful' : s === 'questionable' ? 'questionable' : s === 'day-to-day' ? 'gtd' : null
}

export interface OfficialRow { team: string; player: string; status: string; reason: string | null; game_date: string | null }

/** Listings for one team from the league's report: key -> listing, or null when the team has no row (it has not filed, so ESPN's list is the fallback). */
export function officialListings(rows: OfficialRow[], teamAbbr: string, gameDate: string): Map<string, Listing & { display: string }> | null {
  const mine = rows.filter((r) => r.team === teamAbbr && (r.game_date == null || r.game_date === gameDate))
  if (!mine.length) return null
  const out = new Map<string, Listing & { display: string }>()
  for (const r of mine) {
    const status = statusFromOfficial(r.status)
    if (!status) continue
    const key = officialKey(r.player)
    const cur = out.get(key)
    if (!cur || SEVERITY[status] > SEVERITY[cur.status]) out.set(key, { status, reason: cleanReason(r.reason), source: 'official', display: officialDisplay(r.player) })
  }
  return out
}

/** "Injury/Illness-LeftAnkleSprain" -> "Left Ankle Sprain"; a G League assignment is not an injury and is dropped. */
export function cleanReason(raw: string | null | undefined): string {
  if (!raw) return ''
  if (/^g-?league/i.test(raw)) return 'G League'
  return unglue(raw.replace(/^Injury\/Illness-?/i, '').replace(/^Injury\/Illness/i, '')).replace(/\s+/g, ' ').trim()
}

/** Listings for one team from ESPN's feed, `inj` being the whole feed by normalised name and `isTeam` telling which entries belong to the team. */
export function espnListings(inj: Map<string, Injury>, isTeam: (injury: Injury) => boolean): Map<string, Listing & { display: string }> {
  const out = new Map<string, Listing & { display: string }>()
  for (const i of inj.values()) {
    if (!isTeam(i)) continue
    const status = statusFromEspn(i.status)
    if (!status || !i.name) continue
    out.set(nameKey(i.name), { status, reason: '', note: i.note.slice(0, 240), source: 'espn', display: i.name })
  }
  return out
}

/** Hours between the report's own time ('YYYY-MM-DD HH:MM', Eastern) and `nowMs`, or null when unreadable. Eastern is taken as UTC-5 or UTC-4 by the date: close enough for a 36-hour limit. */
export function reportAgeHours(reportTime: string | null | undefined, nowMs: number): number | null {
  const m = reportTime?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 5 * 3600_000
  return Math.max(0, (nowMs - t) / 3_600_000)
}

export function buildLineup(candidates: Candidate[], official: Map<string, Listing & { display: string }> | null, espn: Map<string, Listing & { display: string }>): TeamLineup {
  const listings = official ?? espn
  const source: TeamLineup['source'] = official ? 'official' : espn.size ? 'espn' : 'none'
  const ranked = [...candidates].filter((c) => c.avgMin > 0).sort((a, b) => b.avgMin - a.avgMin || a.name.localeCompare(b.name))
  const as = (c: Candidate): LineupPlayer => ({ id: c.id, name: c.name, avgMin: Math.round(c.avgMin * 10) / 10, listing: listings.get(nameKey(c.name)) ?? null })
  const starters = ranked.slice(0, STARTERS).map(as)
  const pool = ranked.slice(STARTERS).map(as)
  const nextUp = pool.filter((p) => !p.listing || (p.listing.status !== 'out' && p.listing.status !== 'doubtful')).slice(0, NEXT_UP)
  const shown = new Set([...starters, ...nextUp].map((p) => nameKey(p.name)))
  const alsoListed = [...listings.entries()]
    .filter(([k, l]) => !shown.has(k) && l.reason !== 'G League')
    .map(([, l]) => ({ name: l.display, listing: { status: l.status, reason: l.reason, source: l.source, ...(l.note ? { note: l.note } : {}) } }))
    .sort((a, b) => SEVERITY[b.listing.status] - SEVERITY[a.listing.status] || a.name.localeCompare(b.name))
  return { starters, nextUp, alsoListed, source }
}
