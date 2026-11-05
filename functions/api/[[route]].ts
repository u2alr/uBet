import { Hono, type Context } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { LIMITS, STATS, hitRate, predict, predictV3, type GameType, type Stat } from '../../shared/baseline.ts'
import { enrichPicks, listAbsences, parseInjuries, roleFromMinutes, type Injury, type Role } from '../../shared/injuries.ts'
import { parseStandings } from '../../shared/standings.ts'
import { parseLiveBox } from '../../shared/liveBox.ts'
import { parseSportsDbEvents } from '../../shared/sportsdb.ts'
import type { GameLeanRow } from '../../shared/games.ts'
import adaptationStatus from '../../shared/adaptation.status.json' with { type: 'json' }
import { review, type ReviewRow } from '../../shared/seasonReview.ts'
import { SOURCES, gutKey, isOpen, parsePick, scoreGut, type GutPick, type GutResult, type Source } from '../../shared/gut.ts'
import teamFormStatus from '../../shared/teamForm.status.json' with { type: 'json' }
import { teamForm, type TeamResult } from '../../shared/teamForm.ts'
import { modelIsFresh, teamBet } from '../../shared/teamBets.ts'
import { MAX_REPORT_AGE_HOURS, buildLineup, espnListings, nameKey, officialListings, reportAgeHours, type Candidate, type LineupPlayer, type Listing, type OfficialRow } from '../../shared/lineups.ts'
import { consensusProb, fairProb } from '../../shared/devig.ts'
import { ownLine } from '../../shared/ownLines.ts'
import { assembleGames, assembleProps, type StoredRow } from '../../shared/oddsSnapshot.ts'
import { SHARP_BASE, SHARP_BOOKS, SHARP_PROP_MARKETS, SHARP_TEAM_MARKETS, normalizeSharpGames, normalizeSharpProps, type GameOddsEvent, type SharpQuote } from '../../shared/sharpapi.ts'
import { teamByName } from '../../src/lib/teams.ts'
import { applyAuthority } from '../../shared/engine/authority.ts'
import { CALIBRATION } from '../../shared/engine/artifact.ts'
import { DEFAULT_ENGINE_CONFIG } from '../../shared/engine/config.ts'
import { trackRecord, type GradedPrediction } from '../../shared/trackRecord.ts'
import { OPP_ALLOWED_SQL, attachOpponent, buildOppTable, type AllowedRow } from '../../shared/opponent.ts'
import { boardPayload, slim } from '../../shared/boardPayload.ts'
import { TEAM_IDS, abbrOfTeamId, normAbbr } from '../../shared/teamCodes.ts'
import { evaluateHealth } from '../../shared/health.ts'
import { matchupSummary, teamFacts, workloadFacts, type PlayedGame, type WorkloadFacts } from '../../shared/schedule.ts'
import humanFactorsStatus from '../../shared/humanFactors.status.json' with { type: 'json' }
import defenseStatus from '../../shared/defense.status.json' with { type: 'json' }
import gamesStatus from '../../shared/games.status.json' with { type: 'json' }
import { PRIOR_SQL, closingProxy, firstObserved, flatten, planArchive, priorFromRows, runSql, type PriorRow } from '../../shared/oddsArchive.ts'
import { MAX_PLAYERS_PER_QUERY, chunk, groupMeetings, parsePairs, type H2HRow } from '../../shared/h2h.ts'
import { assessOddsAge, buildPicks, etDate, normName, sameMatchup, scoreboardDates, teamKey, type HistoryRow, type OddsEvent, type Pick, type PicksMeta, type ProjectionRow } from '../../shared/picks.ts'

type Bindings = {
  DB: D1Database
  /** SharpAPI key (https://sharpapi.io): the one odds provider. */
  SHARPAPI_KEY?: string
  /** If set, privileged routes need this in the x-capture-token header; if not, they only work from localhost. */
  CAPTURE_TOKEN?: string
  /** Only for tests: point the Worker at fake providers (tests/integration). */
  SHARPAPI_BASE_URL?: string
  ESPN_BASE_URL?: string
  SPORTSDB_BASE_URL?: string
  /** 'v3' switches the fallback model to the negative-binomial baseline (see shared/baseline.ts). Default 'v2'. */
  FALLBACK_MODEL?: string
  /** Games to pull props for per refresh (default 3). The free plan allows 12 requests a minute and a game takes about 3. */
  ODDS_MAX_EVENTS?: string
  ODDS_HOURS?: string
  /** Comma-separated SharpAPI sportsbook ids to read. Default: draftkings,fanduel (the free plan's two). */
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

/** Only a page served from this computer may change the user's own picks: they are personal, and the site has no logins. A token does not widen this. */
const localOnly = (c: Ctx) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)

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

// SharpAPI free plan: 12 requests a minute, 200 rows a page, quotes delayed 60 seconds. One game's props are about 3 pages, so cache.
const PROPS_TTL = 10 * 60 // seconds
const GAMES_TTL = 10 * 60
/** Games whose props are pulled per refresh. Raise ODDS_MAX_EVENTS to see more; each game costs about 3 of the free plan's 12 requests a minute. */
const DEFAULT_MAX_EVENTS = 3
const MAX_PAGES = 8

const sharpBooks = (env: Bindings) => (env.ODDS_BOOKS ? env.ODDS_BOOKS.split(',').map((b) => b.trim()).filter(Boolean) : SHARP_BOOKS)

// ESPN team abbreviations that differ from NBA.com's (what ingest/sync.py stores).
const nbaAbbr = normAbbr

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

/**
 * Every row SharpAPI has for these filters, following its cursor. NBA, pre-game only. The key goes in a header and is never stored or logged.
 * A 429 means the free plan's 12 requests a minute are spent: say so and let the caller show what it has.
 */
async function sharpRows(env: Bindings, params: Record<string, string>): Promise<SharpQuote[]> {
  const rows: SharpQuote[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ league: 'nba', is_live: 'false', limit: '200', ...params, ...(cursor ? { cursor } : {}) })
    const res = await fetch(`${env.SHARPAPI_BASE_URL ?? SHARP_BASE}/odds?${qs}`, { headers: { 'X-API-Key': env.SHARPAPI_KEY! } })
    if (res.status === 429) throw new UpstreamError('SharpAPI rate limit reached (12 requests a minute on the free plan); try again in a minute')
    if (!res.ok) throw new UpstreamError(`SharpAPI ${res.status}`)
    const body = (await res.json()) as { data?: SharpQuote[]; pagination?: { has_more?: boolean; next_cursor?: string } }
    rows.push(...(body.data ?? []))
    cursor = body.pagination?.has_more ? body.pagination.next_cursor : undefined
    if (!cursor) break
  }
  return rows
}

/**
 * The odds the site shows come from `odds_snapshot`, filled by the local odds sync (scripts/sync_odds.mjs), so a page load never calls the provider.
 * Until a first sync has stored anything, the Worker falls back to asking the provider itself (cached), so a fresh install still shows odds.
 */
async function readSnapshot(env: Bindings, kind: 'games' | 'props', eventId?: string): Promise<StoredRow[]> {
  try {
    const sql = `SELECT event_id, part, commence_time, home_team, away_team, fetched_at, body FROM odds_snapshot WHERE kind = ?${eventId ? ' AND event_id = ?' : ''}`
    return (await env.DB.prepare(sql).bind(...(eventId ? [kind, eventId] : [kind])).all<StoredRow>()).results
  } catch { return [] } // the table does not exist until migration 0022 is applied
}

