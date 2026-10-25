// Local job: fetch OddsBlaze, build picks, let each mind choose, freeze the cards into D1.
//   node minds/run.mjs [--remote] [--dry] [--books draftkings,fanatics,caesars]
// Reads ODDSBLAZE_KEY from .dev.vars or the environment. Heavy (8-11 MB per book), so it runs here, not in the Worker.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildPicks, etDate, normName } from '../shared/picks.ts'
import { normalizeOddsBlaze, TWO_WAY_BOOKS } from '../shared/oddsblaze.ts'
import { normalizeOddsApi, ODDS_API_BOOKS, ODDS_API_MARKETS, ODDS_API_REGIONS } from '../shared/oddsapi.ts'
import { enrichPicks, parseInjuries } from '../shared/injuries.ts'
import { gzipSync } from 'node:zlib'
import { attachOpponent, decide, legKey, MINDS_VERSION } from '../shared/minds.ts'
import { parseCalibration } from '../shared/engine/calibration.ts'
import { makeConfig } from '../shared/engine/config.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const remote = args.includes('--remote')
const dry = args.includes('--dry')
// --cache reuses the last odds download for up to 3 hours, so tuning rules does not spend OddsBlaze requests. Never with real runs.
const useCache = args.includes('--cache') && dry
const bi = args.indexOf('--books')
const books = bi >= 0 ? args[bi + 1].split(',') : TWO_WAY_BOOKS
const MARKETS = 'Player Points,Player Rebounds,Player Assists,Player Threes Made'

function secret(name) {
  if (process.env[name]) return process.env[name]
  try { const m = new RegExp(`^${name}=(.+)$`, 'm').exec(readFileSync(path.join(ROOT, '.dev.vars'), 'utf8')); return m ? m[1].trim() : '' } catch { return '' }
}
// The Odds API (FanDuel, DraftKings, bet365 only) when its key is set; OddsBlaze otherwise. --provider oddsblaze|oddsapi forces one.
const pi = args.indexOf('--provider')
// The Odds API is the primary source. OddsBlaze is only a fallback when it returns nothing (credits used up, key rejected), unless --provider forces one.
let provider = pi >= 0 ? args[pi + 1] : secret('ODDS_API_KEY') ? 'oddsapi' : 'oddsblaze'
const key = () => { const k = secret(provider === 'oddsapi' ? 'ODDS_API_KEY' : 'ODDSBLAZE_KEY'); if (!k) throw new Error(`${provider} key missing`); return k }

