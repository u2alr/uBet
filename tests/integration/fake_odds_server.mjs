// A stand-in for The Odds API, so the real Worker can be exercised end to end with controlled data and
// without spending credits. It also COUNTS requests, which lets tests prove whether an unauthenticated
// caller can make the Worker spend upstream credits.
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
const base = Math.ceil(Date.now() / HOUR) * HOUR + 26 * HOUR
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

const counts = {}
let failing = false

// ESPN-shaped scoreboard for the same games (ESPN abbreviations differ from NBA.com's: NY, GS, SA).
const ESPN_ABBR = { 'Detroit Pistons': 'DET', 'Boston Celtics': 'BOS', 'New York Knicks': 'NY', 'Philadelphia 76ers': 'PHI',
  'San Antonio Spurs': 'SA', 'Oklahoma City Thunder': 'OKC', 'Los Angeles Lakers': 'LAL', 'Golden State Warriors': 'GS', 'Miami Heat': 'MIA', 'Minnesota Timberwolves': 'MIN' }
const scoreboard = () => ({ events: EVENTS.map((e) => ({
  id: `espn_${e.id}`, date: iso(e.at), status: { type: { shortDetail: 'Scheduled', state: 'pre' } },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { abbreviation: ESPN_ABBR[e.home], displayName: e.home }, score: '0' },
    { homeAway: 'away', team: { abbreviation: ESPN_ABBR[e.away], displayName: e.away }, score: '0' },
  ] }],
})) })
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname.replace('/v4/sports/basketball_nba', '')
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'x-requests-remaining': '400', 'x-requests-last': '1' }); res.end(JSON.stringify(body)) }
  if (path === '/__stats') return send(200, counts)
  if (path === '/__fail') { failing = url.searchParams.get('on') === '1'; return send(200, { failing }) }
  if (path.startsWith('/apis/site/v2/sports/basketball/nba/scoreboard')) return send(200, scoreboard())
  if (path === '/__reset') { for (const k of Object.keys(counts)) delete counts[k]; return send(200, {}) }
  if (failing) return send(500, { message: 'boom: internal provider detail that must never reach a browser' })
  const key = path.replace(/\/events\/[^/]+\/odds/, '/events/:id/odds')
  counts[key] = (counts[key] ?? 0) + 1
  if (url.searchParams.get('apiKey') == null) return send(401, { message: 'missing key' })
  if (path === '/events') return send(200, EVENTS.map((e) => ({ id: e.id, sport_key: 'basketball_nba', commence_time: iso(e.at), home_team: e.home, away_team: e.away })))
  if (path === '/odds') return send(200, EVENTS.map(teamOdds))
  const m = path.match(/^\/events\/([^/]+)\/odds$/)
  const ev = m && EVENTS.find((e) => e.id === m[1])
  if (ev) return send(200, eventOdds(ev))
  send(404, { message: 'not found', path })
})

if (process.argv[1]?.endsWith('fake_odds_server.mjs')) {
  server.listen(PORT, '127.0.0.1', () => console.log(`fake Odds API on http://127.0.0.1:${PORT}`))
}
export { server }
