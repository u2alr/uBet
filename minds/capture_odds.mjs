// Point-in-time odds capture for games that are about to start. Builds the opening/closing-proxy archive (migration 0018, shared/oddsArchive.ts).
//
//   node minds/capture_odds.mjs                       # games starting in the next 10 to 60 minutes, at most 2, local database
//   node minds/capture_odds.mjs --window 15,45 --max-games 3 --remote
//   node minds/capture_odds.mjs --dry                 # say what it would fetch and what it would cost; spend nothing
//
// Credits: one per market per game (5 markets = 5 credits per game). It never spends the last CREDIT_RESERVE credits, stops on HTTP 429 and records
// the failed attempt, and does not fetch a game it already captured within the last 10 minutes. Schedule it (Task Scheduler) every 15 minutes during
// game hours only if you accept that cost: each run near tip-off uses about 10 credits. The result is a "closing proxy", never a true closing line.
import { normalizeOddsApi, ODDS_API_BOOKS, ODDS_API_MARKETS, ODDS_API_REGIONS } from '../shared/oddsapi.ts'
import { PRIOR_SQL, flatten, planArchive, priorFromRows, runSql, sqlValue } from '../shared/oddsArchive.ts'
import { d1Exec, d1Query, secret } from './lib.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const remote = flag('--remote'), dry = flag('--dry')
const [lo, hi] = String(val('--window', '10,60')).split(',').map(Number)
const maxGames = Math.max(1, Math.min(6, Number(val('--max-games', 2)) || 2))
const CREDIT_RESERVE = 100

const key = secret('ODDS_API_KEY')
if (!key) { console.error('ODDS_API_KEY is not set'); process.exit(1) }
const base = 'https://api.the-odds-api.com/v4/sports/basketball_nba'
const markets = ODDS_API_MARKETS.split(',').length

const list = await fetch(`${base}/events?apiKey=${key}`)
if (!list.ok) { console.error(`events: HTTP ${list.status}`); process.exit(1) }
const now = Date.now()
const soon = (await list.json())
  .filter((e) => Date.parse(e.commence_time) - now >= lo * 60_000 && Date.parse(e.commence_time) - now <= hi * 60_000)
  .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time)).slice(0, maxGames)
console.log(`${soon.length} game(s) start in ${lo} to ${hi} minutes; about ${soon.length * markets} credits`)
if (dry || !soon.length) process.exit(0)

for (const e of soon) {
  const recent = d1Query(`SELECT 1 FROM odds_runs WHERE source = 'theoddsapi' AND event_id = ${sqlValue(e.id)} AND captured_at > ${sqlValue(new Date(now - 10 * 60_000).toISOString())} LIMIT 1`, remote)
  if (recent.length) { console.log(`skip ${e.id}: captured within the last 10 minutes`); continue }
  const u = new URL(`${base}/events/${e.id}/odds`)
  u.search = new URLSearchParams({ apiKey: key, regions: ODDS_API_REGIONS, markets: ODDS_API_MARKETS, bookmakers: ODDS_API_BOOKS.join(','), oddsFormat: 'decimal' })
  const capturedAt = new Date().toISOString()
  const r = await fetch(u)
  if (r.status === 429 || r.status === 401) {
    console.error(`HTTP ${r.status}: rate limited or out of credits. Recording the attempt and stopping.`)
    d1Exec([`INSERT OR IGNORE INTO odds_runs (captured_at, source, kind, event_id, event_start, status, note) VALUES (${sqlValue(capturedAt)}, 'theoddsapi', 'pre_event', ${sqlValue(e.id)}, ${sqlValue(e.commence_time)}, 'rate_limited', ${sqlValue(`HTTP ${r.status}`)});`], remote, 'capture.sql')
    break
  }
  if (!r.ok) { console.error(`skip ${e.id}: HTTP ${r.status}`); continue }
  const left = Number(r.headers.get('x-requests-remaining'))
  const { events, stats } = normalizeOddsApi([await r.json()])
  const ev = events[0] ?? { id: e.id, commence_time: e.commence_time, home_team: e.home_team, away_team: e.away_team, bookmakers: [] }
  const { quotes, skipped } = flatten(ev, 'theoddsapi')
  const prior = priorFromRows(ev.id, d1Query(PRIOR_SQL.replace('?', sqlValue(ev.id)).replace('?', sqlValue(ev.id)), remote))
  const plan = planArchive(prior, quotes, capturedAt, { complete: true, skipped: skipped + stats.skipped.book })
  d1Exec(runSql({ source: 'theoddsapi', kind: 'pre_event', eventId: ev.id, eventStart: ev.commence_time, capturedAt, status: 'ok', plan }), remote, 'capture.sql')
  console.log(`${e.away_team} @ ${e.home_team}: ${plan.seen} quotes seen, ${plan.written} changed, ${plan.stale} stale, ${plan.disagreements} disagreements, ${plan.unavailable} gone. credits left: ${Number.isFinite(left) ? left : 'unknown'}`)
  if (Number.isFinite(left) && left < CREDIT_RESERVE) { console.error(`Stopping: ${left} credits left (reserve ${CREDIT_RESERVE}).`); break }
}