/** Every upcoming game with its moneyline, spread and total. Stored odds first; the provider (one to two requests for the whole slate) only before any sync. */
async function loadSharpGames(env: Bindings, fresh = false): Promise<GameOddsEvent[]> {
  if (!fresh) {
    const stored = assembleGames(await readSnapshot(env, 'games'))
    if (stored.length) return stored
  }
  return cachedJson<GameOddsEvent[]>(`sharp-games-${sharpBooks(env).join('+')}`, GAMES_TTL, async () =>
    normalizeSharpGames(await sharpRows(env, { markets: SHARP_TEAM_MARKETS, is_main_line: 'true', sportsbooks: sharpBooks(env).join(',') }), sharpBooks(env)), fresh)
}

const oddsAreSynced = async (env: Bindings) => !!(await env.DB.prepare("SELECT 1 AS x FROM odds_snapshot LIMIT 1").first().catch(() => null))

/**
 * One game's player props, main lines only, as the pick builder's event shape, with the time the provider answered.
 * Once the odds sync has run, only stored props are used (null when a game has none yet): the provider is not called per page view.
 */
async function loadEventProps(env: Bindings, g: { id: string; commence_time: string; home_team: string; away_team: string }, fresh = false): Promise<Cached<OddsEvent> | null> {
  if (!fresh && await oddsAreSynced(env)) {
    const stored = assembleProps(await readSnapshot(env, 'props', g.id))
    return stored ? { fetchedAt: stored.fetchedAt, data: stored.event } : null
  }
  return cachedMeta<OddsEvent>(`sharp-props-${g.id}-${sharpBooks(env).join('+')}`, PROPS_TTL, async () => {
    const rows = await sharpRows(env, { event_id: g.id, markets: SHARP_PROP_MARKETS, is_main_line: 'true', sportsbooks: sharpBooks(env).join(',') })
    return normalizeSharpProps(rows, sharpBooks(env)).events[0] ?? { id: g.id, commence_time: g.commence_time, home_team: g.home_team, away_team: g.away_team, bookmakers: [] }
  }, fresh)
}

// ---------- odds capture (for closing-line analysis) ----------

// Fetches fresh prop and team odds for games starting within `hours` and stores the raw responses.
app.get('/capture', async (c) => {
  if (!privileged(c)) return c.json({ error: 'Forbidden' }, 403)
  if (!c.env.SHARPAPI_KEY) return c.json({ error: 'SHARPAPI_KEY not set' }, 400)

  const asked = Number(c.req.query('hours') ?? 3)
  const hours = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 12) : 3
  const games = await loadSharpGames(c.env, true)
  const soon = games.filter((e) => Date.parse(e.commence_time) > Date.now() && Date.parse(e.commence_time) < Date.now() + hours * 3600_000).slice(0, 6)
  for (const e of soon) {
    const ev = await loadEventProps(c.env, e, true)
    if (ev) await archiveSnapshot(c.env, ev.data, ev.fetchedAt)
  }
  return c.json({ games: soon.length })
})

// ---------- status ----------

