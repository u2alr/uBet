import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { BIG_GAP, STATS, blendProb, hitRate, predict, riskTier, type GameType, type Risk, type Stat } from '../../shared/baseline'

type Env = { Bindings: { DB: D1Database; ODDS_API_KEY?: string; ODDS_REGIONS?: string; ODDS_MARKETS?: string; ODDS_HOURS?: string; ODDS_BOOKS?: string } }

const app = new Hono<Env>().basePath('/api')
app.onError((err, c) => c.json({ error: err.message }, 500))

// ---------- helpers ----------

const ODDS = 'https://api.the-odds-api.com/v4/sports/basketball_nba'
const MARKETS: Record<string, Stat> = {
  player_points: 'pts',
  player_rebounds: 'reb',
  player_assists: 'ast',
  player_threes: 'fg3m',
}
// The free plan is ~500 credits/month; one event costs (markets x regions) credits, so cache hard.
const ODDS_TTL = 8 * 60 * 60 // seconds
const MAX_EVENTS = 8

const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// ESPN team abbreviations that differ from NBA.com's (what ingest/sync.py stores).
const ESPN_TO_NBA: Record<string, string> = { GS: 'GSW', SA: 'SAS', NY: 'NYK', NO: 'NOP', WSH: 'WAS', UTAH: 'UTA' }
const nbaAbbr = (a: string) => ESPN_TO_NBA[a] ?? a

const TEAM_NAMES: Record<string, string> = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons',
  GSW: 'Golden State Warriors', HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers',
  LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies', MIA: 'Miami Heat', MIL: 'Milwaukee Bucks',
  MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks', OKC: 'Oklahoma City Thunder',
  ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards',
}

const etDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

async function cachedJson<T>(key: string, ttl: number, load: () => Promise<T>, fresh = false): Promise<T> {
  const cache = (caches as unknown as { default: Cache }).default
  const req = new Request(`https://cache.ubet.local/${key}`)
  const hit = fresh ? undefined : await cache.match(req)
  if (hit) return hit.json()
  const data = await load()
  await cache.put(req, new Response(JSON.stringify(data), { headers: { 'Cache-Control': `max-age=${ttl}` } }))
  return data
}

async function oddsFetch<T>(env: Env['Bindings'], path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ apiKey: env.ODDS_API_KEY!, ...params })
  const res = await fetch(`${ODDS}${path}?${qs}`)
  if (!res.ok) throw new Error(`The Odds API ${res.status}`)
  return res.json()
}

// ---------- status ----------

// When ingest/sync.py last finished, and how much data there is.
app.get('/status', async (c) => {
  const last = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'last_sync'").first<{ value: string }>().catch(() => null)
  const counts = await c.env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT MAX(date) FROM games) AS newestGame',
  ).first<{ players: number; newestGame: string | null }>()
  // D1's datetime('now') is UTC without a zone marker.
  return c.json({ lastSync: last ? `${last.value.replace(' ', 'T')}Z` : null, ...counts })
})

// ---------- players & stats ----------

// Players are loaded into D1 by ingest/sync.py, so search only covers synced players.
app.get('/players', async (c) => {
  const q = c.req.query('search')?.trim()
  const { results } = q
    ? await c.env.DB.prepare('SELECT id, name, team, position FROM players WHERE name LIKE ? ORDER BY name LIMIT 15')
        .bind(`%${q}%`).all()
    : await c.env.DB.prepare('SELECT id, name, team, position FROM players ORDER BY name LIMIT 50').all()
  return c.json({ data: results })
})

app.get('/players/:id', async (c) => {
  const p = await c.env.DB.prepare('SELECT id, name, team, position FROM players WHERE id = ?').bind(Number(c.req.param('id'))).first()
  return p ? c.json({ data: p }) : c.json({ error: 'Player not found' }, 404)
})

