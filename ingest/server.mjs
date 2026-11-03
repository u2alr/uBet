// Local helper that lets the app's Sync button run ingest/sync.py.
// A Cloudflare Worker cannot run Python, so this runs on your own machine:  npm run dev:sync
// It listens on 127.0.0.1 only and runs a fixed set of commands; nothing from the request is
// ever passed to a shell.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isSafePlayerName } from './playername.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const python = join(root, 'ingest', '.venv', 'Scripts', 'python.exe')
const script = join(root, 'ingest', 'sync.py')
const projectScript = join(root, 'research', 'project.py')
const PORT = 8789

// Only the local dev pages may call this (blocks other websites from poking it).
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8788', 'http://127.0.0.1:8788',
])

const state = { running: false, label: '', done: 0, total: 0, error: '', finishedAt: null }

function run(args, label, file = script) {
  return new Promise((resolve) => {
    state.label = label
    const child = spawn(python, ['-X', 'utf8', file, ...args], { cwd: root })
    let tail = ''
    const onData = (buf) => {
      const text = buf.toString()
      tail = (tail + text).slice(-2000)
      // sync.py prints "[12/530] Name" per player.
      const m = [...text.matchAll(/\[(\d+)\/(\d+)\]/g)].pop()
      if (m) { state.done = Number(m[1]); state.total = Number(m[2]) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (e) => { state.error = e.message; resolve(false) })
    child.on('close', (code) => {
      if (code !== 0) state.error = tail.split('\n').filter(Boolean).slice(-3).join(' | ') || `exit ${code}`
      resolve(code === 0)
    })
  })
}

// The odds sync is a Node script (SharpAPI is reachable from anywhere, unlike NBA.com): it stores game odds first, then player props, paced to the free plan.
function runNode(file, args, label) {
  return new Promise((resolve) => {
    state.label = label
    const child = spawn(process.execPath, ['--no-warnings', file, ...args], { cwd: root })
    let tail = ''
    for (const out of [child.stdout, child.stderr]) out.on('data', (b) => { tail = (tail + b.toString()).slice(-1500) })
    child.on('error', (e) => { state.error = e.message; resolve(false) })
    child.on('close', (code) => { if (code !== 0) state.error = tail.split(String.fromCharCode(10)).filter(Boolean).slice(-2).join(' | ') || `exit ${code}`; resolve(code === 0) })
  })
}

async function startSync(mode, player) {
  state.running = true
  state.error = ''
  state.done = 0
  state.total = 0
  try {
    if (mode === 'odds') {
      await runNode(join(root, 'scripts', 'sync_odds.mjs'), [], 'Syncing odds')
    } else if (mode === 'games') {
      // Re-score the upcoming games from today's injury report. No box-score sync: it reads the data already on disk, so it takes seconds.
      await run([], 'Scoring upcoming games', join(root, 'research', 'game_snapshot.py'))
    } else if (mode === 'player') {
      await run(['--seasons', '3', player], `Syncing ${player}`)
    } else if (await run(['--teams-only'], 'Updating teams')) {
      await run(['--all-active', '--seasons', '1', '--delay', '1'], 'Syncing box scores')
      // Fresh game logs -> fresh projections for the upcoming games.
      await run([], 'Updating projections', projectScript)
      // New games' matchups (incremental: only games not yet stored) and the defensive context for the next games. Display only; a failure here never blocks the rest.
      await run([], 'Refreshing league box scores', join(root, 'research', 'pull_raw.py'))   // a few league-wide calls; the research snapshots read these files
      await run([], 'Updating defensive matchups', join(root, 'research', 'pull_matchups.py'))
      await run([], 'Computing defensive context', join(root, 'research', 'defense_snapshot.py'))
      await run([], 'Scoring upcoming games', join(root, 'research', 'game_snapshot.py'))
    }
  } finally {
    state.running = false
    state.finishedAt = new Date().toISOString()
  }
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

createServer((req, res) => {
  const origin = req.headers.origin
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: 'Origin not allowed' })

  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, state)

  if (req.method === 'POST' && url.pathname === '/sync') {
    if (state.running) return json(res, 409, { error: 'A sync is already running', ...state })
    const player = url.searchParams.get('player')
    if (player !== null && !isSafePlayerName(player)) return json(res, 400, { error: 'Bad player name' })
    startSync(url.searchParams.get('only') === 'games' ? 'games' : url.searchParams.get('only') === 'odds' ? 'odds' : player ? 'player' : 'all', player)
    return json(res, 202, { started: true })
  }
  json(res, 404, { error: 'Not found' })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`uBet sync helper on http://127.0.0.1:${PORT}`)
  // Everything automatic. A check runs every 10 minutes:
  //   - odds (SharpAPI) into the database: see below
  //   - box scores + projections + grading: at startup, then every AUTO_SYNC_HOURS (default 3)        AUTO_SYNC=0 turns it off
  // The Sync button still works, and nothing runs while a sync is already in progress.
  const hours = Number(process.env.AUTO_SYNC_HOURS) > 0 ? Number(process.env.AUTO_SYNC_HOURS) : 3
  const stateFile = join(root, 'ingest', '.auto_state.json')   // survives restarts so a restart never re-spends credits
  const saved = (() => { try { return JSON.parse(readFileSync(stateFile, 'utf8')) } catch { return {} } })()
  const tick = async () => {
    if (state.running) return
    if (process.env.AUTO_SYNC !== '0' && Date.now() - (saved.syncAt ?? 0) >= hours * 3600_000) {
      console.log(`auto-sync ${new Date().toLocaleTimeString()}`)
      saved.syncAt = Date.now(); writeFileSync(stateFile, JSON.stringify(saved))
      await startSync('all')
    }
  }
  // Odds: every ODDS_SYNC_MINUTES (default 10), so stored odds stay about as fresh as the provider's free plan allows.        AUTO_ODDS=0 turns it off
  const oddsEvery = (Number(process.env.ODDS_SYNC_MINUTES) > 0 ? Number(process.env.ODDS_SYNC_MINUTES) : 10) * 60_000
  const tickOdds = async () => {
    if (state.running || process.env.AUTO_ODDS === '0') return
    if (Date.now() - (saved.oddsAt ?? 0) < oddsEvery) return
    console.log(`auto-odds ${new Date().toLocaleTimeString()}`)
    saved.oddsAt = Date.now(); writeFileSync(stateFile, JSON.stringify(saved))
    await startSync('odds')
  }
  tick().then(tickOdds)
  setInterval(() => tick().then(tickOdds), 5 * 60_000)
  console.log(`automatic: sync every ${hours}h, odds every ${oddsEvery / 60_000} min (state in ingest/.auto_state.json)`)
})