// When ingest/sync.py last finished, and how much data there is.
app.get('/status', async (c) => {
  const last = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'last_sync'").first<{ value: string }>().catch(() => null)
  const counts = await c.env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT MAX(date) FROM games) AS newestGame',
  ).first<{ players: number; newestGame: string | null }>()
  // What the odds sync last stored: the age of the odds the site is showing.
  const odds = await c.env.DB.prepare("SELECT COUNT(DISTINCT CASE WHEN kind = 'games' THEN event_id END) AS games, COUNT(DISTINCT CASE WHEN kind = 'props' THEN event_id END) AS propGames, MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest FROM odds_snapshot")
    .first<{ games: number; propGames: number; oldest: number | null; newest: number | null }>().catch(() => null)
  // D1's datetime('now') is UTC without a zone marker.
  return c.json({ lastSync: last ? `${last.value.replace(' ', 'T')}Z` : null, ...counts, odds })
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
    `SELECT g.date, g.id AS gameId, g.game_type AS type, pg.minutes, ${stat === 'pra' ? '(pg.pts + pg.reb + pg.ast)' : `pg.${stat}`} AS value
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

// Head-to-head: each requested player's most recent games against the requested opponent. ?pairs=<playerId>:<OPP>,... (at most 200).
// Queries are chunked because D1 allows only 100 bound variables per statement.
app.get('/h2h', async (c) => {
  const raw = (c.req.query('pairs') ?? '').split(',').filter(Boolean)
  if (raw.length === 0 || raw.length > 200) return c.json({ error: 'pairs must hold 1 to 200 entries' }, 400)
  const pairs = parsePairs(raw)
  if (!pairs) return c.json({ error: 'bad pair' }, 400)
  const opps = [...new Set(pairs.map((p) => p.opp))]
  if (opps.length > 30) return c.json({ error: 'too many opponents' }, 400)
  const rows: H2HRow[] = []
  for (const ids of chunk([...new Set(pairs.map((p) => p.id))], MAX_PLAYERS_PER_QUERY)) {
    const { results } = await c.env.DB.prepare(
      `SELECT pg.player_id AS id, pg.opp, g.date, pg.minutes, pg.pts, pg.reb, pg.ast, pg.fg3m
       FROM player_games pg JOIN games g ON g.id = pg.game_id
       WHERE pg.player_id IN (${ids.map(() => '?').join(',')}) AND pg.opp IN (${opps.map(() => '?').join(',')}) AND g.game_type != 'preseason' AND pg.minutes > 0
       ORDER BY g.date DESC`,
    ).bind(...ids, ...opps).all<H2HRow>()
    rows.push(...results)
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return c.json({ data: groupMeetings(rows, pairs) })
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
    try { return await espnScoreboard(env, dates) } catch (e) {
      // ESPN is down: fall back to TheSportsDB's upcoming games (no live scores on the free tier) rather than showing nothing.
      console.error('ESPN scoreboard unavailable, using TheSportsDB', e instanceof Error ? e.message : String(e))
      const res = await fetch(`${env.SPORTSDB_BASE_URL ?? 'https://www.thesportsdb.com'}/api/v1/json/123/eventsnextleague.php?id=4387`)
      if (!res.ok) throw new UpstreamError(`TheSportsDB ${res.status}`)
      const soonest = Date.now() + 3 * 86400_000
      return parseSportsDbEvents(await res.json(), (n) => teamByName(n)?.[0]).filter((g) => Date.parse(g.date) < soonest)
    }
  }, fresh)
}

async function espnScoreboard(env: Bindings, dates: string[]): Promise<any[]> {
  {
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
  }
}

app.get('/games', async (c) => {
  // ?fresh=1 skips the cache (the Refresh button) but is honoured only for privileged callers (it spends the provider's request allowance).
  const fresh = wantsFresh(c)
  const [games, odds] = await Promise.all([loadGames(c.env, fresh), loadTeamOdds(c.env, fresh).catch((e) => {
    console.error('team odds unavailable', e instanceof Error ? e.message : String(e))
    return null
  })])
  return c.json({
    data: games.map((g: any) => {
      const summary = odds?.get(`${teamKey(g.away.name)}@${teamKey(g.home.name)}`)?.summary
      return { ...g, odds: summary ? { ...summary, source: 'SharpAPI books' } : null }
    }),
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
  // Remove each bookmaker's margin with the power method, then combine the books by median (one far-off book is dropped).
  const probs = ml.map((m) => fairProb(m.home, m.away, 'power')).filter((p): p is number => p != null)
  return {
    books,
    summary: {
      spread: median(books.filter((b) => b.spread).map((b) => b.spread!.point)),
      total: median(books.filter((b) => b.total).map((b) => b.total!.point)),
      homeWinProb: consensusProb(probs)?.prob ?? null,
      bestMoneyline: ml.length ? { home: Math.max(...ml.map((m) => m.home)), away: Math.max(...ml.map((m) => m.away)) } : null,
    },
  }
}

// One request covers every game, so team odds are cheap.
async function loadTeamOdds(env: Bindings, fresh = false): Promise<Map<string, GameOdds>> {
  if (!env.SHARPAPI_KEY) return new Map()
  const events = await loadSharpGames(env, fresh)
  return new Map(events.map((e) => [`${teamKey(e.away_team)}@${teamKey(e.home_team)}`, parseGameOdds(e)]))
}

// Team bets: every upcoming game with the best price on each side, the market's chance, ours (the game model blended with the market),
// plus our own fair moneyline and spread. The odds are the stored ones; no provider call. It suggests no bets.
app.get('/team-bets', async (c) => {
  const fresh = wantsFresh(c)
  const [games, odds, leanRows, results] = await Promise.all([
    loadGames(c.env, fresh),
    loadTeamOdds(c.env, fresh).catch((e) => { console.error('team odds unavailable', e instanceof Error ? e.message : String(e)); return null }),
    c.env.DB.prepare(`SELECT date, home, away, model_home_prob, elo_home, elo_away, home_net10, away_net10, home_off20, home_def20, away_off20, away_def20, as_of, absent_home, absent_away, model_version, model_v1_prob, srs_home, srs_away, pred_margin, co_diff
       FROM game_lean WHERE date >= date('now', '-1 day')`).all<GameLeanRow>().then((r) => r.results).catch(() => [] as GameLeanRow[]),
    // Every team's results THIS SEASON, regular season only (last season, the playoffs and the preseason are left out; win or loss only, since the stored box scores are not complete enough for margins). One query serves every game.
    cachedJson<TeamResult[]>('team-results', 10 * 60, async () => (await c.env.DB.prepare(
      `SELECT g.date AS date, pg.team_id AS teamId, pg.opp AS opp, pg.is_home AS home, MAX(pg.won) AS won
       FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE g.game_type = 'regular' AND g.season = (SELECT MAX(season) FROM games WHERE game_type = 'regular') AND pg.opp IS NOT NULL
       GROUP BY g.id, pg.team_id`).all<{ date: string; teamId: number; opp: string; home: number; won: number }>()).results
      .flatMap((r) => { const team = abbrOfTeamId(r.teamId); return team ? [{ date: r.date, team, opp: normAbbr(r.opp), home: !!r.home, won: !!r.won }] : [] }), fresh)
      .catch(() => [] as TeamResult[]),
  ])
  const model = new Map(leanRows.map((r) => [`${r.date}|${normAbbr(r.home)}|${normAbbr(r.away)}`, r]))
  // The same lineup data the Lineups tab shows, so the two pages cannot disagree about who is out.
  const lineups = new Map<string, Awaited<ReturnType<typeof lineupRows>>['rows'][number]>((await lineupRows(c.env, games as any[]).catch(() => null))?.rows.map((r) => [r.id, r]) ?? [])
  const rows = games.filter((g: any) => g.state !== 'post').map((g: any) => {
    const ge = odds?.get(`${teamKey(g.away.name)}@${teamKey(g.home.name)}`)
    const m = model.get(`${etDate(g.date)}|${normAbbr(g.home.abbr)}|${normAbbr(g.away.abbr)}`)
    // A model snapshot that is too old is not blended in: the price alone is a better guide than a stale model.
    const modelFresh = !!m && modelIsFresh(m.as_of, Date.now())
    const bet = teamBet({ home: g.home.abbr, away: g.away.abbr, books: ge?.books ?? [], modelHomeProb: modelFresh ? m!.model_home_prob : null, modelMargin: modelFresh ? m!.pred_margin ?? null : null })
    const lu = lineups.get(g.id)
    return { id: g.id, lineup: lu ? { home: lineupSummary(lu.home), away: lineupSummary(lu.away) } : null, gutRef: { date: etDate(g.date), home: normAbbr(g.home.abbr), away: normAbbr(g.away.abbr) }, date: g.date, state: g.state as string, status: g.status as string, home: { abbr: g.home.abbr, name: g.home.name, score: g.home.score }, away: { abbr: g.away.abbr, name: g.away.name, score: g.away.score }, bet, books: ge?.books ?? [], form: teamForm(normAbbr(g.home.abbr), normAbbr(g.away.abbr), results, etDate(g.date)), model: m ?? null, modelAsOf: m?.as_of ?? null, modelStale: !!m && !modelFresh }
  })
  return c.json({ data: { games: rows }, meta: { teamForm: teamFormStatus, oddsAvailable: odds !== null && odds.size > 0, modelGames: rows.filter((r) => r.modelAsOf).length,
    note: 'Our chance is the game model blended with the market; with no price it is the model alone. The model is tested on past games, but it has not been tested against sportsbook prices and cannot see late injury news.', model: gamesStatus } })
})

// The season so far, reviewed: who the model had as the favourite before each game already played, who won, and what the upsets had in common. The predictions are the
// walk-forward ones (earlier seasons only) that research/game_snapshot.py stores; the review counts upsets against what the model expected before reading anything into them.
app.get('/season-review', async (c) => {
  const rows = await c.env.DB.prepare('SELECT date, home, away, p_home, home_won, srs_gap, talent_diff, rest_diff, b2b_home, b2b_away FROM season_review ORDER BY date, home')
    .all<ReviewRow>().then((r) => r.results).catch(() => [] as ReviewRow[])   // the table does not exist until migration 0024
  return c.json({ data: review(rows), meta: { model: gamesStatus, adaptation: adaptationStatus } })
})

// ---------- gut feeling ----------
// The user's own picks (shared/gut.ts). Saved only from a page on this computer and only before tip-off; read by anyone. They are scored on finished games against the
// model's own pre-game number and never change a displayed probability.

interface GutRow { source: Source; date: string; home: string; away: string; pick: 'home' | 'away'; level: 1 | 2 | 3; note: string | null; model_home_prob: number | null; saved_at: string }
const gutOut = (r: GutRow): GutPick => ({ source: r.source, date: r.date, home: r.home, away: r.away, pick: r.pick, level: r.level, note: r.note, modelHomeProb: r.model_home_prob, savedAt: r.saved_at })

/** Finished regular-season games from `since` on: (date, home, away) -> did the home team win. */
async function finishedResults(env: Bindings, since: string): Promise<Map<string, boolean>> {
  const rows = await env.DB.prepare(
    `SELECT g.date AS date, pg.team_id AS teamId, pg.opp AS opp, pg.is_home AS home, MAX(pg.won) AS won
     FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE g.game_type = 'regular' AND g.date >= ? AND pg.opp IS NOT NULL AND pg.is_home = 1
     GROUP BY g.id, pg.team_id`).bind(since).all<{ date: string; teamId: number; opp: string; home: number; won: number }>()
  const out = new Map<string, boolean>()
  for (const r of rows.results) { const home = abbrOfTeamId(r.teamId); if (home) out.set(gutKey(r.date, normAbbr(home), normAbbr(r.opp)), !!r.won) }
  return out
}

app.get('/gut', async (c) => {
  const rows = await c.env.DB.prepare('SELECT source, date, home, away, pick, level, note, model_home_prob, saved_at FROM gut_pick WHERE source = \'claude\' ORDER BY date DESC, home')
    .all<GutRow>().then((r) => r.results).catch(() => [] as GutRow[])      // the table does not exist until migration 0027
  const picks = rows.map(gutOut)
  const results = picks.length ? await finishedResults(c.env, picks[picks.length - 1].date).catch(() => new Map<string, boolean>()) : new Map<string, boolean>()
  const done: GutResult[] = picks.flatMap((p) => { const w = results.get(gutKey(p.date, p.home, p.away)); return w === undefined ? [] : [{ ...p, homeWon: w }] })
  const open = picks.filter((p) => !results.has(gutKey(p.date, p.home, p.away)))
  const by = <T,>(f: (rows: GutResult[]) => T) => Object.fromEntries(SOURCES.map((s) => [s, f(done.filter((r) => r.source === s))])) as Record<Source, T>
  return c.json({ data: { picks: open, records: by(scoreGut), recent: by((rows) => rows.slice(0, 20)) }, meta: { canEdit: localOnly(c), note: "Claude's picks are scored against the model's own pre-game number. They never change a displayed probability." } })
})

app.post('/gut', async (c) => {
  if (!localOnly(c)) return c.json({ error: 'Picks can only be saved from the copy running on your own computer.' }, 403)
  const parsed = parsePick(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const v = parsed.value
  const games = await loadGames(c.env, false).catch(() => null)
  if (!games) return c.json({ error: 'The schedule is unavailable, so the game cannot be checked. Try again in a moment.' }, 503)
  const game = games.find((g: any) => normAbbr(g.home.abbr) === v.home && normAbbr(g.away.abbr) === v.away && etDate(g.date) === v.date)
  if (!game) return c.json({ error: 'No such game on the schedule.' }, 404)
  if (game.state !== 'pre' || !isOpen(game.date, Date.now())) return c.json({ error: 'The game has started: a pick has to be made before tip-off.' }, 409)
  const lean = await c.env.DB.prepare('SELECT model_home_prob FROM game_lean WHERE date = ? AND home = ? AND away = ?').bind(v.date, v.home, v.away).first<{ model_home_prob: number }>().catch(() => null)
  await c.env.DB.prepare(
    `INSERT INTO gut_pick (source, date, home, away, pick, level, note, model_home_prob) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (source, date, home, away) DO UPDATE SET pick = excluded.pick, level = excluded.level, note = excluded.note, model_home_prob = excluded.model_home_prob, saved_at = datetime('now')`,
  ).bind(v.source, v.date, v.home, v.away, v.pick, v.level, v.note, lean?.model_home_prob ?? null).run()
  return c.json({ ok: true })
})

app.delete('/gut', async (c) => {
  if (!localOnly(c)) return c.json({ error: 'Picks can only be changed from the copy running on your own computer.' }, 403)
  const { date, home, away } = c.req.query()
  const source = 'claude'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^[A-Z]{2,4}$/.test(home ?? '') || !/^[A-Z]{2,4}$/.test(away ?? '')) return c.json({ error: 'date, home and away are required' }, 400)
  const games = await loadGames(c.env, false).catch(() => null)
  const game = games?.find((g: any) => normAbbr(g.home.abbr) === home && normAbbr(g.away.abbr) === away && etDate(g.date) === date)
  if (game && (game.state !== 'pre' || !isOpen(game.date, Date.now()))) return c.json({ error: 'The game has started: the pick is locked.' }, 409)
  // A game that has left the schedule is over: its pick is part of the record and cannot be erased.
  if (!game && date < etDate(new Date().toISOString())) return c.json({ error: 'That game is over: the pick is locked.' }, 409)
  await c.env.DB.prepare('DELETE FROM gut_pick WHERE source = ? AND date = ? AND home = ? AND away = ?').bind(source, date, home, away).run()
  return c.json({ ok: true })
})

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

// ---------- odds archive ----------

async function archiveSnapshot(env: Bindings, ev: OddsEvent, fetchedAt: number | null): Promise<void> {
  if (!fetchedAt || !ev?.id) return                       // an entry cached by an older version has no known retrieval time: nothing honest to record
  try {
    const capturedAt = new Date(fetchedAt).toISOString()
    const seen = await env.DB.prepare("SELECT 1 AS x FROM odds_runs WHERE source = 'sharpapi' AND event_id = ? AND captured_at = ?").bind(ev.id, capturedAt).first()
    if (seen) return
    const { quotes, skipped } = flatten(ev, 'sharpapi')
    const prior = priorFromRows(ev.id, (await env.DB.prepare(PRIOR_SQL).bind(ev.id, ev.id).all<PriorRow>()).results)
    const plan = planArchive(prior, quotes, capturedAt, { complete: true, skipped })
    const sql = runSql({ source: 'sharpapi', kind: 'board', eventId: ev.id, eventStart: ev.commence_time, capturedAt, status: 'ok', plan })
    for (let i = 0; i < sql.length; i += 50) await env.DB.batch(sql.slice(i, i + 50).map((s) => env.DB.prepare(s)))
  } catch (e) {
    console.error('odds archive failed', e instanceof Error ? e.message : String(e))
  }
}

// Schedule & fatigue FACTS for one game: rest, congestion, estimated travel, and (optionally) workload for some players. Computed from played games in this database and a static
// arena table (shared/schedule.ts); nothing here changes a prediction, and `model` says whether the pre-registered evaluation found any use for these inputs.
app.get('/schedule-context', async (c) => {
  const q = c.req.query()
  if (!/^[A-Z]{2,3}$/.test(q.home ?? '') || !/^[A-Z]{2,3}$/.test(q.away ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '')) return c.json({ error: 'home, away (team codes) and date (YYYY-MM-DD) are required' }, 400)
  const tip = q.tip && Number.isFinite(Date.parse(q.tip)) ? new Date(q.tip).toISOString() : null
  const ids = (q.players ?? '').split(',').filter(Boolean).slice(0, 40).map(Number)
  if (ids.some((n) => !Number.isInteger(n) || n < 1)) return c.json({ error: 'bad player id' }, 400)
  const home = normAbbr(q.home), away = normAbbr(q.away)
  const teamIds = [TEAM_IDS[home], TEAM_IDS[away]]
  const games: PlayedGame[] = []
  if (teamIds.every((t) => typeof t === 'number')) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, date, home_team_id AS h, visitor_team_id AS v FROM games
       WHERE (home_team_id IN (?, ?) OR visitor_team_id IN (?, ?)) AND date < ? AND date >= date(?, '-200 days') AND game_type != 'preseason' ORDER BY date DESC LIMIT 40`,
    ).bind(teamIds[0], teamIds[1], teamIds[0], teamIds[1], q.date, q.date).all<{ id: number; date: string; h: number; v: number }>()
    for (const r of results) { const h = abbrOfTeamId(r.h), v = abbrOfTeamId(r.v); if (h && v) games.push({ id: String(r.id), date: r.date, homeAbbr: h, awayAbbr: v, overtime: null }) }   // overtime cannot be read from partial box scores: unknown
  }
  const target = { id: 'target', date: q.date, tipIso: tip, homeAbbr: home, awayAbbr: away }
  const awayFacts = teamFacts(away, games, target), homeFacts = teamFacts(home, games, target)
  const players: Record<string, WorkloadFacts> = {}
  if (ids.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT pg.player_id AS id, g.date, pg.minutes FROM player_games pg JOIN games g ON g.id = pg.game_id
       WHERE pg.player_id IN (${ids.map(() => '?').join(',')}) AND g.date < ? AND g.date >= date(?, '-120 days') AND g.game_type != 'preseason' AND pg.minutes > 0 ORDER BY g.date DESC`,
    ).bind(...ids, q.date, q.date).all<{ id: number; date: string; minutes: number }>()
    const by = new Map<number, { date: string; minutes: number }[]>()
    for (const r of results) (by.get(r.id) ?? by.set(r.id, []).get(r.id)!).push({ date: r.date, minutes: r.minutes })
    for (const id of ids) players[id] = workloadFacts(by.get(id) ?? [], q.date)
  }
  c.header('Cache-Control', 'private, max-age=300')      // facts change only when a game is played; five minutes is plenty
  return c.json({ data: {
    date: q.date, away: awayFacts, home: homeFacts, matchup: matchupSummary(awayFacts, homeFacts), players,
    model: humanFactorsStatus,
    source: 'played games in this database and a static arena table; travel and hours are estimates',
    newestGameUsed: games[0]?.date ?? null,
  } })
})

// Defensive matchup FACTS for one player against one opponent (research/defense_snapshot.py -> migration 0019 tables). Estimated defenders, team defence and the sample behind each;
// `model` says whether the pre-registered evaluation found any of it useful enough to change a prediction. Nothing here is a probability.
app.get('/defense-context', async (c) => {
  const q = c.req.query()
  const player = parseId(q.player ?? ''), opp = q.opp ?? ''
  if (player === null || !/^[A-Z]{2,3}$/.test(opp)) return c.json({ error: 'player (id) and opp (team code) are required' }, 400)
  const team = normAbbr(opp)
  try {
    const [metrics, matchup, meta] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT metric, value_l10, value_s2d, pct_l10 FROM defense_team WHERE team = ?').bind(team),
      c.env.DB.prepare('SELECT rank, defender_id, defender, weight, dpoe100, foul100, expo, direct_poss, role, conf, herf, direct FROM defense_matchup WHERE player_id = ? AND opp = ? ORDER BY rank').bind(player, team),
      c.env.DB.prepare('SELECT key, value FROM defense_meta'),
    ])
    const m = Object.fromEntries((meta.results as { key: string; value: string }[]).map((r) => [r.key, r.value]))
    if (!metrics.results.length && !matchup.results.length) return c.json({ data: { available: false, model: defenseStatus } })
    c.header('Cache-Control', 'private, max-age=300')
    return c.json({ data: {
      available: true, team: metrics.results, matchup: matchup.results,
      meta: { as_of: m.as_of, matchups_through: m.matchups_through, dpoe_mean: Number(m.dpoe_mean), dpoe_sd: Number(m.dpoe_sd), defenders_rated: Number(m.defenders_rated), games_with_matchups: Number(m.games_with_matchups) },
      model: defenseStatus,
      source: 'NBA.com per-game matchup data (BoxScoreMatchupsV3) and team box scores; assignments are estimated from history, not confirmed',
    } })
  } catch (e) {
    console.error('defense context unavailable', e instanceof Error ? e.message : String(e))
    return c.json({ data: { available: false, model: defenseStatus } })   // tables not migrated yet, or no snapshot: the section simply does not show
  }
})

// The model's chance for each upcoming game (research/game_snapshot.py -> migration 0020), shown next to the market's. `model` says what the view is and how it was validated.
app.get('/game-lean', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT date, home, away, model_home_prob, elo_home, elo_away, home_net10, away_net10, home_off20, home_def20, away_off20, away_def20, as_of, absent_home, absent_away, model_version, model_v1_prob, srs_home, srs_away, pred_margin, co_diff
       FROM game_lean WHERE date >= date('now', '-1 day') ORDER BY date, home`,
    ).all()
    c.header('Cache-Control', 'private, max-age=300')
    return c.json({ data: { rows: results, model: gamesStatus } })
  } catch (e) {
    console.error('game lean unavailable', e instanceof Error ? e.message : String(e))
    return c.json({ data: { rows: [], model: gamesStatus } })   // not migrated or no snapshot yet: the view simply does not show
  }
})

