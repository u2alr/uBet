import { Hono, type Context } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { LIMITS, STATS, hitRate, predict, predictV3, type GameType, type Stat } from '../../shared/baseline.ts'
import { enrichPicks, parseInjuries, roleFromMinutes, type Injury, type Role } from '../../shared/injuries.ts'
import { MINDS_VERSION } from '../../shared/minds.ts'
import { assessOddsAge, buildPicks, etDate, normName, sameMatchup, scoreboardDates, teamKey, type HistoryRow, type OddsEvent, type Pick, type PicksMeta, type ProjectionRow } from '../../shared/picks.ts'

type Bindings = {
  DB: D1Database
  ODDS_API_KEY?: string
  /** If set, privileged routes need this in the x-capture-token header; if not, they only work from localhost. */
  CAPTURE_TOKEN?: string
  /** Only for tests: point the Worker at fake providers (tests/integration). */
  ODDS_BASE_URL?: string
  ESPN_BASE_URL?: string
  /** 'v3' switches the fallback model to the negative-binomial baseline (see shared/baseline.ts). Default 'v2'. */
  FALLBACK_MODEL?: string
  ODDS_REGIONS?: string
  ODDS_MARKETS?: string
  ODDS_HOURS?: string
  ODDS_BOOKS?: string
}
type Env = { Bindings: Bindings }
type Ctx = Context<Env>

const app = new Hono<Env>().basePath('/api')

class UpstreamError extends Error {}

// Cloudflare's _headers file does not apply to Functions responses, so the API sets its own.
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Cache-Control', 'no-store') // odds and picks go stale; never let a browser or proxy keep them
})

// Clients get a generic message; the detail goes to the server log only (it can name internal tables or providers).
app.onError((err, c) => {
  console.error('api error', c.req.method, new URL(c.req.url).pathname, err instanceof Error ? err.message : String(err))
  return err instanceof UpstreamError
    ? c.json({ error: 'A data provider is unavailable. Try again later.' }, 502)
    : c.json({ error: 'Internal error.' }, 500)
})

// ---------- access control ----------

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Routes that spend metered provider credits or write to the database are not public.
 * With CAPTURE_TOKEN set, the caller must send it; without one, only localhost may call them.
 */
function privileged(c: Ctx) {
  if (c.env.CAPTURE_TOKEN) return timingSafeEqual(c.req.header('x-capture-token') ?? '', c.env.CAPTURE_TOKEN)
  const host = new URL(c.req.url).hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

/** ?fresh=1 means "skip the cache", which costs provider credits, so only privileged callers get it. */
const wantsFresh = (c: Ctx) => c.req.query('fresh') === '1' && privileged(c)

// ---------- input validation ----------

const parseId = (v: string) => (/^\d{1,12}$/.test(v) ? Number(v) : null)
const parseLine = (v: string) => {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return null
  const n = Number(v)
  return n <= LIMITS.maxLine ? n : null
}
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')
const GAME_TYPES = ['regular', 'playoffs', 'preseason']

// ---------- provider access ----------

const ODDS_DEFAULT = 'https://api.the-odds-api.com/v4/sports/basketball_nba'
// The free plan is ~500 credits/month; one event costs (markets x regions) credits, so cache hard.
const ODDS_TTL = 8 * 60 * 60 // seconds
const MAX_EVENTS = 8

// ESPN team abbreviations that differ from NBA.com's (what ingest/sync.py stores).
const ESPN_TO_NBA: Record<string, string> = { GS: 'GSW', SA: 'SAS', NY: 'NYK', NO: 'NOP', WSH: 'WAS', UTAH: 'UTA' }
const nbaAbbr = (a: string) => ESPN_TO_NBA[a] ?? a

interface Cached<T> { fetchedAt: number | null; data: T }

/** Cache API with the fetch time stored alongside the data, so the age of what we show is always known. */
async function cachedMeta<T>(key: string, ttl: number, load: () => Promise<T>, fresh = false): Promise<Cached<T>> {
  const cache = (caches as unknown as { default: Cache }).default
  const req = new Request(`https://cache.ubet.local/${key}`)
  const hit = fresh ? undefined : await cache.match(req)
  if (hit) {
    const body = (await hit.json()) as any
    if (body && typeof body === 'object' && 'fetchedAt' in body && 'data' in body) return body as Cached<T>
    return { fetchedAt: null, data: body as T } // written by an older version: age unknown
  }
  const entry: Cached<T> = { fetchedAt: Date.now(), data: await load() }
  await cache.put(req, new Response(JSON.stringify(entry), { headers: { 'Cache-Control': `max-age=${ttl}` } }))
  return entry
}
const cachedJson = async <T>(key: string, ttl: number, load: () => Promise<T>, fresh = false) => (await cachedMeta(key, ttl, load, fresh)).data

async function oddsFetch<T>(env: Bindings, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ apiKey: env.ODDS_API_KEY!, ...params })
  const res = await fetch(`${env.ODDS_BASE_URL ?? ODDS_DEFAULT}${path}?${qs}`)
  if (!res.ok) throw new UpstreamError(`The Odds API ${res.status}`)
  const body = await res.text()
  // Keep every odds response exactly as received (the API key is never stored) so closing lines can be
  // reconstructed later. A storage failure must never break the request.
  if (path.includes('/odds'))
    await env.DB.prepare('INSERT INTO odds_raw (path, params, body) VALUES (?,?,?)')
      .bind(path, JSON.stringify(params), body).run().catch(() => {})
  return JSON.parse(body)
}

