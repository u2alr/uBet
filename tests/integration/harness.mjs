// Runs the REAL Worker (wrangler pages dev) against a fake Odds API and a throwaway copy of the local
// database, so integration tests and probes can never spend credits or touch your real prediction log.
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
  rmSync(TEST_STATE, { recursive: true, force: true })
  cpSync(REAL_STATE, TEST_STATE, { recursive: true })
  const dir = join(TEST_STATE, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sqlite'))) {
    const db = new DatabaseSync(join(dir, f))
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name))
      if (!tables.has('predictions')) continue
      db.exec('DELETE FROM predictions; DELETE FROM odds_raw;')
    } finally { db.close() }
  }
  rmSync(join(TEST_STATE, 'v3', 'cache'), { recursive: true, force: true })  // never inherit cached upstream responses
}

export async function start({ extraBindings = [] } = {}) {
  freshState()
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r))
  const args = ['wrangler', 'pages', 'dev', '--port', String(APP_PORT), '--persist-to', TEST_STATE,
    '--binding', `ODDS_BASE_URL=${FAKE}/v4/sports/basketball_nba`, '--binding', 'ODDS_API_KEY=test-key-not-real', ...extraBindings.flatMap((b) => ['--binding', b])]
  const child = spawn('npx', args, { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (b) => { log += b })
  child.stderr.on('data', (b) => { log += b })
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${APP}/api/status`)).status < 500) break } catch {}
    if (i === 89) throw new Error('Worker did not start:\n' + log.slice(-1500))
    await sleep(1000)
  }
  const stop = async () => {
    try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }) } catch {}
    await new Promise((r) => fake.close(r))
  }
  return { stop, log: () => log }
}

export const upstreamStats = async () => (await fetch(`${FAKE}/__stats`)).json()
export const upstreamReset = async () => (await fetch(`${FAKE}/__reset`)).json()
export const api = async (path, init) => {
  const res = await fetch(`${APP}/api${path}`, init)
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, headers: res.headers }
}