app.get('/players/:id/stats', async (c) => {
  const id = Number(c.req.param('id'))
  const stat = (c.req.query('stat') ?? 'pts') as Stat
  if (!STATS.includes(stat)) return c.json({ error: 'bad stat' }, 400)
  const lineQ = c.req.query('line')
  const line = lineQ ? Number(lineQ) : null
  const type = c.req.query('type') // 'regular' | 'playoffs' | omitted = all
  const typeSql = type === 'regular' || type === 'playoffs' || type === 'preseason' ? ' AND g.game_type = ?' : ''

  // `stat` is validated against the whitelist above, so interpolation is safe.
  const { results } = await c.env.DB.prepare(
    `SELECT g.date, g.id AS gameId, g.game_type AS type, pg.minutes, pg.${stat} AS value
     FROM player_games pg JOIN games g ON g.id = pg.game_id
     WHERE pg.player_id = ?${typeSql} ORDER BY g.date DESC`,
  ).bind(...(typeSql ? [id, type] : [id])).all<{ date: string; gameId: number; type: GameType; minutes: number; value: number }>()

  const values = results.map((r) => r.value)
  const avg = (n: number) => {
    const s = values.slice(0, n)
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null
  }
  return c.json({
    games: results,
    averages: { last5: avg(5), last10: avg(10), season: avg(values.length) },
    ...(line !== null && {
      line,
      hitRate: { last5: hitRate(values, line, 5), last10: hitRate(values, line, 10), season: hitRate(values, line, values.length) },
      prediction: predict(results.map((r) => ({ value: r.value, type: r.type })), line),
    }),
  })
})

// Full box-score history for the detailed player page, newest first.
app.get('/players/:id/log', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.date, g.season, g.game_type AS gameType, pg.opp, pg.is_home AS home, pg.won, pg.minutes,
            pg.pts, pg.reb, pg.ast, pg.fg3m, pg.stl, pg.blk, pg.fgm, pg.fga, pg.fg3a, pg.ftm, pg.fta,
            pg.oreb, pg.dreb, pg.tov, pg.pf, pg.plus_minus AS plusMinus
     FROM player_games pg JOIN games g ON g.id = pg.game_id
     WHERE pg.player_id = ? ORDER BY g.date DESC`,
  ).bind(Number(c.req.param('id'))).all()
  return c.json({ data: results })
})

// ---------- schedule (ESPN, keyless) ----------

async function loadGames(fresh = false) {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
  const now = Date.now()
  return cachedJson<any[]>('scoreboard', 120, async () => {
    // ESPN rejects date ranges, so fetch one request per day.
    const days = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${fmt(new Date(now + i * 86400_000))}`,
        )
        if (!res.ok) throw new Error(`ESPN ${res.status}`)
        return ((await res.json()) as any).events ?? []
      }),
    )
    return days.flat().map((e: any) => {
      const comp = e.competitions[0]
      const side = (h: string) => comp.competitors.find((t: any) => t.homeAway === h)
      return {
        id: e.id,
        date: e.date,
        status: e.status.type.shortDetail,
        state: e.status.type.state as 'pre' | 'in' | 'post',
        home: { abbr: side('home').team.abbreviation, name: side('home').team.displayName, score: side('home').score },
        away: { abbr: side('away').team.abbreviation, name: side('away').team.displayName, score: side('away').score },
      }
    })
  }, fresh)
}

app.get('/games', async (c) => {
  // ?fresh=1 skips the cache (the Refresh button). Costs ~3 Odds API credits for team odds.
  const fresh = c.req.query('fresh') === '1'
  const [games, odds] = await Promise.all([loadGames(fresh), loadTeamOdds(c.env, fresh).catch(() => new Map<string, GameOdds>())])
  return c.json({
    data: games.map((g) => ({ ...g, odds: odds.get(`${teamKey(g.away.name)}@${teamKey(g.home.name)}`)?.summary ?? null })),
  })
})

// ---------- team odds (moneyline / spread / total, all books) ----------

interface BookOdds {
  key: string
  title: string
  moneyline?: { home: number; away: number }
  spread?: { point: number; home: number; away: number } // point is the home team's line
  total?: { point: number; over: number; under: number }
}
interface GameOdds {
  books: BookOdds[]
  summary: {
    spread: number | null // home line, median across books
    total: number | null
    homeWinProb: number | null // no-vig, averaged across books
    bestMoneyline: { home: number; away: number } | null
  }
}

