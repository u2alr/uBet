// Probes what an unauthenticated stranger can do to the Worker, using real HTTP requests against the real Worker.
// The Worker is started in a production-like way: CAPTURE_TOKEN is set, so only a caller who knows it is privileged.
// The fake provider counts upstream calls, so "does this request spend credits?" is a measured fact, not an opinion.
//
//   node tests/integration/probe_abuse.mjs <label>        (label names the output file in research/out)
import { mkdirSync, writeFileSync } from 'node:fs'
import { api, APP, openScratch, start, upstreamReset, upstreamStats } from './harness.mjs'

const label = process.argv[2] ?? 'run'
const TOKEN = 'probe-token'
const rows = []
const record = (probe, result) => { rows.push({ probe, result }); console.log(`${probe.padEnd(58)} ${result}`) }
const withTimeout = async (path, ms, init) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try { const res = await fetch(`${APP}/api${path}`, { ...init, signal: ctl.signal }); return { status: res.status, body: await res.text() } }
  catch (e) { return { status: 'NO RESPONSE', body: e.name === 'AbortError' ? `hung for ${ms} ms` : String(e) } }
  finally { clearTimeout(timer) }
}

// A graded-looking row waiting for its result: if a plain page view grades it, GET /results writes to the database.
let seedDate = null
const app = await start({
  extraBindings: [`CAPTURE_TOKEN=${TOKEN}`],
  seed: (db) => {
    const g = db.prepare("SELECT g.date AS d FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id = 201939 AND g.game_type = 'regular' ORDER BY g.date DESC LIMIT 1").get()
    seedDate = g.d
    db.prepare("INSERT INTO predictions (player_id, stat, line, predicted, p_over, model, game_date, side, price, book) VALUES (201939, 'pts', 20.5, 25, 0.6, 'probe', ?, 'over', 1.9, 'probe')").run(seedDate)
  },
})
try {
  // 1. Does an anonymous ?fresh=1 spend provider credits? Fill the cache first, so any later upstream call can only
  //    be the cache BYPASS (an empty cache would always fetch, whatever the caller asks for).
  await api('/games')
  await upstreamReset()
  await api('/games')
  const cached = (await upstreamStats())['/odds'] ?? 0
  await api('/games?fresh=1')
  const spent = ((await upstreamStats())['/odds'] ?? 0) - cached
  if (cached !== 0) console.log('   (warning: the cache did not hold: a plain repeat call went upstream)')
  record('GET /games?fresh=1 (no token): upstream calls made', spent === 0 ? 'none (credits safe)' : `${spent} upstream call(s): SPENDS CREDITS`)

  // 2. The existing guard on /capture (a control)
  await upstreamReset()
  const cap = await api('/capture?hours=48')
  record('GET /capture (no token)', `HTTP ${cap.status}; upstream calls ${JSON.stringify(await upstreamStats())}`)

  // 3. Does viewing Results write to the database?
  await api('/results')
  const db = openScratch()
  const graded = db.prepare("SELECT hit, actual FROM predictions WHERE model = 'probe'").get()
  db.close()
  record('GET /results: grades pending picks (a write on a GET)', graded.hit === null ? 'no, it is a pure read' : `YES, wrote hit=${graded.hit}, actual=${graded.actual}`)

  // 4. Can a stranger insert rows?
  const before = (() => { const d = openScratch(); const n = d.prepare('SELECT COUNT(*) AS n FROM predictions').get().n; d.close(); return n })()
  const good = await api('/predictions', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: 201939, stat: 'pts', line: 20.5, predicted: 25, pOver: 0.6, model: 'stranger' }) })
  const junk = await api('/predictions', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: 201939, stat: 'pts', line: 'abc', predicted: -5, pOver: 7, model: 'x'.repeat(5000) }) })
  const after = (() => { const d = openScratch(); const n = d.prepare('SELECT COUNT(*) AS n FROM predictions').get().n; d.close(); return n })()
  record('POST /predictions (no token), well-formed', `HTTP ${good.status}`)
  record('POST /predictions (no token), junk values', `HTTP ${junk.status}`)
  record('  rows added to predictions by anonymous callers', String(after - before))

  // 5. What do errors reveal?
  const bad = await api('/players/abc/stats')
  record('GET /players/abc/stats: response', `HTTP ${bad.status} ${JSON.stringify(bad.body).slice(0, 110)}`)
  const badJson = await api('/predictions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-capture-token': TOKEN }, body: '{not json' })
  record('POST /predictions with invalid JSON (privileged): response', `HTTP ${badJson.status} ${JSON.stringify(badJson.body).slice(0, 110)}`)

  // 6. Input handling on the stats endpoint
  const nanLine = await api('/players/201939/stats?stat=reb&line=abc')
  record('GET .../stats?line=abc', `HTTP ${nanLine.status}${nanLine.body?.prediction ? ` and a confident P(over) = ${nanLine.body.prediction.pOver.toFixed(3)}` : ''}`)
  const wild = await api('/players?search=%25')
  record("GET /players?search=%  (LIKE wildcard)", `${wild.body.data?.length ?? 0} players returned`)

  // 7. CORS
  const cors = await fetch(`${APP}/api/status`, { headers: { Origin: 'https://evil.example' } })
  record('CORS: Access-Control-Allow-Origin for a foreign origin', cors.headers.get('access-control-allow-origin') ?? 'absent (browsers block cross-site reads)')

  // 8. Last, because on the old code it wedges the Worker: a line that is not finite
  const inf = await withTimeout('/players/201939/stats?stat=fg3m&line=Infinity', 6000)
  record('GET .../stats?stat=fg3m&line=Infinity', `${inf.status}: ${String(inf.body).slice(0, 90)}`)
} finally {
  await app.stop()
}
mkdirSync('research/out', { recursive: true })
writeFileSync(`research/out/probes_${label}.json`, JSON.stringify(rows, null, 1))
