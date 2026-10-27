// Schedule, rest, travel and workload FACTS for an upcoming game. Pure: no network, no clock, no database.
//
// What this is: observations computed from games that were actually played before the target game, and from a static table of arena locations
// (shared/arenas.json). Travel is an ESTIMATE from city-level coordinates. We do not know flights, departure or arrival times, hotels or sleep.
// What this is not: a model. Nothing here changes a probability. Whether any of it moves a prediction is decided by the pre-registered ablation
// (research/PREREG_HUMAN_FACTORS.md, results in research/RESULTS_HUMAN_FACTORS.md), and the UI says so.
import arenas from './arenas.json' with { type: 'json' }

const ARENA = arenas.teams as Record<string, { lat: number; lon: number; tz: number; elevationFt: number }>

export const MAX_GAP_DAYS = 10
export const SAME_CITY_MILES = 25

export interface PlayedGame {
  id: string
  /** The game's date in Eastern time, YYYY-MM-DD. */
  date: string
  homeAbbr: string
  awayAbbr: string
  /** True/false if known that the game went to overtime; null when it cannot be known (partial box scores). */
  overtime?: boolean | null
}

export interface UpcomingGame { id: string; date: string; tipIso: string | null; homeAbbr: string; awayAbbr: string }

export interface TravelEstimate { miles: number; tzShift: number; direction: 'east' | 'west' | 'none'; sameCity: boolean; label: 'estimate from city locations' }

export type B2bType = 'home_to_home' | 'road_to_road' | 'road_to_home' | 'home_to_road'

export interface TeamFacts {
  team: string
  isHome: boolean
  previous: { date: string; wasHome: boolean; city: string } | null
  restDays: number | null
  /** The previous game's tip time is not stored, only its date, so hours are a RANGE under stated assumptions; null when either time is unknown. */
  hoursSinceRange: [number, number] | null
  backToBack: boolean
  b2bType: B2bType | null
  threeInFour: boolean
  fourInSix: boolean
  gamesLast7: number
  gamesLast14: number
  overtimeInPrevious: boolean | null
  travel: TravelEstimate | null
  roadTripGames: number
  elevation: { gameFt: number | null; climbFt: number | null }
  /** Every input that could not be established, by name. A fact is never filled in. */
  unknown: string[]
}

const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400_000)
export const haversineMiles = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const r = (x: number) => (x * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

/** Eastern-time wall clock (date, hour, minute) to a UTC timestamp, honouring daylight saving. */
function easternToUtc(date: string, hour: number, minute = 0): number {
  const wanted = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)   // the wall-clock reading, as if it were UTC
  const guess = wanted + 5 * 3600_000                                                                          // first guess: standard time (UTC-5)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map((p) => [p.type, Number(p.value)]))
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)                    // what that guess reads as in Eastern time
  return guess - (shown - wanted)
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10)

/**
 * Facts for ONE team before ONE upcoming game, from games it actually played. Only games dated before the target date count; duplicate records collapse by
 * game id; a game that was postponed is simply not in `played`, so it can never be mistaken for the previous game.
 */