// ---------- odds capture (for closing-line analysis) ----------

// Fetches fresh prop and team odds for games starting within `hours` and stores the raw responses.
app.get('/capture', async (c) => {
  if (!privileged(c)) return c.json({ error: 'Forbidden' }, 403)
  if (!c.env.ODDS_API_KEY) return c.json({ error: 'ODDS_API_KEY not set' }, 400)

  const asked = Number(c.req.query('hours') ?? 3)
  const hours = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 12) : 3
  const events = await oddsFetch<any[]>(c.env, '/events')
  const soon = events.filter((e) => Date.parse(e.commence_time) > Date.now() && Date.parse(e.commence_time) < Date.now() + hours * 3600_000)
  const regions = c.env.ODDS_REGIONS ?? 'us'
  const markets = c.env.ODDS_MARKETS ?? 'player_points,player_rebounds,player_assists'
  for (const e of soon)
    await oddsFetch(c.env, `/events/${e.id}/odds`, { regions, markets, oddsFormat: 'decimal' })
  if (soon.length) await loadTeamOdds(c.env, true)
  const credits = soon.length * markets.split(',').length * regions.split(',').length + (soon.length ? 3 : 0)
  return c.json({ games: soon.length, approxCreditsSpent: credits })
})

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
  if (q && q.length > 64) return c.json({ error: 'search is too long' }, 400)
  const { results } = q
    ? await c.env.DB.prepare("SELECT id, name, team, position FROM players WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 15")
        .bind(`%${escapeLike(q)}%`).all()
    : await c.env.DB.prepare('SELECT id, name, team, position FROM players ORDER BY name LIMIT 50').all()
  return c.json({ data: results })
})

app.get('/players/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'bad player id' }, 400)
  const p = await c.env.DB.prepare('SELECT id, name, team, position FROM players WHERE id = ?').bind(id).first()
  return p ? c.json({ data: p }) : c.json({ error: 'Player not found' }, 404)
})