// Is this deployment configured and current? Booleans, counts and ages only: never a secret, never a value from the environment.
app.get('/health', async (c) => {
  const db = c.env.DB
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>().catch(() => ({ results: [] as { name: string }[] }))).results.map((r) => r.name)
  const one = async (sql: string) => (await db.prepare(sql).first<{ v: string | null }>().catch(() => null))?.v ?? null
  const report = evaluateHealth({
    oddsKeySet: !!c.env.SHARPAPI_KEY, captureTokenSet: !!c.env.CAPTURE_TOKEN, tables,
    lastSync: await one("SELECT value AS v FROM meta WHERE key = 'last_sync'"), newestGame: await one('SELECT MAX(date) AS v FROM games'),
    newestProjection: tables.includes('projections') ? await one('SELECT MAX(created_at) AS v FROM projections') : null, now: Date.now(),
  })
  return c.json(report, report.status === 'down' ? 503 : 200)
})

// What the archive holds, and, for one event, each market's first observed price and closing proxy (with the reason when there is none).
app.get('/odds-archive', async (c) => {
  const db = c.env.DB
  const t = await db.prepare(`SELECT (SELECT COUNT(*) FROM odds_runs) AS runs, (SELECT COUNT(*) FROM odds_quotes) AS quotes, (SELECT COUNT(DISTINCT event_id) FROM odds_runs) AS events,
      (SELECT MIN(captured_at) FROM odds_runs) AS first, (SELECT MAX(captured_at) FROM odds_runs) AS last,
      (SELECT COUNT(*) FROM odds_quotes WHERE freshness = 'stale') AS stale, (SELECT COUNT(*) FROM odds_quotes WHERE market_status = 'unavailable') AS unavailable`).first()
  const byKind = (await db.prepare('SELECT kind, status, COUNT(*) AS runs FROM odds_runs GROUP BY kind, status ORDER BY kind, status').all()).results
  const eventId = c.req.query('event')
  if (eventId === undefined) return c.json({ data: { ...t, byKind } })
  if (!/^[\w-]{1,64}$/.test(eventId)) return c.json({ error: 'bad event' }, 400)
  const rows = (await db.prepare(
    `SELECT player_name AS playerName, stat, line, side, book, source, captured_at AS capturedAt, price, market_status AS marketStatus, freshness, timestamp_source AS timestampSource, event_start AS eventStart
     FROM odds_quotes WHERE event_id = ? ORDER BY captured_at LIMIT 20000`,
  ).bind(eventId).all<{ playerName: string; stat: string; line: number; side: string; book: string; source: string; capturedAt: string; price: number | null; marketStatus: 'open' | 'unavailable'; freshness: 'fresh' | 'stale' | 'unknown'; timestampSource: string | null; eventStart: string | null }>()).results
  const start = (await db.prepare('SELECT event_start AS s FROM odds_runs WHERE event_id = ? AND event_start IS NOT NULL LIMIT 1').bind(eventId).first<{ s: string }>())?.s ?? null
  const byMarket = new Map<string, typeof rows>()
  for (const r of rows) (byMarket.get(`${r.playerName}|${r.stat}|${r.line}|${r.side}|${r.book}|${r.source}`) ?? byMarket.set(`${r.playerName}|${r.stat}|${r.line}|${r.side}|${r.book}|${r.source}`, []).get(`${r.playerName}|${r.stat}|${r.line}|${r.side}|${r.book}|${r.source}`)!).push(r)
  const markets = [...byMarket].slice(0, 500).map(([k, h]) => {
    const [playerName, stat, line, side, book, source] = k.split('|')
    const first = firstObserved(h)
    return { playerName, stat, line: Number(line), side, book, source, observations: h.length, firstObserved: first ? { price: first.price, at: first.capturedAt } : null,
      closing: start ? closingProxy(h, start) : { ok: false, reason: 'NO_EVENT_START' } }
  })
  return c.json({ data: { ...t, byKind, event: eventId, eventStart: start, markets } })
})