async function fetchOddsApi(k, horizonMs) {
  const base = 'https://api.the-odds-api.com/v4/sports/basketball_nba'
  const list = await fetch(`${base}/events?apiKey=${k}`)
  if (!list.ok) throw new Error(`events: HTTP ${list.status}`)
  const soon = (await list.json()).filter((e) => Date.parse(e.commence_time) > Date.now() && Date.parse(e.commence_time) < Date.now() + horizonMs)
  const out = []
  for (const e of soon) {   // one request per game; props are only served per event
    const u = new URL(`${base}/events/${e.id}/odds`)
    u.search = new URLSearchParams({ apiKey: k, regions: ODDS_API_REGIONS, markets: ODDS_API_MARKETS, bookmakers: ODDS_API_BOOKS.join(','), oddsFormat: 'decimal' })
    const r = await fetch(u)
    if (!r.ok) { console.error('skip game', e.id, `HTTP ${r.status}`); continue }
    out.push(await r.json())
  }
  return out
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

let now = Date.now()
const k = key()
const responses = []
const cacheFile = path.join(ROOT, 'minds', 'out', `odds_cache${provider === 'oddsapi' ? '_oddsapi' : ''}.json`)
if (useCache && existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < 3 * 3600_000) {
  responses.push(...JSON.parse(readFileSync(cacheFile, 'utf8')))
  // judge the cached lines as of when they were downloaded: just after the newest quote timestamp inside them
  const stamps = [...readFileSync(cacheFile, 'utf8').matchAll(/"(?:updated|last_update)":\s*"([^"]+)"/g)].map((m) => Date.parse(m[1])).filter(Number.isFinite)
  now = stamps.length ? Math.max(...stamps) + 120_000 : statSync(cacheFile).mtimeMs
  console.log('using cached odds from', new Date(now).toLocaleTimeString())
} else {
  if (provider === 'oddsapi') {
    try { responses.push(...(await fetchOddsApi(k, 36 * 3600_000))) } catch (e) { console.error('odds api failed:', String(e.message).replace(k, '***')) }
  } else for (const b of books) {
    try { responses.push(await fetchBook(k, b)) } catch (e) { console.error('skip', String(e.message).replace(k, '***')) }
  }
  if (dry && responses.length) { mkdirSync(path.dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify(responses)) }
}
if (!responses.length && provider === 'oddsapi' && pi < 0 && secret('ODDSBLAZE_KEY') && !useCache) {
  console.error('The Odds API returned nothing (credits used up or key rejected). Falling back to OddsBlaze.')
  provider = 'oddsblaze'
  const kb = secret('ODDSBLAZE_KEY')
  for (const b of books) { try { responses.push(await fetchBook(kb, b)) } catch (e) { console.error('skip', String(e.message).replace(kb, '***')) } }
}
if (!responses.length) { console.error('no odds fetched'); process.exit(1) }

const { events, stats } = provider === 'oddsapi' ? normalizeOddsApi(responses) : normalizeOddsBlaze(responses)
console.log(`odds (${provider}): ${events.length} games, ${stats.kept} quotes${provider === 'oddsapi' ? ` from ${stats.booksSeen.join(', ')}` : ` from ${responses.length} books`}`)

const players = d1('SELECT id, name, team FROM players')
const byName = new Map(players.map((p) => [normName(p.name), p]))
const wanted = new Set()
for (const e of events) for (const b of e.bookmakers) for (const m of b.markets) for (const o of m.outcomes) {
  const p = byName.get(normName(o.description ?? ''))
  if (p) wanted.add(p.id)
}
const dates = [...new Set(events.map((e) => etDate(e.commence_time)))]
const projections = dates.length ? d1(`SELECT player_id, game_date, stat, mean, alpha, model, created_at FROM projections WHERE game_date IN (${dates.map((d) => `'${d}'`).join(',')})`) : []
const history = wanted.size ? d1(`SELECT pg.player_id, g.game_type AS type, pg.pts, pg.reb, pg.ast, pg.fg3m, pg.minutes FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id IN (${[...wanted].join(',')}) ORDER BY g.date DESC`) : []

const built = buildPicks({ events, players, history, projections, now, selection: 'all' })
// Availability from ESPN (keyless), and a minutes role: the same enrichment the app applies before showing picks.
let injuries = null
try { const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries'); if (r.ok) injuries = parseInjuries(await r.json()) } catch { /* handled below */ }
if (!injuries) console.error('WARNING: ESPN injuries unavailable; the minds will not know who is listed')
const { picks, dropped } = enrichPicks(built.picks, history, injuries)
console.log(`picks: ${picks.length} (${dropped.length} players listed Out removed)`, JSON.stringify(built.diagnostics).slice(0, 200))

const day = etDate(new Date(now).toISOString())
// Only tonight's and tomorrow's games: a bet made today must be gradeable within a day or two.
const horizon = now + 36 * 3600_000
const upcoming = picks.filter((p) => { const t = events.find((e) => e.id === p.eventId); return t && Date.parse(t.commence_time) > now && Date.parse(t.commence_time) < horizon })

// The Chief decides once a day. A "no bets" day still counts, so a re-run cannot quietly add bets afterwards.
const ranKey = `minds_ran:${MINDS_VERSION}:${day}`
if (!dry && d1(`SELECT value FROM meta WHERE key = '${ranKey}'`).length) { console.log(`The Chief already decided for ${day}. Nothing changed.`); process.exit(0) }

// Matchup evidence from raw box scores: how much of each stat a team has allowed over its last 20 games, relative to the league.
const allowed = d1(`WITH tg AS (
    SELECT pg.opp AS team, g.id AS gid, g.date, SUM(pg.pts) AS pts, SUM(pg.reb) AS reb, SUM(pg.ast) AS ast, SUM(pg.fg3m) AS fg3m, SUM(pg.pts + pg.reb + pg.ast) AS pra
    FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.opp IS NOT NULL AND g.game_type = 'regular' GROUP BY pg.opp, g.id),
  r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY team ORDER BY date DESC) AS rn FROM tg)
  SELECT team, AVG(pts) AS pts, AVG(reb) AS reb, AVG(ast) AS ast, AVG(fg3m) AS fg3m, AVG(pra) AS pra, COUNT(*) AS n FROM r WHERE rn <= 20 GROUP BY team HAVING n >= 10`)
const league = Object.fromEntries(['pts', 'reb', 'ast', 'fg3m', 'pra'].map((s) => [s, allowed.reduce((a, r) => a + r[s], 0) / (allowed.length || 1)]))
const oppTable = Object.fromEntries(allowed.map((r) => [r.team, Object.fromEntries(['pts', 'reb', 'ast', 'fg3m', 'pra'].map((s) => [s, r[s] / league[s]]))]))
console.log(`opponent tendencies for ${allowed.length} teams`)

// Calibration artifact (written by research/calibrate.py). Missing or unreadable => the engine approves nothing (fail closed).
let calibration = null
try { calibration = parseCalibration(JSON.parse(readFileSync(path.join(ROOT, 'shared', 'calibration.json'), 'utf8'))) } catch (e) { console.error(`WARNING: calibration artifact unusable (${e.message}); nothing can be approved`) }
const config = makeConfig()
const inputs = attachOpponent(upcoming, oppTable)
if (process.env.DUMP_PICKS) writeFileSync(process.env.DUMP_PICKS, JSON.stringify({ configured: true, data: upcoming, meta: { warnings: [] } }))   // developer aid: a picks payload for UI checks
const decision = decide(inputs, { now, config, calibration, injuryChecked: injuries != null })
const runId = `${day}-${MINDS_VERSION}-${decision.run.configHash.slice(0, 8)}-${now}`
const { approved, leans, volume, research, rejected } = decision
const sd = decision.stats
console.log(`picks ${sd.picks} -> evaluated ${sd.evaluated} -> candidates ${sd.candidates} -> approved ${sd.approved} strict + ${sd.leans} SHADOW_ONLY leans (+${sd.research} research-only, ${sd.volume} paper volume lines), rejected ${sd.rejected}`)
console.log('status:', JSON.stringify(sd.byStatus), ' reasons:', JSON.stringify(sd.byReason))
const why = rejected.reduce((a, r) => ((a[r.reason] = (a[r.reason] ?? 0) + 1), a), {})
console.log('rejected because:', JSON.stringify(why))

const gameOf = (id) => events.find((e) => e.id === id)
const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
const lines = []
const gz = gzipSync(JSON.stringify(inputs)).toString('base64')
lines.push(`INSERT OR IGNORE INTO mind_runs (run_id, day, version, config_hash, config_json, calibration_version, calibration_hash, stats_json, cap_log_json) VALUES (${q(runId)}, ${q(day)}, ${q(MINDS_VERSION)}, ${q(decision.run.configHash)}, ${q(JSON.stringify(config))}, ${q(decision.run.calibrationVersion)}, ${q(decision.run.calibrationHash)}, ${q(JSON.stringify(sd))}, ${q(JSON.stringify(decision.capLog))});`)
for (let i = 0; i * 60000 < gz.length; i++) lines.push(`INSERT OR IGNORE INTO mind_run_inputs (run_id, idx, chunk) VALUES (${q(runId)}, ${i}, ${q(gz.slice(i * 60000, (i + 1) * 60000))});`)
const outcomeOf = new Map()
for (const b of approved) b.records.forEach((r) => outcomeOf.set(r.key, 'strict'))
for (const b of leans) b.records.forEach((r) => outcomeOf.set(r.key, 'shadow_lean'))
for (const b of research) b.records.forEach((r) => outcomeOf.set(r.key, outcomeOf.get(r.key) ?? 'research'))
for (const r of decision.candidates) lines.push(`INSERT OR IGNORE INTO mind_candidates (run_id, key, status, outcome, record_json) VALUES (${q(runId)}, ${q(r.key)}, ${q(r.status)}, ${q(outcomeOf.get(r.key) ?? (r.status === 'ELIGIBLE' ? 'not_proposed' : `rejected:${r.status}`))}, ${q(JSON.stringify(r))});`)
for (const b of [...approved, ...leans, ...volume, ...research]) {
  const betKey = [day, 'chief', MINDS_VERSION, ...b.legs.map(legKey).sort()].join('|')
  lines.push(`INSERT OR IGNORE INTO mind_bets (bet_key, day, mind, version, kind, odds, prob, ev, stake, proposed_by, p_cons, ev_cons, rationale, research, tier, label, run_id) VALUES (${q(betKey)}, ${q(day)}, ${q(b.mind)}, ${q(MINDS_VERSION)}, ${q(b.kind)}, ${b.odds}, ${b.prob}, ${b.ev}, ${b.stake}, ${q(b.proposedBy.join(','))}, ${b.pCons}, ${b.evCons}, ${q(JSON.stringify(b.rationale))}, ${b.research ? 1 : 0}, ${q(b.tier)}, ${q(b.label)}, ${q(runId)});`)
  b.legs.forEach((l, i) => {
    const rec = b.records[i] ?? { probability: { decision: b.prob, conservative: null }, review: { matchup: { score: null } }, eligibility: { flags: [] } }
    lines.push(
      `INSERT OR IGNORE INTO mind_legs (bet_id, idx, player_id, player, stat, side, line, price, book, odds_id, event_id, game_date, prob, model_prob, market_prob, tip_off, home_team, away_team, p_cons, matchup_score, skeptic_flags) ` +
      `SELECT id, ${i}, ${l.playerId}, ${q(l.player)}, ${q(l.stat)}, ${q(l.side)}, ${l.line}, ${b.legPrices[i]}, ${q(l.book)}, ${q(l.oddsId)}, ${q(l.eventId)}, ${q(l.gameDate)}, ${rec.probability?.decision ?? b.prob}, ${l.modelProb}, ${q(l.marketProb)}, ${q(gameOf(l.eventId)?.commence_time)}, ${q(gameOf(l.eventId)?.home_team)}, ${q(gameOf(l.eventId)?.away_team)}, ${rec.probability?.conservative ?? null}, ${rec.review?.matchup?.score ?? null}, ${q((rec.eligibility?.flags ?? []).map((x) => x.code).join(','))} FROM mind_bets WHERE bet_key = ${q(betKey)};`)
  })
}
for (const r of rejected) {
  const l = r.pick, g = gameOf(l.eventId)
  lines.push(`INSERT INTO mind_rejections (day, version, proposed_by, player_id, player, stat, side, line, price, game, tip_off, game_date, reason, detail, p_cons, ev_cons, reasons_json, run_id) VALUES (${q(day)}, ${q(MINDS_VERSION)}, ${q(r.proposedBy.join(','))}, ${l.playerId}, ${q(l.player)}, ${q(l.stat)}, ${q(l.side)}, ${l.line}, ${l.price}, ${q(l.game)}, ${q(g?.commence_time)}, ${q(l.gameDate)}, ${q(r.reason)}, ${q(r.detail)}, ${r.pCons ?? null}, ${r.evCons ?? null}, ${q(JSON.stringify(r.reasons))}, ${q(runId)});`)
}
console.log('paper volume lines per game:', Object.entries(sd.volumeByGame ?? {}).map(([g, n]) => `${g.split(' @ ').map((x) => x.split(' ').pop()).join('@')}=${n}`).join('  '))
console.log(`\nLEANS, half stake (${leans.length}):`)
for (const b of leans) console.log(`  ${b.proposedBy.join('+').padEnd(8)} ${b.odds.toFixed(2)}x says ${(b.prob * 100).toFixed(0)}% ev ${(b.ev * 100).toFixed(1)}% cons ${(b.evCons * 100).toFixed(1)}%  ${b.legs[0].player} ${b.legs[0].side} ${b.legs[0].line} ${b.legs[0].stat}`)
console.log(`\nAPPROVED BETS (${approved.length}):`)
for (const b of approved) console.log(`  ${b.proposedBy.join('+').padEnd(8)} ${b.odds.toFixed(2)}x says ${(b.prob * 100).toFixed(0)}% cons ${(b.pCons * 100).toFixed(0)}% ev ${(b.ev * 100).toFixed(1)}% cons ${(b.evCons * 100).toFixed(1)}%  ${b.legs[0].player} ${b.legs[0].side} ${b.legs[0].line} ${b.legs[0].stat}`)
console.log(`RESEARCH PARLAYS (${research.length}):`)
for (const b of research) console.log(`  ${b.odds.toFixed(2)}x cons ${(b.pCons * 100).toFixed(1)}% ev cons ${(b.evCons * 100).toFixed(1)}%  ${b.legs.map((l) => `${l.player} ${l.side} ${l.line} ${l.stat}`).join(' + ')}`)
if (dry) { console.log('(dry run: nothing written)'); process.exit(0) }

lines.push(`INSERT OR REPLACE INTO meta (key, value) VALUES (${q(ranKey)}, datetime('now'));`)
mkdirSync(path.join(ROOT, 'minds', 'out'), { recursive: true })
const f = path.join(ROOT, 'minds', 'out', 'cards.sql')
writeFileSync(f, lines.join('\n'))
execFileSync('npx', ['wrangler', 'd1', 'execute', 'ubet', remote ? '--remote' : '--local', '--file', f], { cwd: ROOT, shell: true, stdio: 'inherit' })
console.log('decision recorded')