app.get('/players/:id/stats', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'bad player id' }, 400)
  const stat = (c.req.query('stat') ?? 'pts') as Stat
  if (!STATS.includes(stat)) return c.json({ error: 'bad stat' }, 400)
  const lineQ = c.req.query('line')
  const line = lineQ ? parseLine(lineQ) : null
  if (lineQ && line === null) return c.json({ error: 'line must be a number from 0 to 300' }, 400)
  const type = c.req.query('type') // 'regular' | 'playoffs' | 'preseason' | omitted = all
  if (type && !GAME_TYPES.includes(type)) return c.json({ error: 'bad type' }, 400)
  const typeSql = type ? ' AND g.game_type = ?' : ''

  // `stat` is validated against the whitelist above, so interpolation is safe.
  const { results } = await c.env.DB.prepare(
    `SELECT g.date, g.id AS gameId, g.game_type AS type, pg.minutes, pg.${stat} AS value
     FROM player_games pg JOIN games g ON g.id = pg.game_id
     WHERE pg.player_id = ?${typeSql} ORDER BY g.date DESC`,
  ).bind(...(type ? [id, type] : [id])).all<{ date: string; gameId: number; type: GameType; minutes: number; value: number }>()

  const who = await c.env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(id).first<{ name: string }>()
  const regularMinutes = results.filter((r) => r.type !== 'preseason').map((r) => r.minutes)
  const role: Role | null = roleFromMinutes(regularMinutes.length >= 3 ? regularMinutes : results.map((r) => r.minutes))
  const injury = who ? ((await loadInjuries(c.env)) ?? new Map<string, Injury>()).get(normName(who.name)) ?? null : null
  const values = results.map((r) => r.value)
  const avg = (n: number) => {
    const s = values.slice(0, n)
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null
  }
  return c.json({
    role, injury,
    games: results,
    averages: { last5: avg(5), last10: avg(10), season: avg(values.length) },
    ...(line !== null && {
      line,
      hitRate: { last5: hitRate(values, line, 5), last10: hitRate(values, line, 10), season: hitRate(values, line, values.length) },
      prediction: (c.env.FALLBACK_MODEL === 'v3' ? predictV3(stat, results.map((r) => ({ value: r.value, type: r.type })), line)
        : predict(results.map((r) => ({ value: r.value, type: r.type })), line)),
    }),
  })
})

/**
 * "Without X": this player's games in which teammate X did not play, counted only while X belonged to the team,
 * i.e. X has a game for that team on or before this date AND on or after it. That keeps games from before X arrived,
 * and after X was traded away for good, out of the split.
 */
const WITHOUT_SQL = `AND NOT EXISTS (SELECT 1 FROM player_games x WHERE x.player_id = ? AND x.game_id = pg.game_id)
  AND EXISTS (SELECT 1 FROM player_games x JOIN games xg ON xg.id = x.game_id WHERE x.player_id = ? AND x.team_id = pg.team_id AND xg.date <= g.date)
  AND EXISTS (SELECT 1 FROM player_games x JOIN games xg ON xg.id = x.game_id WHERE x.player_id = ? AND x.team_id = pg.team_id AND xg.date >= g.date)`
const WITH_SQL = 'AND EXISTS (SELECT 1 FROM player_games x WHERE x.player_id = ? AND x.game_id = pg.game_id AND x.team_id = pg.team_id)'

// Full box-score history for the detailed player page, newest first. ?with=ID / ?without=ID filters by a teammate.
app.get('/players/:id/log', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'bad player id' }, 400)
  const withQ = c.req.query('with'), withoutQ = c.req.query('without')
  const mate = withQ !== undefined ? parseId(withQ) : withoutQ !== undefined ? parseId(withoutQ) : undefined
  if (mate === null || (withQ !== undefined && withoutQ !== undefined)) return c.json({ error: 'bad teammate id' }, 400)
  const filter = mate === undefined ? '' : withQ !== undefined ? WITH_SQL : WITHOUT_SQL
  const binds = mate === undefined ? [id] : withQ !== undefined ? [id, mate] : [id, mate, mate, mate]
  const { results } = await c.env.DB.prepare(
    `SELECT g.date, g.id AS gameId, g.season, g.game_type AS gameType, pg.opp, pg.is_home AS home, pg.won, pg.minutes,
            pg.pts, pg.reb, pg.ast, pg.fg3m, pg.stl, pg.blk, pg.fgm, pg.fga, pg.fg3a, pg.ftm, pg.fta,
            pg.oreb, pg.dreb, pg.tov, pg.pf, pg.plus_minus AS plusMinus
     FROM player_games pg JOIN games g ON g.id = pg.game_id
     WHERE pg.player_id = ? ${filter} ORDER BY g.date DESC`,
  ).bind(...binds).all()
  return c.json({ data: results })
})

