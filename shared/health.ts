// Runtime health of a deployed copy, reported without any secret: booleans and ages only. Pure.
export type HealthStatus = 'ok' | 'degraded' | 'down'
export interface HealthCheck { name: string; ok: boolean; detail: string }

/** Tables the app reads or writes. If one is missing the migrations were not applied to this database. */
export const REQUIRED_TABLES = ['meta', 'players', 'games', 'player_games', 'projections', 'predictions', 'odds_runs', 'odds_quotes', 'odds_snapshot'] as const

export interface HealthInput {
  oddsKeySet: boolean
  captureTokenSet: boolean
  tables: string[]
  lastSync: string | null            // 'YYYY-MM-DD HH:MM:SS' UTC, as SQLite writes it
  newestGame: string | null          // 'YYYY-MM-DD'
  newestProjection: string | null    // same format as lastSync
  now: number
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
  const proj = ageHours(i.newestProjection, i.now)
  checks.push({ name: 'projections', ok: proj !== null && proj <= 36, detail: proj === null ? 'none stored' : `newest is ${Math.round(proj)} hours old${proj > 36 ? ' (older than the 24-hour limit the engine enforces: lines fall back to the simple model)' : ''}` })
  const status: HealthStatus = missing.length ? 'down' : checks.every((c) => c.ok) ? 'ok' : 'degraded'
  return { status, checks }
}
