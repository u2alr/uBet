import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECOMMENDED_TABLES, REQUIRED_TABLES, evaluateHealth, type HealthInput } from './health.ts'

const NOW = Date.parse('2026-10-26T12:00:00Z')
const ok = (): HealthInput => ({ oddsKeySet: true, captureTokenSet: true, tables: [...REQUIRED_TABLES, ...RECOMMENDED_TABLES], lastSync: '2026-10-26 06:00:00', newestGame: '2026-10-25', newestProjection: '2026-10-26 08:00:00', now: NOW })

test('everything in place is ok', () => assert.equal(evaluateHealth(ok()).status, 'ok'))

test('a missing table means the migrations were not applied: down, and it says which', () => {
  const i = ok(); i.tables = i.tables.filter((t) => t !== 'odds_quotes')
  const r = evaluateHealth(i)
  assert.equal(r.status, 'down'); assert.match(r.checks[0].detail, /odds_quotes/)
})

test('missing keys and stale data degrade the status without making it down', () => {
  const i = ok(); i.oddsKeySet = false; i.captureTokenSet = false; i.lastSync = '2026-10-20 00:00:00'; i.newestProjection = '2026-10-23 00:00:00'
  const r = evaluateHealth(i)
  assert.equal(r.status, 'degraded')
  assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.name), ['odds provider key', 'access token', 'box scores', 'projections'])
})

test('out of season, old box scores are not a problem', () => {
  const i = ok(); i.lastSync = '2026-06-01 00:00:00'; i.newestGame = '2026-06-20'
  assert.equal(evaluateHealth(i).checks.find((c) => c.name === 'box scores')!.ok, true)
})

test('the report contains booleans, counts and ages only: no value from the environment can appear in it', () => {
  const text = JSON.stringify(evaluateHealth({ ...ok(), tables: [...REQUIRED_TABLES, ...RECOMMENDED_TABLES] }))
  assert.doesNotMatch(text, /[A-Fa-f0-9]{24,}/)
})

test('with player props off an empty projections table is not a fault, and with them on it still is', () => {
  const off = { ...ok(), newestProjection: null, propsOn: false }
  assert.equal(evaluateHealth(off).status, 'ok')
  assert.equal(evaluateHealth(off).checks.some((c) => c.name === 'projections'), false)
  assert.equal(evaluateHealth({ ...ok(), newestProjection: null, propsOn: true }).status, 'degraded')
})

test('the newer tables are recommended, not required: missing ones degrade the status and are named', () => {
  const i = { ...ok(), tables: [...REQUIRED_TABLES] }
  const r = evaluateHealth(i)
  assert.equal(r.status, 'degraded')
  assert.match(r.checks.find((c) => c.name === 'newer tables')!.detail, /nba_injury_report/)
})

test('stored odds, model numbers and the NBA injury report each have an age limit, and each says what the pages do when it is exceeded', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  const fresh = { ...ok(), now, lastSync: '2026-11-05 06:00:00', newestGame: '2026-11-04', newestProjection: '2026-11-05 08:00:00', oddsGamesFetchedAt: now - 3600_000, modelAsOf: '2026-11-05 03:00', injuryReportAt: '2026-11-05 06:00' }
  assert.equal(evaluateHealth(fresh).status, 'ok')
  const stale = evaluateHealth({ ...fresh, oddsGamesFetchedAt: now - 20 * 3600_000, modelAsOf: '2026-11-03 03:00', injuryReportAt: '2026-11-03 06:00' })
  assert.equal(stale.status, 'degraded')
  assert.deepEqual(stale.checks.filter((c) => !c.ok).map((c) => c.name), ['game odds', 'model numbers', 'NBA injury report'])
  assert.match(stale.checks.find((c) => c.name === 'NBA injury report')!.detail, /default lineup with no flags/)
  const none = evaluateHealth({ ...fresh, oddsGamesFetchedAt: null, modelAsOf: null, injuryReportAt: null })
  assert.deepEqual(none.checks.filter((c) => !c.ok).map((c) => c.name), ['game odds', 'model numbers', 'NBA injury report'])
})
