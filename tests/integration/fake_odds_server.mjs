// A stand-in for SharpAPI (GET /api/v1/odds, cursor paging, X-API-Key header), so the real Worker can be exercised end to end with controlled data
// and without touching the real provider's rate limit. It also COUNTS requests, which lets tests prove whether an unauthenticated
// caller can make the Worker spend upstream requests. Props requests count under '/events/:id/odds', team-odds requests under '/odds'.
//
//   node tests/integration/fake_odds_server.mjs [port]
//   GET /__stats   -> request counts per route      GET /__reset -> zero them
//
// Players are real names present in the local database so the join to history and projections is exercised.
// Everything is synthetic: no real odds are stored in the repository.
import { createServer } from 'node:http'

export const PORT = Number(process.argv[2] ?? 9977)

// Fixed for the life of the process so two runs against one server instance see identical games.
const HOUR = 3600_000
// Moved to noon Eastern, so the games share one Eastern date whatever time the tests run (they used to straddle midnight
// when run in the late evening, which made the date-keyed projection tests fail at that hour only).
const etHour = (t) => Number(new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) % 24
// At least 13 hours away (so the 12-hour cap on /capture can never reach these games, whatever the time of day) and at most 36 (inside the 40 hour window).
let base = Math.ceil(Date.now() / HOUR) * HOUR + 13 * HOUR
while (etHour(base) !== 12) base += HOUR
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z')

const EVENTS = [
  { id: 'ev_bos_det', home: 'Detroit Pistons', away: 'Boston Celtics', at: base },
  { id: 'ev_phi_nyk', home: 'New York Knicks', away: 'Philadelphia 76ers', at: base + 1800_000 },
  { id: 'ev_okc_sas', home: 'San Antonio Spurs', away: 'Oklahoma City Thunder', at: base + 3600_000 },
  { id: 'ev_gsw_lal', home: 'Los Angeles Lakers', away: 'Golden State Warriors', at: base + 5400_000 },
  // starts within about 3 hours, so a capture window finds it (it has no player props)
  { id: 'ev_mia_min', home: 'Miami Heat', away: 'Minnesota Timberwolves', at: Math.ceil(Date.now() / HOUR) * HOUR + 2 * HOUR },
]

// [event, player name as the book writes it, market, line, P(over), books that quote it]
// Includes: whole-number lines (a push is possible), an accented name, a one-sided quote, an outlier price,
// a player who is not in the database, and a very low line.
const PROPS = [
  ['ev_bos_det', 'Cade Cunningham', 'player_points', 21.5, 0.50, ['DraftKings', 'FanDuel', 'Bovada']],
  ['ev_bos_det', 'Cade Cunningham', 'player_assists', 8, 0.50, ['DraftKings', 'FanDuel']],          // integer line
  ['ev_bos_det', 'Jalen Duren', 'player_points', 17, 0.50, ['DraftKings', 'FanDuel', 'BetRivers']],  // integer line
  ['ev_bos_det', 'Jalen Duren', 'player_rebounds', 10.5, 0.52, ['DraftKings', 'FanDuel']],
  ['ev_phi_nyk', 'Jalen Brunson', 'player_points', 24.5, 0.50, ['DraftKings', 'FanDuel', 'Bovada']],
  ['ev_phi_nyk', 'Jalen Brunson', 'player_assists', 6.5, 0.48, ['DraftKings', 'FanDuel']],
  ['ev_phi_nyk', 'Jaylen Brown', 'player_points', 24.5, 0.50, ['DraftKings', 'Bovada']],
  ['ev_okc_sas', 'Victor Wembanyama', 'player_points', 25.5, 0.50, ['DraftKings', 'FanDuel', 'Bovada']],
  ['ev_okc_sas', 'Victor Wembanyama', 'player_rebounds', 11, 0.50, ['DraftKings', 'FanDuel']],      // integer line
  ['ev_gsw_lal', 'Stephen Curry', 'player_points', 26, 0.50, ['DraftKings', 'FanDuel']],            // integer line
  ['ev_gsw_lal', 'Stephen Curry', 'player_threes', 4.5, 0.50, ['DraftKings', 'FanDuel', 'BetRivers']],
  ['ev_gsw_lal', 'Luka Dončić', 'player_points', 29.5, 0.50, ['DraftKings', 'FanDuel']],           // accent in the name
  ['ev_gsw_lal', 'Nobody Atall', 'player_points', 12.5, 0.50, ['DraftKings']],                      // not in the database
  ['ev_gsw_lal', 'Stephen Curry', 'player_assists', 5.5, 0.50, ['FanDuel']],                        // single book
]
/** Eastern-time date of the fake games, so tests can seed projections for the right day. */
export const EVENT_DATE_ET = new Date(base).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const ONE_SIDED = new Set(['Stephen Curry|player_assists'])  // only an Over is quoted