// Our own lines: a line and fair prices for every player we project, from the model alone. No provider, no sportsbook. Fair prices carry no margin,
// so they are what the model thinks a bet is worth, not something a book will pay. ?player=name, ?stat=pts|reb|ast|fg3m|pra, ?date=YYYY-MM-DD narrow it.
app.get('/lines', async (c) => {
  const q = c.req.query()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? '') ? q.date : null
  const stat = ['pts', 'reb', 'ast', 'fg3m', 'pra'].includes(q.stat ?? '') ? q.stat! : null
  const term = (q.player ?? '').trim().slice(0, 40)
  const today = etDate(new Date().toISOString())
  // With nothing projected for today or later (the box-score sync has not run lately) show the newest projected day, and say so.
  const newest = (await c.env.DB.prepare('SELECT MAX(game_date) AS d FROM projections').first<{ d: string | null }>().catch(() => null))?.d ?? null
  const from = date ?? (newest && newest < today ? newest : today)
  const { results } = await c.env.DB.prepare(
    `SELECT pr.player_id AS id, p.name, p.team, pr.game_date AS gameDate, pr.stat, pr.mean, pr.alpha, pr.model, pr.created_at AS createdAt
     FROM projections pr JOIN players p ON p.id = pr.player_id
     WHERE ${date ? 'pr.game_date = ?' : 'pr.game_date >= ?'} AND pr.mean > 0${stat ? ' AND pr.stat = ?' : ''}${term ? " AND p.name LIKE ? ESCAPE '\\'" : ''}
     ORDER BY pr.game_date, p.name, pr.stat LIMIT 3000`,
  ).bind(...[from, ...(stat ? [stat] : []), ...(term ? [`%${escapeLike(term)}%`] : [])]).all<{ id: number; name: string; team: string | null; gameDate: string; stat: string; mean: number; alpha: number; model: string; createdAt: string }>()
  const players = new Map<string, { id: number; name: string; team: string | null; gameDate: string; model: string; asOf: string; lines: NonNullable<ReturnType<typeof ownLine>>[] }>()
  for (const r of results) {
    const l = ownLine({ stat: r.stat, mean: r.mean, alpha: r.alpha })
    if (!l) continue
    const k = `${r.id}|${r.gameDate}`
    const e = players.get(k) ?? players.set(k, { id: r.id, name: r.name, team: r.team, gameDate: r.gameDate, model: r.model, asOf: r.createdAt, lines: [] }).get(k)!
    e.lines.push(l)
  }
  return c.json({ data: [...players.values()], meta: { note: 'Fair prices from our own model: no sportsbook margin, not an offer anyone will take.', stale: !date && from < today, projectedThrough: newest } })
})