// Odds API and ESPN disagree on a few team names (e.g. "Los Angeles Clippers" vs "LA Clippers").
const teamKey = (n: string) => n.replace(/^Los Angeles /, 'LA ').toLowerCase()

const median = (xs: number[]) => {
  if (!xs.length) return null
  const a = [...xs].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}

function parseGameOdds(ev: any): GameOdds {
  const books: BookOdds[] = []
  for (const b of ev.bookmakers ?? []) {
    const o: BookOdds = { key: b.key, title: b.title }
    for (const m of b.markets) {
      if (m.key === 'h2h') {
        const home = m.outcomes.find((x: any) => x.name === ev.home_team)
        const away = m.outcomes.find((x: any) => x.name === ev.away_team)
        if (home && away) o.moneyline = { home: home.price, away: away.price }
      } else if (m.key === 'spreads') {
        const home = m.outcomes.find((x: any) => x.name === ev.home_team)
        const away = m.outcomes.find((x: any) => x.name === ev.away_team)
        if (home && away) o.spread = { point: home.point, home: home.price, away: away.price }
      } else if (m.key === 'totals') {
        const over = m.outcomes.find((x: any) => x.name === 'Over')
        const under = m.outcomes.find((x: any) => x.name === 'Under')
        if (over && under) o.total = { point: over.point, over: over.price, under: under.price }
      }
    }
    books.push(o)
  }
  const ml = books.filter((b) => b.moneyline).map((b) => b.moneyline!)
  // Remove the bookmaker's margin by normalising the two implied probabilities.
  const probs = ml.map((m) => 1 / m.home / (1 / m.home + 1 / m.away))
  return {
    books,
    summary: {
      spread: median(books.filter((b) => b.spread).map((b) => b.spread!.point)),
      total: median(books.filter((b) => b.total).map((b) => b.total!.point)),
      homeWinProb: probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null,
      bestMoneyline: ml.length ? { home: Math.max(...ml.map((m) => m.home)), away: Math.max(...ml.map((m) => m.away)) } : null,
    },
  }
}

// One call covers every game, so team odds are cheap (markets x regions credits in total).
async function loadTeamOdds(env: Env['Bindings'], fresh = false): Promise<Map<string, GameOdds>> {
  if (!env.ODDS_API_KEY) return new Map()
  const params: Record<string, string> = {
    regions: env.ODDS_REGIONS ?? 'us', markets: 'h2h,spreads,totals', oddsFormat: 'decimal',
  }
  if (env.ODDS_BOOKS) params.bookmakers = env.ODDS_BOOKS
  const events = await cachedJson<any[]>(`team-odds-${params.regions}-${env.ODDS_BOOKS ?? ''}`, 30 * 60, () => oddsFetch(env, '/odds', params), fresh)
  return new Map(events.map((e) => [`${teamKey(e.away_team)}@${teamKey(e.home_team)}`, parseGameOdds(e)]))
}

// ---------- picks (The Odds API + model) ----------

interface Pick {
  playerId: number
  player: string
  /** NBA.com abbreviation of the player's current team, e.g. BOS. */
  team: string | null
  teamName: string | null
  stat: Stat
  side: 'over' | 'under'
  line: number
  price: number
  book: string
  /** Best price per book for this exact bet, highest first. */
  prices: { book: string; price: number }[]
  modelProb: number
  marketProb: number | null
  /** Model blended with the market. This is the probability we trust. */
  prob: number
  impliedProb: number
  /** Expected profit per 1 staked, using the blended probability. */
  ev: number
  risk: Risk
  /** True when the model and market disagree wildly, which usually means the model is missing news. */
  bigGap: boolean
  confidence: number
  projection: number
  hitRate10: number | null
  recent: number[]
  sample: number
  game: string
  gameDate: string
}

// Roughly mid-April to June is playoff time.
function isPlayoffDate(etDay: string) {
  const [, m, d] = etDay.split('-').map(Number)
  return (m === 4 && d >= 16) || m === 5 || m === 6
}

