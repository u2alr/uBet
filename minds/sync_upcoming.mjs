// Pull fresh box scores for just the players with a game coming up (what the Props board and Cheat sheet use). Much faster than --all-active.
//   node minds/sync_upcoming.mjs [skipFirstN]   (needs `npm run dev:api` or `npm run dev` for the /api list; writes the local database)
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.UBET_API ?? 'http://localhost:5173/api'
const { data } = await (await fetch(`${base}/cheatsheet`)).json()
const skip = Number(process.argv[2] ?? 0)           // resume an interrupted run: the list is alphabetical, so skip the first N
const names = [...new Set(data.map((p) => p.name))].slice(skip)
console.log(`syncing ${names.length} players with an upcoming game`)
const py = path.join(ROOT, 'ingest', '.venv', 'Scripts', 'python.exe')
const child = spawn(py, ['ingest/sync.py', '--seasons', '1', '--delay', '1.5', ...names], { cwd: ROOT, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
