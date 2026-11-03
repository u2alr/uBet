// Runs the REAL Worker (wrangler pages dev) against a fake SharpAPI and a throwaway copy of the local
// database, so integration tests and probes can never use the real provider's request allowance or touch your real prediction log.
import { spawn, execSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { server as fake } from './fake_odds_server.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REAL_STATE = join(ROOT, '.wrangler', 'state')
const TEST_STATE = join(ROOT, '.wrangler', 'test-state')
export const FAKE_PORT = 9977
export const APP_PORT = 8791
export const APP = `http://127.0.0.1:${APP_PORT}`
export const FAKE = `http://127.0.0.1:${FAKE_PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Copy the local D1 into a scratch directory and empty the tables tests write to. */
export function freshState() {
  if (!existsSync(REAL_STATE)) throw new Error('No local database found. Run npm run db:migrate and sync some players first.')
  // Windows can still hold a lock on the previous run's files for a moment after its worker is killed; retry instead of failing the whole file.
  rmSync(TEST_STATE, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  cpSync(REAL_STATE, TEST_STATE, { recursive: true })
  const dir = join(TEST_STATE, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sqlite'))) {
    const db = new DatabaseSync(join(dir, f))
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name))
      if (!tables.has('predictions')) continue
      db.exec("DELETE FROM predictions; DELETE FROM odds_raw; DELETE FROM odds_snapshot; DELETE FROM meta WHERE key = 'last_pick_log';")
    } finally { db.close() }
  }
  rmSync(join(TEST_STATE, 'v3', 'cache'), { recursive: true, force: true })  // never inherit cached upstream responses
  // These tests exercise the join between the fake odds and real synced box scores. An empty database (a fresh clone after db:migrate only) cannot run them: say so plainly.
  const check = openScratch()
  try {
    const n = check.prepare('SELECT COUNT(*) AS n FROM player_games').get().n
    if (n === 0) throw new Error('The local database has no synced box scores (player_games is empty). Run ingest/sync.py first; these integration tests need real synced players such as Cade Cunningham and Victor Wembanyama.')
  } finally { check.close() }
}

/** Open the scratch copy of the app database (the file that holds the `predictions` table). */
export function openScratch() {
  const dir = join(TEST_STATE, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sqlite'))) {
    const db = new DatabaseSync(join(dir, f))
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='predictions'").get()
    if (has) return db
    db.close()
  }
  throw new Error('scratch database not found')
}

/**
 * Settings the tests depend on. wrangler also reads the developer's .dev.vars, so anything the tests rely on is pinned here: a developer who changes
 * their own ODDS_HOURS or ODDS_BOOKS must not change what the suite sees. A test can still override any of these through `extraBindings`.
 */
const HERMETIC = [['ODDS_MAX_EVENTS', '8'], ['ODDS_HOURS', '40']]

export async function start({ extraBindings = [], seed } = {}) {
  freshState()
  if (seed) {
    const db = openScratch()
    try { seed(db) } finally { db.close() }
  }
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r))
  const args = ['wrangler', 'pages', 'dev', '--port', String(APP_PORT), '--persist-to', TEST_STATE,
    '--binding', `SHARPAPI_BASE_URL=${FAKE}/api/v1`, '--binding', `ESPN_BASE_URL=${FAKE}`, '--binding', 'SHARPAPI_KEY=test-key-not-real', ...HERMETIC.filter(([k]) => !extraBindings.some((b) => b.startsWith(`${k}=`))).flatMap(([k, v]) => ['--binding', `${k}=${v}`]), ...extraBindings.flatMap((b) => ['--binding', b])]
  const win = process.platform === 'win32'
  // On POSIX the server gets its own process group so the whole tree (npx, wrangler, workerd) can be stopped; taskkill does that on Windows.
  const child = spawn('npx', args, { cwd: ROOT, shell: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (b) => { log += b })
  child.stderr.on('data', (b) => { log += b })
  for (let i = 0; i < 180; i++) {   // wrangler can spend ~30 s trying to reach Cloudflare for request metadata on a restricted network
    try { if ((await fetch(`${APP}/api/status`)).status < 500) break } catch {}
    if (i === 179) throw new Error('Worker did not start:\n' + log.slice(-1500))
    await sleep(1000)
  }
  const stop = async () => {
    try {
      if (win) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
      else process.kill(-child.pid, 'SIGKILL')
    } catch {}
    await new Promise((r) => fake.close(r))
    // Do not return until the port is free, so the next test file can bind it.
    for (let i = 0; i < 30; i++) {
      try { await fetch(`${APP}/api/status`) } catch { break }
      await sleep(500)
    }
  }
  return { stop, log: () => log }
}

export const setUpstreamFailing = async (on) => (await fetch(`${FAKE}/__fail?on=${on ? 1 : 0}`)).json()
export const upstreamStats = async () => (await fetch(`${FAKE}/__stats`)).json()
export const upstreamReset = async () => (await fetch(`${FAKE}/__reset`)).json()
export const api = async (path, init) => {
  const res = await fetch(`${APP}/api${path}`, init)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, headers: res.headers }
}