const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) / 2 ** 32
const round = (x) => Math.round(x * 100) / 100

function eventOdds(ev) {
  const books = new Map()
  for (const [eid, player, market, line, p, who] of PROPS) {
    if (eid !== ev.id) continue
    for (const book of who) {
      const noise = (hash(`${book}${player}${market}`) - 0.5) * 0.04
      const margin = 1.05
      let over = 1 / Math.min(Math.max((p + noise) * margin, 0.05), 0.95)
      let under = 1 / Math.min(Math.max((1 - p - noise) * margin, 0.05), 0.95)
      if (book === 'Bovada') under *= 1.18  // an outlier price on one side
      const b = books.get(book) ?? books.set(book, { key: book.toLowerCase(), title: book, markets: new Map() }).get(book)
      const m = b.markets.get(market) ?? b.markets.set(market, { key: market, last_update: iso(Date.now()), outcomes: [] }).get(market)
      m.outcomes.push({ name: 'Over', description: player, price: round(over), point: line })
      if (!ONE_SIDED.has(`${player}|${market}`)) m.outcomes.push({ name: 'Under', description: player, price: round(under), point: line })
    }
  }
  return {
    id: ev.id, sport_key: 'basketball_nba', sport_title: 'NBA', commence_time: iso(ev.at), home_team: ev.home, away_team: ev.away,
    bookmakers: [...books.values()].map((b) => ({ ...b, markets: [...b.markets.values()] })),
  }
}

function teamOdds(ev) {
  const mk = (title, ml, sp, tot) => ({
    key: title.toLowerCase(), title, markets: [
      { key: 'h2h', outcomes: [{ name: ev.home, price: ml[0] }, { name: ev.away, price: ml[1] }] },
      { key: 'spreads', outcomes: [{ name: ev.home, price: 1.91, point: sp }, { name: ev.away, price: 1.91, point: -sp }] },
      { key: 'totals', outcomes: [{ name: 'Over', price: 1.91, point: tot }, { name: 'Under', price: 1.91, point: tot }] },
    ],
  })
  return { id: ev.id, sport_key: 'basketball_nba', commence_time: iso(ev.at), home_team: ev.home, away_team: ev.away,
    bookmakers: [mk('DraftKings', [1.8, 2.05], -2.5, 224.5), mk('FanDuel', [1.83, 2.0], -2, 225)] }
}

const SHARP_MARKET = { player_threes: 'player_made_threes', player_points_rebounds_assists: 'player_points_+_rebounds_+_assists' }
const row = (ev, b, o) => ({ ...o, sportsbook: b.key, event_id: ev.id, home_team: ev.home_team, away_team: ev.away_team, event_start_time: ev.commence_time,
  is_active: true, is_live: false, is_main_line: true, is_stale_pregame_price: false, timestamp: iso(Date.now()) })
let seq = 0
function propRows(ev) {
  return ev.bookmakers.flatMap((b) => b.markets.flatMap((m) => m.outcomes.map((o) => row(ev, b, {
    id: `p${++seq}`, market_type: SHARP_MARKET[m.key] ?? m.key, selection: o.name, selection_type: o.name.toLowerCase(), odds_decimal: o.price, line: o.point, player_name: o.description }))))
}
function teamRows(ev) {
  return ev.bookmakers.flatMap((b) => b.markets.flatMap((m) => m.outcomes.map((o) => {
    const market_type = { h2h: 'moneyline', spreads: 'point_spread', totals: 'total_points' }[m.key]
    const selection_type = o.name === ev.home_team ? 'home' : o.name === ev.away_team ? 'away' : o.name.toLowerCase()
    return row(ev, b, { id: `t${++seq}`, market_type, selection: o.name, selection_type, odds_decimal: o.price, line: o.point ?? null })
  })))
}

const counts = {}
let failing = false
let failingInjuries = false

// ESPN-shaped scoreboard for the same games (ESPN abbreviations differ from NBA.com's: NY, GS, SA).
const ESPN_ABBR = { 'Detroit Pistons': 'DET', 'Boston Celtics': 'BOS', 'New York Knicks': 'NY', 'Philadelphia 76ers': 'PHI',
  'San Antonio Spurs': 'SA', 'Oklahoma City Thunder': 'OKC', 'Los Angeles Lakers': 'LAL', 'Golden State Warriors': 'GS', 'Miami Heat': 'MIA', 'Minnesota Timberwolves': 'MIN' }
