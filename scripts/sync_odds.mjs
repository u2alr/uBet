// Pulls the odds from SharpAPI into the database, so the site only ever reads stored odds and a page load never calls the provider.
//
//   node scripts/sync_odds.mjs                      # every upcoming game's moneyline/spread/total, local database (add --props for player props too)
//   node scripts/sync_odds.mjs --remote             # write the deployed database instead (same as ingest/sync.py --remote)
//   node scripts/sync_odds.mjs --max-games 12 --hours 30
//   node scripts/sync_odds.mjs --dry                # say what it would fetch; fetch no props
//
// The free plan allows 12 requests a minute and a game's props take about 3, so it paces itself (one request every ~5.5 seconds) and stops at the first
// HTTP 429, keeping what it already stored. Game odds are fetched and stored first, so they are never the thing a rate limit costs you.
import { SHARP_BASE, SHARP_BOOKS, SHARP_PROP_MARKETS, SHARP_TEAM_MARKETS, normalizeSharpGames, normalizeSharpProps } from '../shared/sharpapi.ts'
import { clearEventSql, gamesRow, propsRows, pruneSql, upsertSql } from '../shared/oddsSnapshot.ts'
import { d1Exec, secret } from './lib.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const remote = flag('--remote'), dry = flag('--dry')
// Player props are off for now (they are most of the requests): game odds only, unless ODDS_PROPS=1 is set or --props is passed.
const propsOn = flag('--props') || secret('ODDS_PROPS') === '1'
const maxGames = propsOn ? Math.max(0, Math.min(15, Number(val('--max-games', secret('ODDS_MAX_EVENTS') || 8)) || 8)) : 0
const hours = Math.max(1, Number(val('--hours', secret('ODDS_HOURS') || 40)) || 40)
const PAUSE_MS = 5500   // 12 requests a minute is one every 5 seconds

const key = secret('SHARPAPI_KEY')
if (!key) { console.error('SHARPAPI_KEY is not set (put it in .dev.vars)'); process.exit(1) }
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

const gamesGot = await rows({ markets: SHARP_TEAM_MARKETS })
if (gamesGot.status) { console.error(`game odds: HTTP ${gamesGot.status}${gamesGot.status === 429 ? ' (rate limit: try again in a minute)' : ''}`); process.exit(1) }
const now = Date.now()
const games = normalizeSharpGames(gamesGot.rows, books)
d1Exec([...games.flatMap((g) => [clearEventSql('games', g.id), upsertSql(gamesRow(g, now))]), pruneSql(now)], remote, 'odds_games.sql')
console.log(`stored game odds for ${games.length} game(s)`)

const upcoming = games.filter((g) => Date.parse(g.commence_time) > now && Date.parse(g.commence_time) < now + hours * 3600_000).slice(0, maxGames)
console.log(propsOn ? `${upcoming.length} game(s) in the next ${hours} hours get player props${dry ? ' (dry run: not fetched)' : ''}` : 'player props are off (set ODDS_PROPS=1 or pass --props to sync them)')
if (dry || !upcoming.length) process.exit(0)

let stored = 0
for (const g of upcoming) {
  await sleep(PAUSE_MS)
  const got = await rows({ event_id: g.id, markets: SHARP_PROP_MARKETS })
  if (got.status === 429) { console.error('rate limited: stopping here. What is stored stays; run it again in a minute for the rest.'); break }
  if (got.status) { console.error(`skip ${g.id}: HTTP ${got.status}`); continue }
  const fetchedAt = Date.now()
  const { events, stats } = normalizeSharpProps(got.rows, books)
  const ev = events[0]
  if (!ev) { console.log(`${g.away_team} @ ${g.home_team}: no props posted`); continue }
  d1Exec([clearEventSql('props', g.id), ...propsRows(ev, fetchedAt).map(upsertSql)], remote, 'odds_props.sql')
  stored++
  console.log(`${g.away_team} @ ${g.home_team}: ${stats.kept} quotes stored`)
}
console.log(`done: props for ${stored} of ${upcoming.length} game(s)`)
