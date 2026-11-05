// Runtime health of a deployed copy, reported without any secret: booleans and ages only. Pure.
import { reportAgeHours } from './lineups.ts'
export type HealthStatus = 'ok' | 'degraded' | 'down'
export interface HealthCheck { name: string; ok: boolean; detail: string }

/** Tables the app reads or writes. If one is missing the migrations were not applied to this database. */
export const REQUIRED_TABLES = ['meta', 'players', 'games', 'player_games', 'projections', 'predictions', 'odds_runs', 'odds_quotes', 'odds_snapshot'] as const

/** Tables the current pages need. A missing one does not stop the app, but a page loses a feature until the migrations are applied. */
export const RECOMMENDED_TABLES = ['game_lean', 'game_lean_log', 'season_review', 'gut_pick', 'nba_injury_report'] as const

/** Stored data older than this is not trusted (the same limits the pages themselves enforce). */
export const MAX_ODDS_HOURS = 12
export const MAX_MODEL_HOURS = 36
export const MAX_REPORT_HOURS = 36

export interface HealthInput {
  oddsKeySet: boolean
  captureTokenSet: boolean
  tables: string[]
  lastSync: string | null            // 'YYYY-MM-DD HH:MM:SS' UTC, as SQLite writes it
  newestGame: string | null          // 'YYYY-MM-DD'
  newestProjection: string | null    // same format as lastSync
  now: number
  /** Whether player props (and so projections) are switched on. Off by default in the app, so an empty projections table is then not a fault. Default true. */
  propsOn?: boolean
  /** When the stored game odds were fetched (ms since the epoch), when the model last scored games ('YYYY-MM-DD HH:MM' Eastern) and the newest NBA injury report's printed time (same format). Undefined: not checked. */
  oddsGamesFetchedAt?: number | null
  modelAsOf?: string | null
  injuryReportAt?: string | null
}

const ageHours = (utc: string | null, now: number) => (utc ? (now - Date.parse(`${utc.replace(' ', 'T')}Z`)) / 3600_000 : null)

export function evaluateHealth(i: HealthInput): { status: HealthStatus; checks: HealthCheck[] } {
  const checks: HealthCheck[] = []
  const missing = REQUIRED_TABLES.filter((t) => !i.tables.includes(t))
  checks.push({ name: 'database tables', ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')} (apply the migrations)` : `all ${REQUIRED_TABLES.length} present` })
  checks.push({ name: 'odds provider key', ok: i.oddsKeySet, detail: i.oddsKeySet ? 'configured' : 'not configured: no props' })
  checks.push({ name: 'access token', ok: i.captureTokenSet, detail: i.captureTokenSet ? 'configured' : 'not set: personal bets and writes are limited to localhost' })
  const sync = ageHours(i.lastSync, i.now), inSeason = i.newestGame ? (i.now - Date.parse(`${i.newestGame}T12:00:00Z`)) / 86400_000 < 14 : false
  checks.push({ name: 'box scores', ok: sync !== null && (!inSeason || sync <= 72), detail: sync === null ? 'never synced' : `synced ${Math.round(sync)} hours ago${inSeason && sync > 72 ? ' (stale during the season)' : ''}` })
  const missingRec = RECOMMENDED_TABLES.filter((t) => !i.tables.includes(t))
  if (missingRec.length) checks.push({ name: 'newer tables', ok: false, detail: `missing: ${missingRec.join(', ')} (apply the migrations; the pages that use them show less until then)` })
  if (i.oddsGamesFetchedAt !== undefined) {
    const h = i.oddsGamesFetchedAt == null ? null : (i.now - i.oddsGamesFetchedAt) / 3600_000
    checks.push({ name: 'game odds', ok: h !== null && h <= MAX_ODDS_HOURS, detail: h === null ? 'none stored: no prices on the Teams page' : `fetched ${Math.round(h)} hours ago${h > MAX_ODDS_HOURS ? ' (older than the 12 hours the page trusts)' : ''}` })
  }
  if (i.modelAsOf !== undefined) {
    const h = reportAgeHours(i.modelAsOf, i.now)
    checks.push({ name: 'model numbers', ok: h !== null && h <= MAX_MODEL_HOURS, detail: h === null ? 'none stored: the Teams page shows market chances only' : `scored ${Math.round(h)} hours ago${h > MAX_MODEL_HOURS ? ' (too old: the page ignores the model and shows the market alone)' : ''}` })
  }
  if (i.injuryReportAt !== undefined) {
    const h = reportAgeHours(i.injuryReportAt, i.now)
    checks.push({ name: 'NBA injury report', ok: h !== null && h <= MAX_REPORT_HOURS, detail: h === null ? 'none stored: lineups show the default lineup with no flags' : `printed ${Math.round(h)} hours ago${h > MAX_REPORT_HOURS ? ' (too old: lineups show the default lineup with no flags)' : ''}` })
  }
  const proj = ageHours(i.newestProjection, i.now)
  if (i.propsOn !== false) checks.push({ name: 'projections', ok: proj !== null && proj <= 36, detail: proj === null ? 'none stored' : `newest is ${Math.round(proj)} hours old${proj > 36 ? ' (older than the 24-hour limit the engine enforces: lines fall back to the simple model)' : ''}` })
  const status: HealthStatus = missing.length ? 'down' : checks.every((c) => c.ok) ? 'ok' : 'degraded'
  return { status, checks }
}