// ---------- picks (SharpAPI odds + model) ----------

async function loadPicks(env: Bindings, fresh = false): Promise<{ configured: boolean; picks: Pick[]; meta: PicksMeta }> {
  const now = Date.now()
  const meta: PicksMeta = { generatedAt: new Date(now).toISOString(), oddsAsOf: null, warnings: [] }
  if (!env.SHARPAPI_KEY) return { configured: false, picks: [], meta }

  // Odds are optional: if the provider is rate limited or down, the rest of the app (scores, standings, injuries, stats) still works.
  const fetched: Cached<OddsEvent>[] = []
  let failed = 0, notSynced = 0
  try {
    const games = await loadSharpGames(env, fresh)
    const upcoming = games
      .filter((e) => Date.parse(e.commence_time) < now + Number(env.ODDS_HOURS ?? 40) * 3600_000 && Date.parse(e.commence_time) > now)
      .slice(0, Math.max(1, Math.min(15, Number(env.ODDS_MAX_EVENTS) || DEFAULT_MAX_EVENTS)))
    // One game at a time: the provider limits requests a minute, and a game that fails must not hide the others.
    // At the first rate-limit answer the rest are skipped, not tried: each try would be refused too. Games already cached are still served, so a refresh a minute later fills in more.
    let limited = false
    for (const g of upcoming) {
      if (limited) { failed++; continue }
      try { const got = await loadEventProps(env, g, fresh); if (got) fetched.push(got); else notSynced++ } catch (e) {
        failed++
        limited = e instanceof UpstreamError && e.message.includes('rate limit')
        console.error('props unavailable', e instanceof Error ? e.message : String(e))
      }
    }
    if (upcoming.length && !fetched.length && failed) throw new UpstreamError('no game could be loaded')
  } catch (e) {
    console.error('odds unavailable', e instanceof Error ? e.message : String(e))
    meta.warnings.push({ code: 'odds_unavailable', message: 'Sportsbook lines are unavailable right now (provider error or rate limit). Scores, standings, injuries and player stats still work; props return when odds do.' })
    return { configured: true, picks: [], meta }
  }
  if (notSynced) meta.warnings.push({ code: 'odds_not_synced', message: `${notSynced} game${notSynced === 1 ? ' has' : 's have'} no stored player props yet. The odds sync adds more games each run (node scripts/sync_odds.mjs).` })
  if (failed) meta.warnings.push({ code: 'odds_partial', message: `${failed} game${failed === 1 ? '' : 's'} could not be loaded (the provider's request limit, most likely), so ${failed === 1 ? 'its' : 'their'} props are missing. Refresh in a minute.` })

  // Point-in-time archive: each retrieved snapshot is recorded once (the run row makes a repeat a no-op), best effort, never allowed to break the page.
  await Promise.all(fetched.map((f) => archiveSnapshot(env, f.data, f.fetchedAt)))

  // How old is what we are about to show? Lines move before tip-off, so the age is part of the answer.
  const age = assessOddsAge(fetched.map((f) => f.fetchedAt), now)
  meta.oddsAsOf = age.oddsAsOf
  meta.warnings.push(...age.warnings)
  if (age.blocked) return { configured: true, picks: [], meta }

  // Each event carries the time its odds were retrieved, so quote freshness is judged at that moment and every screen sees the same snapshot.
  const odds = fetched.map((f) => ({ ...f.data, fetchedAt: f.fetchedAt }))
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

  // selection 'all': every side of every line the books posted. Nothing is dropped here; the response is limited per game in shared/boardPayload.ts.
  const built = buildPicks({ events: odds, players, history, projections, now, selection: 'all', fallback: env.FALLBACK_MODEL === 'v3' ? 'v3' : 'v2' })
  const d = built.diagnostics

  // Role (minutes over the last 10 games) and availability; history is newest first.
  const injuries = await loadInjuries(env, fresh)
  const annotated = enrichPicks(built.picks, history, injuries)

  // The one authoritative calculation (shared/engine/authority.ts): the same records Minds uses. The opponent table feeds the matchup review.
  const oppRows = await cachedJson<AllowedRow[]>('opp-table', 30 * 60, async () => (await env.DB.prepare(OPP_ALLOWED_SQL).all<AllowedRow>()).results, fresh).catch(() => [] as AllowedRow[])
  const picks = applyAuthority(attachOpponent(annotated.picks, buildOppTable(oppRows)), { now, config: DEFAULT_ENGINE_CONFIG, calibration: CALIBRATION, injuryChecked: injuries !== null })

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
  const eventId = c.req.query('event')
  if (eventId !== undefined && !/^[\w-]{1,64}$/.test(eventId)) return c.json({ error: 'bad event' }, 400)
  const out = boardPayload(picks, { event: eventId ?? null })
  return c.json({ configured, data: out.picks, meta: { ...meta, coverage: out.coverage } })
})