// Current teammates this player has played games without, most-missed first: the choices for the "without" filter.
app.get('/players/:id/teammates', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return c.json({ error: 'bad player id' }, 400)
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, COUNT(DISTINCT pg.game_id) AS missed
     FROM players me
     JOIN players t ON t.team = me.team AND t.id != me.id
     JOIN player_games pg ON pg.player_id = me.id
     JOIN games g ON g.id = pg.game_id
     WHERE me.id = ?
       AND NOT EXISTS (SELECT 1 FROM player_games x WHERE x.player_id = t.id AND x.game_id = pg.game_id)
       AND EXISTS (SELECT 1 FROM player_games x JOIN games xg ON xg.id = x.game_id WHERE x.player_id = t.id AND x.team_id = pg.team_id AND xg.date <= g.date)
       AND EXISTS (SELECT 1 FROM player_games x JOIN games xg ON xg.id = x.game_id WHERE x.player_id = t.id AND x.team_id = pg.team_id AND xg.date >= g.date)
     GROUP BY t.id, t.name HAVING missed > 0 ORDER BY missed DESC LIMIT 30`,
  ).bind(id).all()
  return c.json({ data: results })
})

// ---------- schedule (ESPN, keyless) ----------

async function loadGames(env: Bindings, fresh = false) {
  const dates = scoreboardDates(Date.now())
  return cachedJson<any[]>('scoreboard', 120, async () => {
    // ESPN rejects date ranges, so fetch one request per day.
    const days = await Promise.all(
      dates.map(async (date) => {
        const res = await fetch(
          `${env.ESPN_BASE_URL ?? 'https://site.api.espn.com'}/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`,
        )
        if (!res.ok) throw new UpstreamError(`ESPN ${res.status}`)
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
  // ?fresh=1 skips the cache (the Refresh button) but is honoured only for privileged callers (it spends credits).
  const fresh = wantsFresh(c)
  const [games, odds] = await Promise.all([loadGames(c.env, fresh), loadTeamOdds(c.env, fresh).catch((e) => {
    console.error('team odds unavailable', e instanceof Error ? e.message : String(e))
    return null
  })])
  return c.json({
    data: games.map((g) => ({ ...g, odds: odds?.get(`${teamKey(g.away.name)}@${teamKey(g.home.name)}`)?.summary ?? null })),
    // Say so when the odds could not be loaded, instead of silently showing games with no odds.
    meta: { oddsAvailable: odds !== null, freshRequested: c.req.query('fresh') === '1', freshHonored: fresh },
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
        if (home && away && Number.isFinite(home.point)) o.spread = { point: home.point, home: home.price, away: away.price }
      } else if (m.key === 'totals') {
        const over = m.outcomes.find((x: any) => x.name === 'Over')
        const under = m.outcomes.find((x: any) => x.name === 'Under')
        if (over && under && Number.isFinite(over.point)) o.total = { point: over.point, over: over.price, under: under.price }
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
async function loadTeamOdds(env: Bindings, fresh = false): Promise<Map<string, GameOdds>> {
  if (!env.ODDS_API_KEY) return new Map()
  const params: Record<string, string> = {
    regions: env.ODDS_REGIONS ?? 'us', markets: 'h2h,spreads,totals', oddsFormat: 'decimal',
  }
  if (env.ODDS_BOOKS) params.bookmakers = env.ODDS_BOOKS
  const events = await cachedJson<any[]>(`team-odds-${params.regions}-${env.ODDS_BOOKS ?? ''}`, 30 * 60, () => oddsFetch(env, '/odds', params), fresh)
  return new Map(events.map((e) => [`${teamKey(e.away_team)}@${teamKey(e.home_team)}`, parseGameOdds(e)]))
}

// ---------- availability (ESPN's keyless injury list) ----------

/** Player name -> listed status. Keyless, so it costs no credits; null if ESPN is down, which callers say out loud. */
async function loadInjuries(env: Bindings, fresh = false): Promise<Map<string, Injury> | null> {
  try {
    const feed = await cachedJson<unknown>('espn-injuries', 15 * 60, async () => {
      const res = await fetch(`${env.ESPN_BASE_URL ?? 'https://site.api.espn.com'}/apis/site/v2/sports/basketball/nba/injuries`)
      if (!res.ok) throw new UpstreamError(`ESPN injuries ${res.status}`)
      return res.json()
    }, fresh)
    return parseInjuries(feed)
  } catch (e) {
    console.error('injuries unavailable', e instanceof Error ? e.message : String(e))
    return null
  }
}

// ---------- picks (The Odds API + model) ----------

async function loadPicks(env: Bindings, fresh = false): Promise<{ configured: boolean; picks: Pick[]; meta: PicksMeta }> {
  const now = Date.now()
  const meta: PicksMeta = { generatedAt: new Date(now).toISOString(), oddsAsOf: null, warnings: [] }
  if (!env.ODDS_API_KEY) return { configured: false, picks: [], meta }

  const events = await cachedJson<any[]>('odds-events', 30 * 60, () => oddsFetch(env, '/events'), fresh)
  const upcoming = events
    .filter((e) => Date.parse(e.commence_time) < now + Number(env.ODDS_HOURS ?? 40) * 3600_000 && Date.parse(e.commence_time) > now)
    .slice(0, MAX_EVENTS)

  const regions = env.ODDS_REGIONS ?? 'us'
  const markets = env.ODDS_MARKETS ?? 'player_points,player_rebounds,player_assists'
  const fetched = await Promise.all(
    upcoming.map((e) =>
      cachedMeta<OddsEvent>(`odds-${e.id}-${regions}-${markets}`, ODDS_TTL, () =>
        oddsFetch(env, `/events/${e.id}/odds`, { regions, markets, oddsFormat: 'decimal' }),
      fresh),
    ),
  )

  // How old is what we are about to show? Lines move before tip-off, so the age is part of the answer.
  const age = assessOddsAge(fetched.map((f) => f.fetchedAt), now)
  meta.oddsAsOf = age.oddsAsOf
  meta.warnings.push(...age.warnings)
  if (age.blocked) return { configured: true, picks: [], meta }

  const odds = fetched.map((f) => f.data)
  const { results: players } = await env.DB.prepare('SELECT id, name, team FROM players').all<{ id: number; name: string; team: string | null }>()
  const byName = new Map(players.map((p) => [normName(p.name), p]))

  // Players the odds mention that we hold history for.
  const wanted = new Set<number>()
  for (const o of odds)
    for (const b of o.bookmakers ?? [])
      for (const m of b.markets)
        for (const out of m.outcomes) {
          const p = byName.get(normName(out.description ?? ''))
          if (p) wanted.add(p.id)
        }

  const dates = [...new Set(odds.map((o) => etDate(o.commence_time)))]
  const projections = dates.length
    ? (await env.DB.prepare(
        `SELECT player_id, game_date, stat, mean, alpha, model, created_at FROM projections WHERE game_date IN (${dates.map(() => '?').join(',')})`,
      ).bind(...dates).all<ProjectionRow>().catch(() => ({ results: [] as ProjectionRow[] }))).results
    : []
  const history = wanted.size
    ? (await env.DB.prepare(
        `SELECT pg.player_id, g.game_type AS type, pg.pts, pg.reb, pg.ast, pg.fg3m, pg.minutes
         FROM player_games pg JOIN games g ON g.id = pg.game_id
         WHERE pg.player_id IN (${[...wanted].join(',')}) ORDER BY g.date DESC`,
      ).all<HistoryRow>()).results
    : []

  const built = buildPicks({ events: odds, players, history, projections, now, fallback: env.FALLBACK_MODEL === 'v3' ? 'v3' : 'v2' })
  const d = built.diagnostics

  // Role (minutes over the last 10 games) and availability; history is newest first.
  const injuries = await loadInjuries(env, fresh)
  const annotated = enrichPicks(built.picks, history, injuries)
  const picks = annotated.picks

  if (d.fallbackLines > 0)
    meta.warnings.push({
      code: 'fallback_model',
      message: `${d.fallbackLines} line${d.fallbackLines === 1 ? '' : 's'} use the simpler average model because no fresh projection exists` +
        (d.staleProjectionPlayers.length ? ` (stale projections: ${d.staleProjectionPlayers.slice(0, 5).join(', ')}${d.staleProjectionPlayers.length > 5 ? '…' : ''})` : '') + '.',
    })
  if (d.unmatchedPlayers.length)
    meta.warnings.push({ code: 'unmatched_players', message: `${d.unmatchedPlayers.length} players in the odds are not synced, so they have no pick.` })
  if (d.invalidQuotes)
    meta.warnings.push({ code: 'invalid_quotes', message: `${d.invalidQuotes} malformed price${d.invalidQuotes === 1 ? '' : 's'} from the provider were ignored.` })
  if (injuries === null)
    meta.warnings.push({ code: 'no_injury_data', message: 'Injury statuses could not be loaded, and injuries are not modelled. Check the injury report before betting.' })
  else {
    if (annotated.dropped.length)
      meta.warnings.push({ code: 'injured_dropped', message: `${annotated.dropped.length} player${annotated.dropped.length === 1 ? '' : 's'} listed Out, so their lines are hidden: ${annotated.dropped.slice(0, 4).join(', ')}${annotated.dropped.length > 4 ? '…' : ''}.` })
    meta.warnings.push({ code: 'injuries_not_modelled', message: 'Injury tags come from ESPN and can lag. The projections do not use them, and lineup news is not modelled: check the team report before betting.' })
  }

  // Are the box scores behind every projection current?
  const sync = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_sync'").first<{ value: string }>().catch(() => null)
  const newest = await env.DB.prepare('SELECT MAX(date) AS d FROM games').first<{ d: string | null }>().catch(() => null)
  const inSeason = newest?.d ? now - Date.parse(`${newest.d}T12:00:00Z`) < 14 * 86400_000 : false
  const syncAge = sync ? (now - Date.parse(`${sync.value.replace(' ', 'T')}Z`)) / 3600_000 : Infinity
  if (inSeason && syncAge > 48)
    meta.warnings.push({ code: 'boxscores_stale', message: sync ? `Box scores were last synced ${Math.round(syncAge / 24)} days ago.` : 'Box scores have never been synced.' })

  return { configured: true, picks, meta }
}

app.get('/picks', async (c) => {
  const { configured, picks, meta } = await loadPicks(c.env, wantsFresh(c))
  await logPicks(c.env, picks).catch((e) => console.error('pick logging failed', e instanceof Error ? e.message : String(e)))
  return c.json({ configured, data: picks, meta })
})

/**
 * Freeze the picks as they were shown, for forward evaluation (INSERT OR IGNORE keeps the first price and model).
 * Throttled so repeated page loads cannot turn into a stream of database writes.
 */
async function logPicks(env: Bindings, picks: Pick[]) {
  const worth = picks.filter((p) => p.ev > 0 || p.risk === 'safe').slice(0, 40)
  if (!worth.length) return
  const last = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_pick_log'").first<{ value: string }>().catch(() => null)
  if (last && Date.now() - Number(last.value) < 10 * 60_000) return
  await env.DB.batch([
    ...worth.map((p) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO predictions (player_id,stat,line,predicted,p_over,model,game_date,side,price,book,model_prob,market_prob,push)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        p.playerId, p.stat, p.line, p.projection, p.side === 'over' ? p.prob : 1 - p.prob,
        p.model, p.gameDate, p.side, p.price, p.book, p.modelProb, p.marketProb, p.push,
      ),
    ),
    env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_pick_log', ?)").bind(String(Date.now())),
  ])
}

// Everything for one game: key players on each team (recent form) plus suggested bets.
app.get('/games/:id', async (c) => {
  const fresh = wantsFresh(c)
  const game = (await loadGames(c.env, fresh)).find((g) => g.id === c.req.param('id'))
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

  // Props stay cached even on Refresh: a fresh pull is ~24 credits (see Today.tsx). Only the schedule and team odds refresh.
  const { picks, configured, meta } = await loadPicks(c.env, false)
  const teamOdds = (await loadTeamOdds(c.env, fresh).catch(() => new Map<string, GameOdds>())).get(
    `${teamKey(game.away.name)}@${teamKey(game.home.name)}`,
  )
  const gamePicks = picks.filter((p) => sameMatchup(p.game, game.away.name, game.home.name))
  return c.json({
    game,
    configured,
    meta,
    odds: teamOdds ?? null,
    teams: teams.map((t) => ({ ...t, players: players.filter((p) => p.team === nbaAbbr(t.abbr)).slice(0, 8) })),
    picks: gamePicks,
    teamPicks: Object.fromEntries(
      teams.map((t) => [t.abbr, gamePicks.filter((p) => p.team === nbaAbbr(t.abbr))]),
    ) as Record<string, Pick[]>,
  })
})

// ---------- results ----------

// Pure read. Picks are graded against box scores by ingest/sync.py (see GRADE_SQL there), not by page views.
app.get('/results', async (c) => {
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

const LEG_STATS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk']
async function recentBefore(db: D1Database, legs: { playerId: number; stat: string; gameDate: string }[]): Promise<number[][]> {
  const ids = [...new Set(legs.map((l) => l.playerId).filter((n) => Number.isInteger(n)))]
  if (!ids.length) return legs.map(() => [])
  const newest = legs.reduce((m, l) => (l.gameDate > m ? l.gameDate : m), '')
  const { results } = await db.prepare(
    `SELECT pg.player_id AS playerId, g.date, pg.pts, pg.reb, pg.ast, pg.fg3m, pg.stl, pg.blk
     FROM player_games pg JOIN games g ON g.id = pg.game_id
     WHERE pg.player_id IN (${ids.join(',')}) AND g.game_type = 'regular' AND g.date < ? AND g.date >= date(?, '-400 days')
     ORDER BY g.date DESC`,
  ).bind(newest, newest).all<Record<string, number | string>>()
  const byPlayer = new Map<number, Record<string, number | string>[]>()
  for (const r of results) (byPlayer.get(r.playerId as number) ?? byPlayer.set(r.playerId as number, []).get(r.playerId as number)!).push(r)
  return legs.map((l) => {
    if (!LEG_STATS.includes(l.stat)) return []
    return (byPlayer.get(l.playerId) ?? []).filter((r) => (r.date as string) < l.gameDate).slice(0, 10).map((r) => r[l.stat] as number).reverse()
  })
}

// The minds' frozen cards and their record. Pure read; cards are written by minds/run.mjs, graded by ingest/sync.py.
// ?version=minds-v1 shows an archived rule set; the default is the current one. Versions never mix in one record.
app.get('/minds', async (c) => {
  const db = c.env.DB
  const asked = c.req.query('version')
  if (asked !== undefined && !/^minds-v\d{1,3}$/.test(asked)) return c.json({ error: 'bad version' }, 400)
  const version = asked ?? MINDS_VERSION
  const versions = (await db.prepare(
    `SELECT version, COUNT(*) AS bets, SUM(status IN ('won','lost','push')) AS settled, MIN(day) AS since FROM mind_bets GROUP BY version ORDER BY version DESC`,
  ).all()).results
  const bets = (await db.prepare(
    `SELECT id, day, mind, version, kind, odds, prob, ev, status, profit FROM mind_bets WHERE version = ? ORDER BY day DESC, id DESC LIMIT 3000`,
  ).bind(version).all()).results
  const legs = bets.length ? (await db.prepare(
    `SELECT bet_id AS betId, idx, player_id AS playerId, player, stat, side, line, price, book, game_date AS gameDate, prob,
            model_prob AS modelProb, market_prob AS marketProb, actual, result, event_id AS eventId,
            (SELECT team FROM players WHERE id = mind_legs.player_id) AS team
     FROM mind_legs WHERE bet_id IN (SELECT id FROM (SELECT id FROM mind_bets WHERE version = ? ORDER BY day DESC, id DESC LIMIT 3000)) ORDER BY bet_id, idx`,
  ).bind(version).all()).results : []
  // Each leg's last 10 regular-season games BEFORE its game date (what was known when the bet was made), oldest first.
  const recent = await recentBefore(db, legs as { playerId: number; stat: string; gameDate: string }[])
  legs.forEach((l, i) => { l.recent = recent[i] })
  const summary = (await db.prepare(
    `SELECT mind, COUNT(*) AS bets,
            SUM(status IN ('won','lost','push')) AS settled, SUM(status = 'won') AS won, SUM(status = 'lost') AS lost,
            SUM(status = 'open') AS open, COALESCE(SUM(profit), 0) AS units,
            AVG(CASE WHEN status IN ('won','lost') THEN prob END) AS statedProb,
            AVG(CASE WHEN status IN ('won','lost') THEN (status = 'won') END) AS actualRate,
            AVG(CASE WHEN status IN ('won','lost') THEN ev END) AS statedEv,
            SUM(CASE WHEN status IN ('won','lost','push') THEN stake END) AS staked,
            AVG(odds) AS avgOdds, AVG(ev) AS avgEv, SUM(kind = 'combo') AS combos, SUM(kind = 'single') AS singles,
            COUNT(DISTINCT day) AS days, MAX(profit) AS bestWin, MIN(profit) AS worstLoss
     FROM mind_bets WHERE version = ? GROUP BY mind`,
  ).bind(version).all()).results
  const curve = (await db.prepare(
    `SELECT mind, day, SUM(profit) AS units FROM mind_bets WHERE profit IS NOT NULL AND version = ? GROUP BY mind, day ORDER BY day`,
  ).bind(version).all()).results
  return c.json({ data: { bets, legs, summary, curve, version, versions, current: MINDS_VERSION, minBets: 200 } })
})

// Manual prediction logging from the player page. Writes to the database, so it is not public.
app.post('/predictions', async (c) => {
  if (!privileged(c)) return c.json({ error: 'Forbidden' }, 403)
  let b: Record<string, unknown>
  try {
    const parsed: unknown = await c.req.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
    b = parsed as Record<string, unknown>
  } catch {
    return c.json({ error: 'body must be a JSON object' }, 400)
  }
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null)
  const playerId = num(b.playerId, 1, 1e12)
  const line = num(b.line, 0, LIMITS.maxLine)
  const predicted = num(b.predicted, 0, LIMITS.maxMean)
  const pOver = num(b.pOver, 0, 1)
  const model = typeof b.model === 'string' && /^[\w.-]{1,32}$/.test(b.model) ? b.model : null
  if (playerId === null || !Number.isInteger(playerId) || !STATS.includes(b.stat as Stat) || line === null || predicted === null || pOver === null || model === null)
    return c.json({ error: 'invalid prediction' }, 400)
  await c.env.DB.prepare(
    'INSERT INTO predictions (player_id,stat,line,predicted,p_over,model) VALUES (?,?,?,?,?,?)',
  ).bind(playerId, b.stat, line, predicted, pOver, model).run()
  return c.json({ ok: true })
})

export const onRequest = handle(app)
