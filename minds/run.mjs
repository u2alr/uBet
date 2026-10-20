// Local job: fetch OddsBlaze, build picks, let each mind choose, freeze the cards into D1.
//   node minds/run.mjs [--remote] [--dry] [--books draftkings,fanatics,caesars]
// Reads ODDSBLAZE_KEY from .dev.vars or the environment. Heavy (8-11 MB per book), so it runs here, not in the Worker.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildPicks, etDate, normName } from '../shared/picks.ts'
import { normalizeOddsBlaze, TWO_WAY_BOOKS } from '../shared/oddsblaze.ts'
import { runMinds, legKey, MINDS_VERSION } from '../shared/minds.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const remote = args.includes('--remote')
const dry = args.includes('--dry')
const bi = args.indexOf('--books')
const books = bi >= 0 ? args[bi + 1].split(',') : TWO_WAY_BOOKS
const MARKETS = 'Player Points,Player Rebounds,Player Assists,Player Threes Made'

function key() {
  if (process.env.ODDSBLAZE_KEY) return process.env.ODDSBLAZE_KEY
  const m = /^ODDSBLAZE_KEY=(.+)$/m.exec(readFileSync(path.join(ROOT, '.dev.vars'), 'utf8'))
  if (!m) throw new Error('ODDSBLAZE_KEY missing')
  return m[1].trim()
}

function d1(sql) {
  mkdirSync(path.join(ROOT, 'minds', 'out'), { recursive: true })
  const q = path.join(ROOT, 'minds', 'out', 'query.sql')
  writeFileSync(q, sql)
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'ubet', remote ? '--remote' : '--local', '--json', '--file', q],
    { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return JSON.parse(out.slice(out.indexOf('[')))[0].results
}

async function fetchBook(k, book) {
  const u = new URL('https://odds.oddsblaze.com/')
  u.search = new URLSearchParams({ key: k, sportsbook: book, league: 'nba', market: MARKETS, price: 'decimal', live: 'false' })
  const r = await fetch(u)
  if (!r.ok) throw new Error(`${book}: HTTP ${r.status}`)
  return r.json()
}

const now = Date.now()
const k = key()
const responses = []
for (const b of books) {
  try { responses.push(await fetchBook(k, b)) } catch (e) { console.error('skip', String(e.message).replace(k, '***')) }
}
if (!responses.length) { console.error('no odds fetched'); process.exit(1) }

const { events, stats } = normalizeOddsBlaze(responses)
console.log(`odds: ${events.length} games, ${stats.kept} quotes from ${responses.length} books`)

const players = d1('SELECT id, name, team FROM players')
const names = new Set(players.map((p) => normName(p.name)))
const wanted = new Set()
for (const e of events) for (const b of e.bookmakers) for (const m of b.markets) for (const o of m.outcomes) {
  const p = players.find((x) => normName(x.name) === normName(o.description))
  if (p) wanted.add(p.id)
}
const dates = [...new Set(events.map((e) => etDate(e.commence_time)))]
const projections = dates.length ? d1(`SELECT player_id, game_date, stat, mean, alpha, model, created_at FROM projections WHERE game_date IN (${dates.map((d) => `'${d}'`).join(',')})`) : []
const history = wanted.size ? d1(`SELECT pg.player_id, g.game_type AS type, pg.pts, pg.reb, pg.ast, pg.fg3m FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id IN (${[...wanted].join(',')}) ORDER BY g.date DESC`) : []

const { picks, diagnostics } = buildPicks({ events, players, history, projections, now, selection: 'all' })
console.log(`picks: ${picks.length}`, JSON.stringify(diagnostics).slice(0, 300))

const day = etDate(new Date(now).toISOString())
// Only tonight's and tomorrow's games: a card made today must be gradeable within a day or two.
const horizon = now + 36 * 3600_000
const eligible = picks.filter((p) => { const t = events.find((e) => e.id === p.eventId); return t && Date.parse(t.commence_time) > now && Date.parse(t.commence_time) < horizon })
const bets = runMinds(eligible, day)

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const lines = []
for (const b of bets) {
  const betKey = [day, b.mind, MINDS_VERSION, ...b.legs.map(legKey).sort()].join('|')
  lines.push(`INSERT OR IGNORE INTO mind_bets (bet_key, day, mind, version, kind, odds, prob, ev) VALUES (${q(betKey)}, ${q(day)}, ${q(b.mind)}, ${q(MINDS_VERSION)}, ${q(b.kind)}, ${b.odds}, ${b.prob}, ${b.ev});`)
  b.legs.forEach((l, i) => lines.push(
    `INSERT OR IGNORE INTO mind_legs (bet_id, idx, player_id, player, stat, side, line, price, book, odds_id, event_id, game_date, prob, model_prob, market_prob) ` +
    `SELECT id, ${i}, ${l.playerId}, ${q(l.player)}, ${q(l.stat)}, ${q(l.side)}, ${l.line}, ${l.price}, ${q(l.book)}, ${q(l.oddsId)}, ${q(l.eventId)}, ${q(l.gameDate)}, ${l.prob}, ${l.modelProb}, ${q(l.marketProb)} FROM mind_bets WHERE bet_key = ${q(betKey)};`))
}
console.log(`bets: ${bets.length}`, Object.entries(bets.reduce((a, b) => ((a[b.mind] = (a[b.mind] ?? 0) + 1), a), {})).map(([m, n]) => `${m}=${n}`).join(' '))
for (const b of bets) console.log(`  ${b.mind.padEnd(7)} ${b.kind.padEnd(6)} ${b.odds.toFixed(2)}x p=${(b.prob * 100).toFixed(0)}% ev=${(b.ev * 100).toFixed(1)}%  ${b.legs.map((l) => `${l.player} ${l.side} ${l.line} ${l.stat}`).join(' + ')}`)
if (dry || !lines.length) { console.log(dry ? '(dry run: nothing written)' : 'nothing to write'); process.exit(0) }

mkdirSync(path.join(ROOT, 'minds', 'out'), { recursive: true })
const f = path.join(ROOT, 'minds', 'out', 'cards.sql')
writeFileSync(f, lines.join('\n'))
execFileSync('npx', ['wrangler', 'd1', 'execute', 'ubet', remote ? '--remote' : '--local', '--file', f], { cwd: ROOT, shell: true, stdio: 'inherit' })
console.log('cards frozen')