const scoreboard = () => ({ events: EVENTS.map((e) => ({
  id: `espn_${e.id}`, date: iso(e.at), status: { type: { shortDetail: 'Scheduled', state: 'pre' } },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: ESPN_ABBR[e.home], displayName: e.home }, score: '0' },
    { homeAway: 'away', team: { abbreviation: ESPN_ABBR[e.away], displayName: e.away }, score: '0' },
  ],
  odds: [{ provider: { displayName: 'Draft Kings' }, spread: 4.5, overUnder: 221.5, homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false },
    moneyline: { home: { close: { odds: '-180' } }, away: { close: { odds: '+150' } } } }] }],
})) })
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname.replace('/api/v1', '')
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'x-requests-remaining': '400', 'x-requests-last': '1' }); res.end(JSON.stringify(body)) }
  if (path === '/__stats') return send(200, counts)
  if (path === '/__fail') { failing = url.searchParams.get('on') === '1'; return send(200, { failing }) }
  if (path.startsWith('/apis/site/v2/sports/basketball/nba/scoreboard')) return send(200, scoreboard())
  if (path === '/apis/site/v2/sports/basketball/nba/summary') {
    if (url.searchParams.get('event') === '99999') return send(503, { message: 'summary down' })
    return send(200, { header: { competitions: [{ status: { type: { state: 'in', shortDetail: 'Q2 6:00' } } }] },
      boxscore: { players: [{ team: { abbreviation: 'BOS' }, statistics: [{ names: ['MIN', 'PTS', 'REB', 'AST', '3PT'],
        athletes: [{ athlete: { id: '77', displayName: 'Test Player' }, starter: true, stats: ['18', '12', '3', '2', '1-3'] }] }] }] } })
  }
  if (path === '/apis/site/v2/sports/basketball/nba/injuries') {
    if (failingInjuries) return send(503, { message: 'injuries down' })
    return send(200, { injuries: [
      { displayName: 'Philadelphia 76ers', injuries: [{ status: 'Out', shortComment: 'Brown is out with a sprained ankle.', athlete: { displayName: 'Jaylen Brown' } }] },
      { displayName: 'San Antonio Spurs', injuries: [{ status: 'Questionable', shortComment: 'Wembanyama is questionable (illness).', athlete: { displayName: 'Victor Wembanyama' } }] },
      { displayName: 'Los Angeles Lakers', injuries: [{ status: 'Day-To-Day', shortComment: 'Doncic is day-to-day.', athlete: { displayName: 'Luka Doncic' } }] },
    ] })
  }
  if (path === '/__failinjuries') { failingInjuries = url.searchParams.get('on') === '1'; return send(200, { failingInjuries }) }
  if (path === '/__reset') { for (const k of Object.keys(counts)) delete counts[k]; return send(200, {}) }
  if (failing) return send(500, { message: 'boom: internal provider detail that must never reach a browser' })
  if (path !== '/odds') return send(404, { message: 'not found', path })
  if (!req.headers['x-api-key']) return send(401, { error: { code: 'unauthorized' } })
  const markets = (url.searchParams.get('markets') ?? url.searchParams.get('market') ?? '').split(',')
  const books = (url.searchParams.get('sportsbooks') ?? '').split(',').filter(Boolean)
  const eventId = url.searchParams.get('event_id')
  const props = markets.some((m) => m.startsWith('player_'))
  counts[props ? '/events/:id/odds' : '/odds'] = (counts[props ? '/events/:id/odds' : '/odds'] ?? 0) + 1
  const ev = eventId ? EVENTS.find((e) => e.id === eventId) : null
  if (eventId && !ev) return send(200, { data: [], pagination: { has_more: false } })
  const keep = (r) => !books.length || books.includes(r.sportsbook)
  const all = (props ? (ev ? [eventOdds(ev)] : EVENTS.map(eventOdds)) : EVENTS.map(teamOdds)).flatMap((x) => (props ? propRows({ ...x, commence_time: x.commence_time }) : teamRows(x))).filter(keep)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, 200), at = Number(url.searchParams.get('cursor') ?? 0) || 0
  const data = all.slice(at, at + limit)
  return send(200, { data, pagination: { limit, count: data.length, has_more: at + limit < all.length, next_cursor: at + limit < all.length ? String(at + limit) : undefined }, updated_at: iso(Date.now()) })
})

if (process.argv[1]?.endsWith('fake_odds_server.mjs')) {
  server.listen(PORT, '127.0.0.1', () => console.log(`fake SharpAPI on http://127.0.0.1:${PORT}`))
}
export { server }
