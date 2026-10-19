// Local helper that lets the app's Sync button run ingest/sync.py.
// A Cloudflare Worker cannot run Python, so this runs on your own machine:  npm run dev:sync
// It listens on 127.0.0.1 only and runs a fixed set of commands; nothing from the request is
// ever passed to a shell.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const python = join(root, 'ingest', '.venv', 'Scripts', 'python.exe')
const script = join(root, 'ingest', 'sync.py')
const PORT = 8789

// Only the local dev pages may call this (blocks other websites from poking it).
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8788', 'http://127.0.0.1:8788',
])

const state = { running: false, label: '', done: 0, total: 0, error: '', finishedAt: null }

function run(args, label) {
  return new Promise((resolve) => {
    state.label = label
    const child = spawn(python, ['-X', 'utf8', script, ...args], { cwd: root })
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

async function startSync(mode, player) {
  state.running = true
  state.error = ''
  state.done = 0
  state.total = 0
  try {
    if (mode === 'player') {
      await run(['--seasons', '3', player], `Syncing ${player}`)
    } else if (await run(['--teams-only'], 'Updating teams')) {
      await run(['--all-active', '--seasons', '1', '--delay', '1'], 'Syncing box scores')
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
    if (player !== null && !/^[\p{L}\p{M}.' -]{2,60}$/u.test(player)) return json(res, 400, { error: 'Bad player name' })
    startSync(player ? 'player' : 'all', player)
    return json(res, 202, { started: true })
  }
  json(res, 404, { error: 'Not found' })
}).listen(PORT, '127.0.0.1', () => console.log(`uBet sync helper on http://127.0.0.1:${PORT}`))