async function loadPicks(env: Env['Bindings']): Promise<{ configured: boolean; picks: Pick[] }> {
  if (!env.ODDS_API_KEY) return { configured: false, picks: [] }

  const events = await cachedJson<any[]>('odds-events', 30 * 60, () => oddsFetch(env, '/events'))
  const upcoming = events
    .filter((e) => Date.parse(e.commence_time) < Date.now() + Number(env.ODDS_HOURS ?? 40) * 3600_000 && Date.parse(e.commence_time) > Date.now())
    .slice(0, MAX_EVENTS)

  const regions = env.ODDS_REGIONS ?? 'us'
  const markets = env.ODDS_MARKETS ?? 'player_points,player_rebounds,player_assists'
  const odds = await Promise.all(
    upcoming.map((e) =>
      cachedJson<any>(`odds-${e.id}-${regions}-${markets}`, ODDS_TTL, () =>
        oddsFetch(env, `/events/${e.id}/odds`, { regions, markets, oddsFormat: 'decimal' }),
      ),
    ),
  )

  const { results: players } = await env.DB.prepare('SELECT id, name, team FROM players').all<{ id: number; name: string; team: string | null }>()
  const byName = new Map(players.map((p) => [normName(p.name), p]))

  // One query for every matched player's history (regular season, playoffs and preseason).
  const wanted = new Set<number>()
  for (const o of odds)
    for (const b of o.bookmakers ?? [])
      for (const m of b.markets)
        for (const out of m.outcomes) {
          const p = byName.get(normName(out.description ?? ''))
          if (p) wanted.add(p.id)
        }
  if (!wanted.size) return { configured: true, picks: [] }

  const { results: logs } = await env.DB.prepare(
    `SELECT pg.player_id, g.game_type AS type, pg.pts, pg.reb, pg.ast, pg.fg3m
     FROM player_games pg JOIN games g ON g.id = pg.game_id
     WHERE pg.player_id IN (${[...wanted].join(',')}) ORDER BY g.date DESC`,
  ).all<any>()
  const history = new Map<number, any[]>()
  for (const r of logs) (history.get(r.player_id) ?? history.set(r.player_id, []).get(r.player_id)!).push(r)

  type Quote = { book: string; price: number }
  type Line = { pl: { id: number; name: string; team: string | null }; stat: Stat; point: number; over: Quote[]; under: Quote[] }
  const picks: Pick[] = []

  for (const o of odds) {
    const game = `${o.away_team} @ ${o.home_team}`
    const gameDate = etDate(o.commence_time)
    const upcomingType: GameType = isPlayoffDate(gameDate) ? 'playoffs' : 'regular'

    // Group every book's Over/Under for the same player, stat and line.
    const lines = new Map<string, Line>()
    for (const b of o.bookmakers ?? [])
      for (const m of b.markets) {
        const stat = MARKETS[m.key]
        if (!stat) continue
        for (const out of m.outcomes) {
          const pl = byName.get(normName(out.description ?? ''))
          if (!pl || !history.has(pl.id)) continue
          const k = `${pl.id}|${stat}|${out.point}`
          const L = lines.get(k) ?? lines.set(k, { pl, stat, point: out.point, over: [], under: [] }).get(k)!
          ;(out.name === 'Over' ? L.over : L.under).push({ book: b.title, price: out.price })
        }
      }

    for (const L of lines.values()) {
      const rows = history.get(L.pl.id)!
      const samples = rows.map((r) => ({ value: r[L.stat] as number, type: r.type as GameType }))
      const pred = predict(samples, L.point, upcomingType)
      if (!pred) continue
      const played = samples.filter((s) => s.type !== 'preseason').map((s) => s.value)

      // Market view with the book margin removed, averaged over books that quote both sides.
      const books = new Map<string, { o?: number; u?: number }>()
      for (const x of L.over) books.set(x.book, { ...books.get(x.book), o: Math.max(x.price, books.get(x.book)?.o ?? 0) })
      for (const x of L.under) books.set(x.book, { ...books.get(x.book), u: Math.max(x.price, books.get(x.book)?.u ?? 0) })
      const both = [...books.values()].filter((v) => v.o && v.u)
      const marketOver = both.length ? both.reduce((a, v) => a + 1 / v.o! / (1 / v.o! + 1 / v.u!), 0) / both.length : null

      for (const side of ['over', 'under'] as const) {
        const quotes = side === 'over' ? L.over : L.under
        if (!quotes.length) continue
        const sorted = [...new Map(quotes.map((x) => [x.book, x.price])).entries()]
          .map(([book, price]) => ({ book, price }))
          .sort((a, b) => b.price - a.price)
        const best = sorted[0]
        const modelProb = side === 'over' ? pred.pOver : 1 - pred.pOver
        const marketProb = marketOver == null ? null : side === 'over' ? marketOver : 1 - marketOver
        const prob = blendProb(modelProb, marketProb, pred.confidence)
        const over10 = hitRate(played, L.point, 10)
        picks.push({
          playerId: L.pl.id, player: L.pl.name, team: L.pl.team, teamName: L.pl.team ? TEAM_NAMES[L.pl.team] ?? null : null, stat: L.stat, side, line: L.point, price: best.price, book: best.book,
          prices: sorted.slice(0, 5), modelProb, marketProb, prob, impliedProb: 1 / best.price,
          ev: prob * best.price - 1, risk: riskTier(prob), bigGap: marketProb != null && Math.abs(modelProb - marketProb) > BIG_GAP, confidence: pred.confidence, projection: pred.predicted,
          hitRate10: over10 == null ? null : side === 'over' ? over10 : 1 - over10,
          recent: played.slice(0, 10).reverse(), sample: pred.sample, game, gameDate,
        })
      }
    }
  }

  // Keep each player's best-value side and their safest side; the UI slices these into tabs.
  const keep = new Map<string, Pick>()
  const groups = new Map<string, Pick[]>()
  for (const p of picks) {
    const k = `${p.playerId}|${p.stat}`
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  for (const group of groups.values()) {
    const value = group.reduce((a, b) => (b.ev > a.ev ? b : a))
    const safe = group.reduce((a, b) => (b.prob > a.prob ? b : a))
    for (const p of [value, safe]) keep.set(`${p.playerId}|${p.stat}|${p.side}|${p.line}`, p)
  }
  return { configured: true, picks: [...keep.values()].sort((a, b) => b.ev - a.ev).slice(0, 80) }
}

app.get('/picks', async (c) => {
  const { configured, picks } = await loadPicks(c.env)
  const worth = picks.filter((p) => p.ev > 0 || p.risk === 'safe').slice(0, 40)
  if (worth.length)
    await c.env.DB.batch(
      worth.map((p) =>
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO predictions (player_id,stat,line,predicted,p_over,model,game_date,side,price,book)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          p.playerId, p.stat, p.line, p.projection, p.side === 'over' ? p.prob : 1 - p.prob,
          'baseline-v2', p.gameDate, p.side, p.price, p.book,
        ),
      ),
    )
  return c.json({ configured, data: picks })
})

