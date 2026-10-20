// One-off: fill tip-off time and team names on legs saved before migration 0011, from the odds download that
// `node minds/run.mjs --dry` keeps in minds/out/odds_cache.json (event ids are stable for a slate).
//   node minds/backfill_games.mjs [--remote]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cache = path.join(ROOT, 'minds', 'out', 'odds_cache.json')
if (!existsSync(cache)) { console.error('No cached odds. Run: node minds/run.mjs --dry'); process.exit(1) }
const q = (v) => `'${String(v).replace(/'/g, "''")}'`
const games = new Map()
for (const r of JSON.parse(readFileSync(cache, 'utf8'))) for (const e of r.events) games.set(e.id, e)
const sql = [...games.values()].map((e) =>
  `UPDATE mind_legs SET tip_off = ${q(e.date)}, home_team = ${q(e.teams.home.name)}, away_team = ${q(e.teams.away.name)} WHERE event_id = ${q(e.id)} AND tip_off IS NULL;`).join('\n')
const file = path.join(ROOT, 'minds', 'out', 'backfill.sql')
writeFileSync(file, sql)
execFileSync('npx', ['wrangler', 'd1', 'execute', 'ubet', process.argv.includes('--remote') ? '--remote' : '--local', '--file', file], { cwd: ROOT, shell: true, stdio: 'inherit' })
console.log(`${games.size} games applied`)
