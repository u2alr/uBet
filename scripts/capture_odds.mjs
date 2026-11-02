// Point-in-time odds capture for games that are about to start. Builds the opening/closing-proxy archive (migration 0018, shared/oddsArchive.ts).
//
//   node scripts/capture_odds.mjs                       # games starting in the next 10 to 60 minutes, at most 2, local database
//   node scripts/capture_odds.mjs --window 15,45 --max-games 3 --remote
//   node scripts/capture_odds.mjs --dry                 # say which games it would fetch; fetch no props
//
// SharpAPI's free plan allows 12 requests a minute and a game's props take about 3, so this paces itself, stops on HTTP 429 and records the
// failed attempt, and does not fetch a game it already captured within the last 10 minutes. Free-plan quotes are delayed 60 seconds, so the result is a
// "closing proxy", never a true closing line. Schedule it (Task Scheduler) every 15 minutes during game hours.
import { SHARP_BASE, SHARP_BOOKS, SHARP_PROP_MARKETS, SHARP_TEAM_MARKETS, normalizeSharpGames, normalizeSharpProps } from '../shared/sharpapi.ts'
import { PRIOR_SQL, flatten, planArchive, priorFromRows, runSql, sqlValue } from '../shared/oddsArchive.ts'
import { d1Exec, d1Query, secret } from './lib.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const remote = flag('--remote'), dry = flag('--dry')
const [lo, hi] = String(val('--window', '10,60')).split(',').map(Number)
const maxGames = Math.max(1, Math.min(6, Number(val('--max-games', 2)) || 2))
const PAUSE_MS = 5500   // 12 requests a minute is one every 5 seconds

const key = secret('SHARPAPI_KEY')
if (!key) { console.error('SHARPAPI_KEY is not set'); process.exit(1) }
const books = (secret('ODDS_BOOKS') || SHARP_BOOKS.join(',')).split(',').map((b) => b.trim()).filter(Boolean)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Every row for these filters, following the cursor. Returns { rows } or { status } when the provider refuses. */
async function rows(params) {
  const out = []
  let cursor
  for (let page = 0; page < 8; page++) {
    const u = new URL(`${SHARP_BASE}/odds`)
    u.search = new URLSearchParams({ league: 'nba', is_live: 'false', limit: '200', is_main_line: 'true', sportsbooks: books.join(','), ...params, ...(cursor ? { cursor } : {}) })
    const r = await fetch(u, { headers: { 'X-API-Key': key } })
    if (!r.ok) return { status: r.status }
    const body = await r.json()
    out.push(...(body.data ?? []))
    cursor = body.pagination?.has_more ? body.pagination.next_cursor : undefined
    if (!cursor) break
    await sleep(PAUSE_MS)
  }
  return { rows: out }
}

const list = await rows({ markets: SHARP_TEAM_MARKETS })
if (list.status) { console.error(`games: HTTP ${list.status}`); process.exit(1) }
const now = Date.now()
const soon = normalizeSharpGames(list.rows, books)
  .filter((e) => Date.parse(e.commence_time) - now >= lo * 60_000 && Date.parse(e.commence_time) - now <= hi * 60_000)
  .slice(0, maxGames)
console.log(`${soon.length} game(s) start in ${lo} to ${hi} minutes`)
if (dry || !soon.length) process.exit(0)

for (const e of soon) {
  const recent = d1Query(`SELECT 1 FROM odds_runs WHERE source = 'sharpapi' AND event_id = ${sqlValue(e.id)} AND captured_at > ${sqlValue(new Date(now - 10 * 60_000).toISOString())} LIMIT 1`, remote)
  if (recent.length) { console.log(`skip ${e.id}: captured within the last 10 minutes`); continue }
  await sleep(PAUSE_MS)
  const capturedAt = new Date().toISOString()
  const got = await rows({ event_id: e.id, markets: SHARP_PROP_MARKETS })
  if (got.status === 429 || got.status === 401) {
    console.error(`HTTP ${got.status}: rate limited or the key was refused. Recording the attempt and stopping.`)
    d1Exec([`INSERT OR IGNORE INTO odds_runs (captured_at, source, kind, event_id, event_start, status, note) VALUES (${sqlValue(capturedAt)}, 'sharpapi', 'pre_event', ${sqlValue(e.id)}, ${sqlValue(e.commence_time)}, 'rate_limited', ${sqlValue(`HTTP ${got.status}`)});`], remote, 'capture_fail.sql')
    break
  }
  if (got.status) { console.error(`skip ${e.id}: HTTP ${got.status}`); continue }
  const { events, stats } = normalizeSharpProps(got.rows, books)
  const ev = events[0] ?? { id: e.id, commence_time: e.commence_time, home_team: e.home_team, away_team: e.away_team, bookmakers: [] }
  const { quotes, skipped } = flatten(ev, 'sharpapi')
  const prior = priorFromRows(ev.id, d1Query(PRIOR_SQL.replace('?', sqlValue(ev.id)).replace('?', sqlValue(ev.id)), remote))
  const plan = planArchive(prior, quotes, capturedAt, { complete: true, skipped: skipped + stats.skipped.book })
  d1Exec(runSql({ source: 'sharpapi', kind: 'pre_event', eventId: ev.id, eventStart: ev.commence_time, capturedAt, status: 'ok', plan }), remote, 'capture.sql')
  console.log(`${e.away_team} @ ${e.home_team}: ${plan.seen} quotes seen, ${plan.written} changed, ${plan.stale} stale, ${plan.disagreements} disagreements, ${plan.unavailable} gone.`)
}
