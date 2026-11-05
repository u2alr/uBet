// Projected lineups with each player's injury status, the way a lineup page reads: five likely starters per team, flagged Out / Doubtful / Questionable / Probable.
// Pure: no network, no database, no clock.
//
// The ONLY source of flags is the NBA's official injury report (the PDFs on official.nba.com, stored by research/nba_injury_pdf.py). No other feed is read here. When the league has no
// entry for a team and game (not yet submitted, nobody listed, or no report for that game), the default projected lineup is shown with no flags.
//
// Two honest limits. Starters are PROJECTED, not confirmed: they are the five players with the most minutes per game over the team's last 10 games (a game a player missed counts as 0
// minutes, so someone out for weeks drops away). Real lineups are posted about 30 minutes before tip and are not available here. And a status is a listing, not a prediction: the
// league's report says "Questionable", not how likely he is to play.
import { normName } from './picks.ts'

export type LineupStatus = 'out' | 'doubtful' | 'questionable' | 'probable'
export const STATUS_LABEL: Record<LineupStatus, string> = { out: 'Out', doubtful: 'Doubtful', questionable: 'Questionable', probable: 'Probable' }
const SEVERITY: Record<LineupStatus, number> = { out: 4, doubtful: 3, questionable: 2, probable: 1 }
export const STARTERS = 5
export const NEXT_UP = 3
/** An official report older than this is not trusted for tonight's games. */
export const MAX_REPORT_AGE_HOURS = 36

/** What the league's report says about one team in one game: 'listed' (at least one player), 'clear' (the game is on the report and the team filed, nobody listed), 'not_submitted' (the report
 *  says the team has not filed), or 'absent' (the game is not on the newest report, or there is no recent report). Only 'listed' carries flags. */
export type ReportState = 'listed' | 'clear' | 'not_submitted' | 'absent'

export interface Listing { status: LineupStatus; reason: string }
export interface Candidate {
  id: number; name: string
  /** Minutes per game over the team's last games, a missed game counting as 0. */
  avgMin: number
  /** The date (YYYY-MM-DD) of his latest game within the team's last 10, and how many of the team's games since then he missed (0 if he played the latest one). */
  lastPlayed?: string | null
  missed?: number | null
}
export interface LineupPlayer { id: number; name: string; avgMin: number; listing: Listing | null; lastPlayed: string | null; missed: number | null }
export interface TeamLineup {
  starters: LineupPlayer[]
  /** The next players by minutes who are not listed Out or Doubtful: who steps in when a starter is out. */
  nextUp: LineupPlayer[]
  /** Listed players who are not in the five or the next three (an injured reserve, a rotation player on the report). */
  alsoListed: { name: string; listing: Listing; lastPlayed?: string | null }[]
  state: ReportState
  /** The league's printed time of the report behind the flags ('YYYY-MM-DD HH:MM' Eastern), or null when there is no entry for this team. */
  asOf: string | null
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
const unglue = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2')
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
  return null                                   // "Available" and "NOT_SUBMITTED": nothing to flag
}

export interface OfficialRow { team: string; player: string; status: string; reason: string | null; game_date: string | null; matchup?: string | null }

/** The rows of the report that belong to THIS game: its date and its matchup ("AWAY@HOME", the league's own team codes). A row for the same team on another day, or in another game, is never used. */
function gameRows(rows: OfficialRow[], gameDate: string, matchup: string): OfficialRow[] {
  return rows.filter((r) => r.game_date === gameDate && r.matchup === matchup)
}

/** What the report says about one team in one game (see ReportState). */
export function reportState(rows: OfficialRow[], teamAbbr: string, gameDate: string, matchup: string): ReportState {
  const game = gameRows(rows, gameDate, matchup)
  if (!game.length) return 'absent'
  const mine = game.filter((r) => r.team === teamAbbr)
  if (mine.some((r) => r.status === 'NOT_SUBMITTED')) return 'not_submitted'
  return mine.some((r) => statusFromOfficial(r.status) && cleanReason(r.reason) !== 'G League') ? 'listed' : 'clear'
}

/** Listings for one team in one game from the league's report: key -> listing. Empty when the team has no entry for this game. */
export function officialListings(rows: OfficialRow[], teamAbbr: string, gameDate: string, matchup: string): Map<string, Listing & { display: string }> {
  const out = new Map<string, Listing & { display: string }>()
  for (const r of gameRows(rows, gameDate, matchup).filter((x) => x.team === teamAbbr)) {
    const status = statusFromOfficial(r.status)
    if (!status) continue
    const key = officialKey(r.player)
    const cur = out.get(key)
    if (!cur || SEVERITY[status] > SEVERITY[cur.status]) out.set(key, { status, reason: cleanReason(r.reason), display: officialDisplay(r.player) })
  }
  return out
}

/** "Injury/Illness-LeftAnkleSprain" -> "Left Ankle Sprain"; a G League assignment is not an injury and is dropped. */
export function cleanReason(raw: string | null | undefined): string {
  if (!raw) return ''
  if (/^g-?league/i.test(raw)) return 'G League'
  return unglue(raw.replace(/^Injury\/Illness-?/i, '').replace(/^Injury\/Illness/i, '')).replace(/\s+/g, ' ').trim()
}

/** Hours between the report's own time ('YYYY-MM-DD HH:MM', Eastern) and `nowMs`, or null when unreadable. Eastern is taken as UTC-5 or UTC-4 by the date: close enough for a 36-hour limit. */
export function reportAgeHours(reportTime: string | null | undefined, nowMs: number): number | null {
  const m = reportTime?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 5 * 3600_000
  return Math.max(0, (nowMs - t) / 3_600_000)
}

/** The lineup of one team for one game. `listings` and `state` come from the league's report; with any state but 'listed' the default projected lineup is returned with no flags. */
export function buildLineup(candidates: Candidate[], listings: Map<string, Listing & { display: string }>, state: ReportState, asOf: string | null = null): TeamLineup {
  const use = state === 'listed' ? listings : new Map<string, Listing & { display: string }>()
  const ranked = [...candidates].filter((c) => c.avgMin > 0).sort((a, b) => b.avgMin - a.avgMin || a.name.localeCompare(b.name))
  const as = (c: Candidate): LineupPlayer => ({ id: c.id, name: c.name, avgMin: Math.round(c.avgMin * 10) / 10, listing: use.get(nameKey(c.name)) ?? null, lastPlayed: c.lastPlayed ?? null, missed: c.missed ?? null })
  const starters = ranked.slice(0, STARTERS).map(as)
  const pool = ranked.slice(STARTERS).map(as)
  const nextUp = pool.filter((p) => !p.listing || (p.listing.status !== 'out' && p.listing.status !== 'doubtful')).slice(0, NEXT_UP)
  const shown = new Set([...starters, ...nextUp].map((p) => nameKey(p.name)))
  const alsoListed = [...use.entries()]
    .filter(([k, l]) => !shown.has(k) && l.reason !== 'G League')
    .map(([, l]) => ({ name: l.display, listing: { status: l.status, reason: l.reason } }))
    .sort((a, b) => SEVERITY[b.listing.status] - SEVERITY[a.listing.status] || a.name.localeCompare(b.name))
  return { starters, nextUp, alsoListed, state, asOf: state === 'absent' ? null : asOf }
}