/**
 * Freeze the picks as they were shown, for forward evaluation (INSERT OR IGNORE keeps the first price and model).
 * Throttled so repeated page loads cannot turn into a stream of database writes.
 */
async function logPicks(env: Bindings, picks: Pick[]) {
  const worth = picks.filter((p) => p.ev > 0).sort((a, b) => b.ev - a.ev).slice(0, 40)
  if (!worth.length) return
  const last = await env.DB.prepare("SELECT value FROM meta WHERE key = 'last_pick_log'").first<{ value: string }>().catch(() => null)
  if (last && Date.now() - Number(last.value) < 10 * 60_000) return
  await env.DB.batch([
    ...worth.map((p) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO predictions (player_id,stat,line,predicted,p_over,model,game_date,side,price,book,model_prob,market_prob,push,basis,ev)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        p.playerId, p.stat, p.line, p.projection, p.side === 'over' ? p.prob : 1 - p.prob,
        p.model, p.gameDate, p.side, p.price, p.book, p.modelProb, p.marketProb, p.push, p.basis ?? 'legacy', p.ev,
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
  const gamePicks = picks.filter((p) => sameMatchup(p.game, game.away.name, game.home.name)).map(slim)
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

// The measured record of the suggested props: ROI and hit rate with intervals, calibration, and the model scored against the market on the same bets.
app.get('/results/report', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT stat, side, price, hit, p_over AS pOver, model_prob AS modelProb, market_prob AS marketProb, basis
     FROM predictions WHERE hit IN (0, 1, 2) AND price > 1 AND side IS NOT NULL ORDER BY game_date DESC LIMIT 20000`,
  ).all<{ stat: string; side: 'over' | 'under'; price: number; hit: 0 | 1 | 2; pOver: number; modelProb: number | null; marketProb: number | null; basis: string }>()
  const rows: GradedPrediction[] = results.map((r) => ({
    stat: r.stat, side: r.side, price: r.price, hit: r.hit, prob: r.side === 'over' ? r.pOver : 1 - r.pOver,
    modelProb: r.modelProb, marketProb: r.marketProb, basis: r.basis ?? 'legacy',
  }))
  return c.json({ data: trackRecord(rows) })
})

// Cheat sheet data: every player with a projection for a game today or later, with their last 10 played games. The streak logic itself runs in
// the browser (src/lib/cheatSheet.ts). Players listed Out are left out. Games are real games only: preseason and zero-minute rows are skipped.
async function buildCheatsheet(env: Bindings) {
  const today = etDate(new Date().toISOString())
  const upcoming = (await env.DB.prepare(
    `SELECT pr.player_id AS id, MIN(pr.game_date) AS gameDate, p.name, p.team FROM projections pr JOIN players p ON p.id = pr.player_id
     WHERE pr.game_date >= ? GROUP BY pr.player_id ORDER BY p.name`,
  ).bind(today).all<{ id: number; gameDate: string; name: string; team: string | null }>()).results
  const injuries = (await loadInjuries(env)) ?? new Map<string, Injury>()
  const people = upcoming.filter((p) => injuries.get(normName(p.name))?.status !== 'out')
  const byId = new Map<number, { date: string; minutes: number; pts: number; reb: number; ast: number; fg3m: number }[]>()
  for (const ids of chunk(people.map((p) => p.id), MAX_PLAYERS_PER_QUERY)) {
    const { results } = await env.DB.prepare(
      `SELECT pg.player_id AS id, g.date, pg.minutes, pg.pts, pg.reb, pg.ast, pg.fg3m
       FROM player_games pg JOIN games g ON g.id = pg.game_id
       WHERE pg.player_id IN (${ids.map(() => '?').join(',')}) AND g.game_type != 'preseason' AND pg.minutes > 0 AND g.date >= date('now', '-400 days')
       ORDER BY g.date DESC`,
    ).bind(...ids).all<{ id: number; date: string; minutes: number; pts: number; reb: number; ast: number; fg3m: number }>()
    for (const r of results) {
      const list = byId.get(r.id) ?? []
      if (list.length < 10) { list.push({ date: r.date, minutes: r.minutes, pts: r.pts, reb: r.reb, ast: r.ast, fg3m: r.fg3m }); byId.set(r.id, list) }
    }
  }
  return people.filter((p) => byId.has(p.id)).map((p) => ({ ...p, injury: injuries.get(normName(p.name)) ?? null, games: byId.get(p.id)! }))
}

// The query reads up to 400 days of games for every player with a game coming up, so the result is cached for 10 minutes (and per ET date).
app.get('/cheatsheet', async (c) => {
  const day = etDate(new Date().toISOString())
  const hit = await cachedMeta(`cheatsheet-${day}`, 10 * 60, () => buildCheatsheet(c.env), wantsFresh(c))
  return c.json({ data: hit.data, cachedAt: hit.fetchedAt ? new Date(hit.fetchedAt).toISOString() : null })
})

// Who is on the injury report (Out, Doubtful, Questionable, Day-To-Day), matched to our roster, plus listed players the roster lacks. Cached with the injury feed (15 minutes).
app.get('/absences', async (c) => {
  const injuries = await loadInjuries(c.env)
  if (!injuries) return c.json({ error: 'The injury report is unavailable right now.' }, 502)
  const { results } = await c.env.DB.prepare('SELECT id, name, team FROM players').all<{ id: number; name: string; team: string | null }>()
  return c.json({ data: listAbsences(results, injuries, (name) => teamByName(name)?.[0] ?? null) })
})

/** A compact view of one team's lineup for the Teams page: who is flagged, whether they start, and where the list came from. */
function lineupSummary(t: { starters: LineupPlayer[]; nextUp: LineupPlayer[]; alsoListed: { name: string; listing: Listing; lastPlayed?: string | null }[]; source: string; asOf: string | null }) {
  const flagged = [
    ...t.starters.filter((p) => p.listing).map((p) => ({ name: p.name, role: 'starter' as const, status: p.listing!.status, reason: p.listing!.reason, note: p.listing!.note ?? null, lastPlayed: p.lastPlayed, missed: p.missed })),
    ...t.nextUp.filter((p) => p.listing).map((p) => ({ name: p.name, role: 'bench' as const, status: p.listing!.status, reason: p.listing!.reason, note: p.listing!.note ?? null, lastPlayed: p.lastPlayed, missed: p.missed })),
    ...t.alsoListed.slice(0, 6).map((a) => ({ name: a.name, role: 'listed' as const, status: a.listing.status, reason: a.listing.reason, note: a.listing.note ?? null, lastPlayed: a.lastPlayed ?? null, missed: null as number | null })),
  ]
  return { source: t.source, asOf: t.asOf, starters: t.starters.map((p) => p.name), flagged }
}

// Lineups: for each game not yet finished, the five projected starters per team (most minutes per game over the team's last 10 games) with their listed status, the next three
// men up and everyone else on the report. Statuses come from the NBA's official injury report (stored by research/nba_injury_pdf.py) for a team that has filed, ESPN's list for the rest.
// Starters are projected, never confirmed: nothing here knows the real lineup.
async function lineupRows(env: Bindings, games: any[]) {
  const today = etDate(new Date().toISOString())
  const upcoming = (games as any[]).filter((g) => g.state !== 'post' && etDate(g.date) >= today).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const teamIds = [...new Set(upcoming.flatMap((g) => [TEAM_IDS[normAbbr(g.home.abbr)], TEAM_IDS[normAbbr(g.away.abbr)]]).filter((x): x is number => typeof x === 'number'))]
  const minutes = new Map<number, Candidate[]>()
  if (teamIds.length) {
    const ph = teamIds.map(() => '?').join(',')
    const { results } = await env.DB.prepare(
      `WITH tg AS (
         SELECT pg.team_id AS team_id, pg.game_id AS gid, g.date AS gdate, ROW_NUMBER() OVER (PARTITION BY pg.team_id ORDER BY g.date DESC, g.id DESC) AS rn
         FROM (SELECT DISTINCT team_id, game_id FROM player_games WHERE team_id IN (${ph})) pg JOIN games g ON g.id = pg.game_id
         WHERE g.game_type = 'regular' AND g.date >= date('now', '-120 days'))
       SELECT x.*, (SELECT COUNT(*) FROM tg t3 WHERE t3.team_id = x.team AND t3.rn <= 10 AND t3.gdate > x.last) AS missed FROM (
         SELECT pg.team_id AS team, pg.player_id AS id, p.name AS name, SUM(pg.minutes) AS total, MAX(tg.gdate) AS last,
                (SELECT MAX(rn) FROM tg t2 WHERE t2.team_id = pg.team_id AND t2.rn <= 10) AS n
         FROM player_games pg JOIN tg ON tg.gid = pg.game_id AND tg.team_id = pg.team_id AND tg.rn <= 10 JOIN players p ON p.id = pg.player_id
         WHERE pg.minutes > 0 GROUP BY pg.team_id, pg.player_id) x`,
    ).bind(...teamIds).all<{ team: number; id: number; name: string; total: number; n: number; last: string; missed: number }>().catch(() => ({ results: [] as { team: number; id: number; name: string; total: number; n: number; last: string; missed: number }[] }))
    for (const r of results) (minutes.get(r.team) ?? minutes.set(r.team, []).get(r.team)!).push({ id: r.id, name: r.name, avgMin: r.total / Math.max(1, r.n), lastPlayed: r.last, missed: r.missed })
  }
  // The league's newest stored report, if it is recent enough to mean anything for tonight.
  const latest = await env.DB.prepare('SELECT MAX(report_time) AS t FROM nba_injury_report').first<{ t: string | null }>().catch(() => null)
  const age = reportAgeHours(latest?.t, Date.now())
  const officialRows = latest?.t && age != null && age <= MAX_REPORT_AGE_HOURS
    ? (await env.DB.prepare('SELECT team, player, status, reason, game_date FROM nba_injury_report WHERE report_time = ?').bind(latest.t).all<OfficialRow>().then((r) => r.results).catch(() => [] as OfficialRow[]))
    : []
  const espn = (await loadInjuries(env)) ?? new Map<string, Injury>()
  const teamLineup = (abbr: string, date: string) => {
    const code = normAbbr(abbr)
    const id = TEAM_IDS[code]
    return buildLineup(id ? minutes.get(id) ?? [] : [], officialListings(officialRows, code, date), espnListings(espn, (i) => (i.team ? normAbbr(teamByName(i.team)?.[0] ?? '') === code : false)), latest?.t ?? null)
  }
  const rows = upcoming.map((g) => {
    const date = etDate(g.date)
    return { id: g.id as string, date: g.date as string, state: g.state as string, status: g.status as string,
      home: { abbr: g.home.abbr as string, name: g.home.name as string, ...teamLineup(g.home.abbr, date) }, away: { abbr: g.away.abbr as string, name: g.away.name as string, ...teamLineup(g.away.abbr, date) } }
  })
  // Listed players who are not in a team's last 10 box scores (out for weeks): when did each last play? One lookup by name for all of them.
  const listedNames = [...new Set(rows.flatMap((r) => [...r.home.alsoListed, ...r.away.alsoListed].map((a) => a.name)))].slice(0, 150)
  if (listedNames.length) {
    const ph = listedNames.map(() => '?').join(',')
    const { results } = await env.DB.prepare(
      `SELECT p.name AS name, MAX(g.date) AS last FROM players p JOIN player_games pg ON pg.player_id = p.id JOIN games g ON g.id = pg.game_id
       WHERE p.name IN (${ph}) AND pg.minutes > 0 AND g.game_type = 'regular' GROUP BY p.id`,
    ).bind(...listedNames).all<{ name: string; last: string }>().catch(() => ({ results: [] as { name: string; last: string }[] }))
    const lastBy = new Map(results.map((r) => [nameKey(r.name), r.last]))
    for (const r of rows) for (const side of [r.home, r.away]) for (const a of side.alsoListed) a.lastPlayed = lastBy.get(nameKey(a.name)) ?? null
  }
  return { rows, officialReportAt: officialRows.length ? latest!.t : null, espnAvailable: espn.size > 0 }
}

app.get('/lineups', async (c) => {
  const games = await loadGames(c.env, wantsFresh(c)).catch(() => null)
  if (!games) return c.json({ error: 'The schedule is unavailable right now.' }, 502)
  const r = await lineupRows(c.env, games as any[])
  return c.json({ data: { games: r.rows }, meta: { officialReportAt: r.officialReportAt, espnAvailable: r.espnAvailable,
    note: 'Starters are projected from minutes over the last 10 games, not confirmed: real lineups are posted about 30 minutes before tip. A status is what the injury report lists, not a chance of playing.' } })
})

// Live or final box score for one game (ESPN summary). Short cache so live games stay current without hammering the feed.
app.get('/live/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^\d{5,12}$/.test(id)) return c.json({ error: 'bad game id' }, 400)
  try {
    const feed = await cachedJson<unknown>(`espn-box-${id}`, 20, async () => {
      const res = await fetch(`${c.env.ESPN_BASE_URL ?? 'https://site.api.espn.com'}/apis/site/v2/sports/basketball/nba/summary?event=${id}`)
      if (!res.ok) throw new UpstreamError(`ESPN summary ${res.status}`)
      return res.json()
    })
    const box = parseLiveBox(feed)
    return box ? c.json({ data: box }) : c.json({ error: 'No box score for this game yet.' }, 404)
  } catch (e) {
    console.error('box score unavailable', e instanceof Error ? e.message : String(e))
    return c.json({ error: 'The live box score is unavailable right now.' }, 502)
  }
})

// League standings from ESPN's public feed, parsed by shared/standings.ts. Cached for 5 minutes (they only change when a game ends).
app.get('/standings', async (c) => {
  try {
    const feed = await cachedJson<unknown>('espn-standings', 5 * 60, async () => {
      const res = await fetch(`${c.env.ESPN_BASE_URL ?? 'https://site.api.espn.com'}/apis/v2/sports/basketball/nba/standings`)
      if (!res.ok) throw new UpstreamError(`ESPN standings ${res.status}`)
      return res.json()
    })
    return c.json({ data: parseStandings(feed) })
  } catch (e) {
    console.error('standings unavailable', e instanceof Error ? e.message : String(e))
    return c.json({ error: 'Standings are unavailable right now.' }, 502)
  }
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