// Everything for one game: key players on each team (recent form) plus suggested bets.
app.get('/games/:id', async (c) => {
  const fresh = c.req.query('fresh') === '1'
  const game = (await loadGames(fresh)).find((g) => g.id === c.req.param('id'))
  if (!game) return c.json({ error: 'Game not found' }, 404)

  const teams = [game.away, game.home]
  const { results: roster } = await c.env.DB.prepare(
    `SELECT id, name, team FROM players WHERE team IN (?, ?)`,
  ).bind(nbaAbbr(game.away.abbr), nbaAbbr(game.home.abbr)).all<{ id: number; name: string; team: string }>()

  const logs = new Map<number, any[]>()
  if (roster.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT pg.player_id, g.date, pg.minutes, pg.pts, pg.reb, pg.ast, pg.fg3m
       FROM player_games pg JOIN games g ON g.id = pg.game_id
       WHERE pg.player_id IN (${roster.map((p) => p.id).join(',')}) AND g.game_type = 'regular' ORDER BY g.date DESC`,
    ).all<any>()
    for (const r of results) (logs.get(r.player_id) ?? logs.set(r.player_id, []).get(r.player_id)!).push(r)
  }
  const avg = (rows: any[], k: string) => (rows.length ? rows.reduce((a, r) => a + r[k], 0) / rows.length : 0)

  const players = roster
    .map((p) => {
      const last10 = (logs.get(p.id) ?? []).slice(0, 10)
      return {
        id: p.id, name: p.name, team: p.team, games: last10.length,
        min: avg(last10, 'minutes'), pts: avg(last10, 'pts'), reb: avg(last10, 'reb'),
        ast: avg(last10, 'ast'), fg3m: avg(last10, 'fg3m'),
        recent: { pts: last10.map((r) => r.pts).reverse() },
      }
    })
    .filter((p) => p.games > 0)
    .sort((a, b) => b.min - a.min)

  const { picks, configured } = await loadPicks(c.env)
  const teamOdds = (await loadTeamOdds(c.env, fresh).catch(() => new Map<string, GameOdds>())).get(
    `${teamKey(game.away.name)}@${teamKey(game.home.name)}`,
  )
  const matchup = `${game.away.name} @ ${game.home.name}`
  return c.json({
    game,
    configured,
    odds: teamOdds ?? null,
    teams: teams.map((t) => ({ ...t, players: players.filter((p) => p.team === nbaAbbr(t.abbr)).slice(0, 8) })),
    picks: picks.filter((p) => p.game === matchup),
    teamPicks: Object.fromEntries(
      teams.map((t) => [t.abbr, picks.filter((p) => p.game === matchup && p.team === nbaAbbr(t.abbr))]),
    ) as Record<string, Pick[]>,
  })
})

// ---------- results: grade logged picks against box scores ----------

async function gradePicks(db: D1Database) {
  await db.batch([
    ...STATS.map((s) =>
      db.prepare(
        `UPDATE predictions SET actual = (
           SELECT pg.${s} FROM player_games pg JOIN games g ON g.id = pg.game_id
           WHERE pg.player_id = predictions.player_id AND g.date = predictions.game_date)
         WHERE actual IS NULL AND stat = '${s}' AND game_date IS NOT NULL`,
      ),
    ),
    // 1 = won, 0 = lost, 2 = push
    db.prepare(
      `UPDATE predictions SET hit = CASE WHEN actual = line THEN 2
         WHEN (side = 'over' AND actual > line) OR (side = 'under' AND actual < line) THEN 1 ELSE 0 END
       WHERE actual IS NOT NULL AND hit IS NULL AND side IS NOT NULL`,
    ),
  ])
}

app.get('/results', async (c) => {
  await gradePicks(c.env.DB)
  const { results } = await c.env.DB.prepare(
    `SELECT p.name AS player, pr.stat, pr.side, pr.line, pr.price, pr.book, pr.actual, pr.hit, pr.game_date AS gameDate
     FROM predictions pr JOIN players p ON p.id = pr.player_id
     WHERE pr.hit IS NOT NULL ORDER BY pr.game_date DESC, pr.id DESC LIMIT 40`,
  ).all()
  const summary = await c.env.DB.prepare(
    `SELECT SUM(hit = 1) AS won, SUM(hit = 0) AS lost, SUM(hit = 2) AS pushed,
            SUM(CASE hit WHEN 1 THEN price - 1 WHEN 0 THEN -1 ELSE 0 END) AS units
     FROM predictions WHERE hit IS NOT NULL`,
  ).first()
  return c.json({ data: results, summary })
})

// Manual prediction logging from the player page.
app.post('/predictions', async (c) => {
  const b = await c.req.json<{ playerId: number; stat: Stat; line: number; predicted: number; pOver: number; model: string }>()
  if (!STATS.includes(b.stat)) return c.json({ error: 'bad stat' }, 400)
  await c.env.DB.prepare(
    'INSERT INTO predictions (player_id,stat,line,predicted,p_over,model) VALUES (?,?,?,?,?,?)',
  ).bind(b.playerId, b.stat, b.line, b.predicted, b.pOver, b.model).run()
  return c.json({ ok: true })
})

export const onRequest = handle(app)