export function teamFacts(team: string, played: PlayedGame[], target: UpcomingGame): TeamFacts {
  const unknown: string[] = []
  const seen = new Set<string>()
  const prior = played
    .filter((g) => (g.homeAbbr === team || g.awayAbbr === team) && g.date < target.date)
    .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  const isHome = target.homeAbbr === team
  const here = ARENA[target.homeAbbr]
  const base: TeamFacts = {
    team, isHome, previous: null, restDays: null, hoursSinceRange: null, backToBack: false, b2bType: null, threeInFour: false, fourInSix: false, gamesLast7: 0, gamesLast14: 0,
    overtimeInPrevious: null, travel: null, roadTripGames: 0, elevation: { gameFt: here?.elevationFt ?? null, climbFt: null }, unknown,
  }
  if (!here) unknown.push('game location')
  const prev = prior[0]
  if (!prev) { unknown.push('previous game'); return base }

  const d0 = dayNumber(target.date)
  const gap = d0 - dayNumber(prev.date)
  const prevHome = prev.homeAbbr === team
  base.previous = { date: prev.date, wasHome: prevHome, city: prev.homeAbbr }
  base.restDays = Math.min(gap, MAX_GAP_DAYS)
  base.backToBack = gap === 1
  if (gap === 1) base.b2bType = prevHome ? (isHome ? 'home_to_home' : 'home_to_road') : isHome ? 'road_to_home' : 'road_to_road'
  base.threeInFour = prior.filter((g) => d0 - dayNumber(g.date) <= 3).length >= 2
  base.fourInSix = prior.filter((g) => d0 - dayNumber(g.date) <= 5).length >= 3
  base.gamesLast7 = prior.filter((g) => d0 - dayNumber(g.date) <= 7).length
  base.gamesLast14 = prior.filter((g) => d0 - dayNumber(g.date) <= 14).length
  base.overtimeInPrevious = prev.overtime ?? null
  if (base.overtimeInPrevious === null) unknown.push('overtime in the previous game')

  // Road trip: consecutive away games immediately before this one.
  for (const g of prior) { if (g.awayAbbr === team && d0 - dayNumber(g.date) <= 14 + base.roadTripGames) base.roadTripGames++; else break }

  const there = ARENA[prev.homeAbbr]
  if (!here || !there) unknown.push('travel (a location is unknown)')
  else if (gap > MAX_GAP_DAYS) unknown.push(`travel (more than ${MAX_GAP_DAYS} days since the previous game)`)
  else {
    const miles = haversineMiles(there, here)
    const tz = here.tz - there.tz
    base.travel = { miles: Math.round(miles), tzShift: tz, direction: tz > 0 ? 'east' : tz < 0 ? 'west' : 'none', sameCity: miles < SAME_CITY_MILES, label: 'estimate from city locations' }
    base.elevation.climbFt = here.elevationFt - there.elevationFt
  }

  // Hours since the previous game: its tip time is not stored, so assume it ended between 21:00 ET that night and 01:30 ET the next morning. An estimate, labelled as one.
  if (gap > MAX_GAP_DAYS) unknown.push(`hours since the previous game (${gap} days)`)
  else if (target.tipIso && Number.isFinite(Date.parse(target.tipIso))) {
    const tip = Date.parse(target.tipIso)
    const earliestEnd = easternToUtc(prev.date, 21), latestEnd = easternToUtc(addDays(prev.date, 1), 1, 30)
    base.hoursSinceRange = [Math.round(((tip - latestEnd) / 3600_000) * 10) / 10, Math.round(((tip - earliestEnd) / 3600_000) * 10) / 10]
  } else unknown.push('hours since the previous game (tip-off time unknown)')
  return base
}

export interface MatchupSummary {
  restDifferenceDays: number | null
  /** Who has the rest edge by at least a day, else 'even'; 'unknown' if either rest is unknown. */
  restEdge: 'away' | 'home' | 'even' | 'unknown'
  /** Plain statements of what is known, no probabilities. */
  notes: string[]
  /** A potential rest-and-travel disadvantage worth showing, as a FLAG for the reader. It is not a probability and not a model output. */
  flags: { team: string; reason: string }[]
}

export function matchupSummary(away: TeamFacts, home: TeamFacts): MatchupSummary {
  const notes: string[] = [], flags: MatchupSummary['flags'] = []
  const diff = away.restDays !== null && home.restDays !== null ? home.restDays - away.restDays : null
  const edge: MatchupSummary['restEdge'] = diff === null ? 'unknown' : diff >= 1 ? 'home' : diff <= -1 ? 'away' : 'even'
  for (const t of [away, home]) {
    if (t.backToBack) notes.push(`${t.team} played yesterday (${t.b2bType?.replace(/_/g, ' ')}).`)
    if (t.threeInFour) notes.push(`${t.team}: third game in four nights.`)
    if (t.travel && t.travel.miles >= 500 && !t.travel.sameCity) notes.push(`${t.team}: about ${t.travel.miles.toLocaleString()} miles since the previous game (${t.travel.direction === 'none' ? 'same time zone' : `${Math.abs(t.travel.tzShift)} h ${t.travel.direction}`}), an estimate.`)
    if (t.roadTripGames >= 3) notes.push(`${t.team}: game ${t.roadTripGames + (t.isHome ? 0 : 1)} of a road trip.`)
  }
  const burden = (t: TeamFacts, opp: TeamFacts) => t.backToBack && (t.travel?.miles ?? 0) >= 500 && (opp.restDays ?? 0) >= 2
  if (burden(away, home)) flags.push({ team: away.team, reason: `${away.team} played yesterday and travelled an estimated ${away.travel!.miles.toLocaleString()} miles; ${home.team} has had ${home.restDays} days.` })
  if (burden(home, away)) flags.push({ team: home.team, reason: `${home.team} played yesterday and travelled an estimated ${home.travel!.miles.toLocaleString()} miles; ${away.team} has had ${away.restDays} days.` })
  if (home.elevation.gameFt !== null && home.elevation.gameFt >= 4000 && (away.elevation.climbFt ?? 0) >= 3000) notes.push(`${away.team} plays at about ${home.elevation.gameFt.toLocaleString()} feet (a climb of ${away.elevation.climbFt!.toLocaleString()} feet from its previous game).`)
  return { restDifferenceDays: diff, restEdge: edge, notes, flags }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Player workload

export interface PlayerGame { date: string; minutes: number }
export interface WorkloadFacts {
  lastGameMinutes: number | null
  averageLast10: number | null
  /** Minutes in the previous 3, 5, 7 and 14 days (dates strictly before the target). */
  cumulative: { d3: number; d5: number; d7: number; d14: number }
  /** The previous game was at least 6 minutes above his average over the 10 games before it. A heavy game for HIM, whatever his role. */
  heavyLastGame: boolean | null
  daysSincePrevious: number | null
  /** 'possible': a gap of 8 days or more inside a season. The reason (injury, rest, suspension) is NOT known. */
  returning: 'no' | 'possible' | 'unknown'
  unknown: string[]
}

export function workloadFacts(games: PlayerGame[], targetDate: string): WorkloadFacts {
  const prior = games.filter((g) => g.date < targetDate && g.minutes > 0).sort((a, b) => b.date.localeCompare(a.date))
  const unknown: string[] = []
  const d0 = dayNumber(targetDate)
  const within = (n: number) => Math.round(prior.filter((g) => d0 - dayNumber(g.date) <= n).reduce((a, g) => a + g.minutes, 0) * 10) / 10
  if (!prior.length) return { lastGameMinutes: null, averageLast10: null, cumulative: { d3: 0, d5: 0, d7: 0, d14: 0 }, heavyLastGame: null, daysSincePrevious: null, returning: 'unknown', unknown: ['previous games'] }
  const last = prior[0]
  const before = prior.slice(1, 11)
  const avg10 = prior.slice(0, 10).reduce((a, g) => a + g.minutes, 0) / Math.min(prior.length, 10)
  const heavy = before.length >= 3 ? last.minutes - before.reduce((a, g) => a + g.minutes, 0) / before.length >= 6 : null
  if (heavy === null) unknown.push('workload baseline (fewer than 4 games)')
  const gap = d0 - dayNumber(last.date)
  return {
    lastGameMinutes: last.minutes, averageLast10: Math.round(avg10 * 10) / 10, cumulative: { d3: within(3), d5: within(5), d7: within(7), d14: within(14) }, heavyLastGame: heavy,
    daysSincePrevious: gap, returning: gap >= 8 && gap <= 120 ? 'possible' : 'no', unknown,
  }
}
