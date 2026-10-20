// Pure construction of suggested bets from raw odds, history and projections.
// No database, no network, no clock: everything arrives as an argument, so every number a user sees can be
// reproduced in a test. The Worker (functions/api) does the I/O and calls buildPicks().
import {
  BIG_GAP, blendProb, expectedValue, hitRate, outcomeProbs, predict, predictV3, riskTier,
  type GameType, type Risk, type Stat,
} from './baseline.ts'

// ---------- raw inputs, shaped like The Odds API / the database ----------

export interface OddsOutcome { name: string; description?: string; price: number; point?: number }
export interface OddsMarket { key: string; outcomes: OddsOutcome[] }
export interface OddsBook { key: string; title: string; markets: OddsMarket[] }
export interface OddsEvent { id: string; commence_time: string; home_team: string; away_team: string; bookmakers?: OddsBook[] }
export interface PlayerRow { id: number; name: string; team: string | null }
/** One past game for one player. Rows for a player must be newest first. */
export interface HistoryRow { player_id: number; type: GameType; pts: number; reb: number; ast: number; fg3m: number }
export interface ProjectionRow {
  player_id: number; game_date: string; stat: string; mean: number; alpha: number; model: string
  /** UTC timestamp as SQLite writes it: 'YYYY-MM-DD HH:MM:SS'. */
  created_at?: string | null
}

export const MARKET_STAT: Record<string, Stat> = {
  player_points: 'pts',
  player_rebounds: 'reb',
  player_assists: 'ast',
  player_threes: 'fg3m',
}

export const TEAM_NAMES: Record<string, string> = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons',
  GSW: 'Golden State Warriors', HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers',
  LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies', MIA: 'Miami Heat', MIL: 'Milwaukee Bucks',
  MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks', OKC: 'Oklahoma City Thunder',
  ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards',
}

/** How old a stored projection may be before it is ignored (injuries and minutes change within a day or two). */
export const MAX_PROJECTION_AGE_HOURS = 36

export const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Eastern-time calendar date of an instant, e.g. '2026-10-21'. */
export const etDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

// Roughly mid-April to June is playoff time.
export function isPlayoffDate(etDay: string) {
  const [, m, d] = etDay.split('-').map(Number)
  return (m === 4 && d >= 16) || m === 5 || m === 6
}

/** Remove the bookmaker's margin from a two-way market by scaling the implied probabilities (proportional method). */
export function devigPair(over: number, under: number): number {
  return 1 / over / (1 / over + 1 / under)
}

// ---------- output ----------

export interface Pick {
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
  /** The model's chance of winning, given the bet is not refunded. */
  modelProb: number
  /** The market's chance of winning with the margin removed, averaged over books; null if no book quotes both sides. */
  marketProb: number | null
  /** Model blended with the market (still given no refund). This is the number the app trusts. */
  prob: number
  /** Chance the stat lands exactly on a whole-number line, in which case the stake is refunded. 0 on half-point lines. */
  push: number
  /** 1 / price: what the best price implies, margin included. */
  impliedProb: number
  /** Expected profit per 1 staked. */
  ev: number
  risk: Risk
  /** Which model produced the projection: the boosted model ('gbm-v1') or the fallback ('baseline-v2'). */
  model: string
  /** True when model and market disagree wildly, which usually means the model is missing news. */
  bigGap: boolean
  projection: number
  /** Share of the last 10 played games that landed on this side (ties excluded). */
  hitRate10: number | null
  recent: number[]
  /** Games of history behind the baseline estimate. */
  sample: number
  /** Hours since the stored projection was made, when one was used. */
  projectionAgeHours: number | null
  game: string
  gameDate: string
}

export interface Warning { code: string; message: string }
export interface PicksMeta {
  generatedAt: string
  /** Time of the OLDEST odds snapshot behind the picks; null if unknown. */
  oddsAsOf: string | null
  warnings: Warning[]
}

/** Odds older than this are not shown at all: it is just beyond the cache lifetime, so it only fires if caching has failed. */
export const MAX_ODDS_AGE_HOURS = 9
/** Odds older than this are shown with a warning. */
export const WARN_ODDS_AGE_HOURS = 4

/**
 * Decide what the age of the odds means. `fetchedAt` holds one entry per game (ms since the epoch, or null if the
 * entry was cached by an older version and its age is unknown). Pure, so the fail-closed rule can be tested.
 */
export function assessOddsAge(fetchedAt: (number | null)[], now: number): { oddsAsOf: string | null; warnings: Warning[]; blocked: boolean } {
  const warnings: Warning[] = []
  const known = fetchedAt.filter((t): t is number => t !== null && Number.isFinite(t))
  const oddsAsOf = known.length ? new Date(Math.min(...known)).toISOString() : null
  if (fetchedAt.length && known.length < fetchedAt.length)
    warnings.push({ code: 'odds_age_unknown', message: 'Some odds were cached by an older version, so their age is unknown.' })
  const oldest = known.length ? (now - Math.min(...known)) / 3600_000 : 0
  if (oldest > MAX_ODDS_AGE_HOURS) {
    warnings.push({ code: 'odds_too_old', message: `Odds are ${oldest.toFixed(0)} hours old, which is past the limit, so no picks are shown.` })
    return { oddsAsOf, warnings, blocked: true }
  }
  if (oldest > WARN_ODDS_AGE_HOURS)
    warnings.push({ code: 'odds_old', message: `Odds were fetched ${oldest.toFixed(0)} hours ago. Lines move before tip-off, so check the book's current price.` })
  return { oddsAsOf, warnings, blocked: false }
}

export interface Diagnostics {
  /** Names in the odds that match no synced player (so no pick is possible). */
  unmatchedPlayers: string[]
  /** Matched players with too little history for any estimate. */
  insufficientHistory: string[]
  /** Players whose stored projection was older than the limit, so the simpler model was used instead. */
  staleProjectionPlayers: string[]
  projectionLines: number
  fallbackLines: number
  invalidQuotes: number
}

export interface BuildInput {
  events: OddsEvent[]
  players: PlayerRow[]
  history: HistoryRow[]
  projections: ProjectionRow[]
  /** Current time in ms since the epoch (passed in so results are reproducible). */
  now: number
  maxProjectionAgeHours?: number
  /** 'best' (default) keeps each player's best-value and safest side; 'all' returns every side (for tests and diagnostics). */
  selection?: 'best' | 'all'
  /** Which baseline supplies the fallback probabilities when no fresh projection exists. 'v2' (default) or the opt-in 'v3'. */
  fallback?: 'v2' | 'v3'
}

type Quote = { book: string; price: number }
type Line = { pl: PlayerRow; stat: Stat; point: number; over: Quote[]; under: Quote[] }

const validQuote = (o: OddsOutcome) =>
  (o.name === 'Over' || o.name === 'Under') && typeof o.description === 'string' &&
  Number.isFinite(o.price) && o.price > 1 && Number.isFinite(o.point)

export function buildPicks(input: BuildInput): { picks: Pick[]; diagnostics: Diagnostics } {
  const { events, players, history, projections, now } = input
  const maxAgeMs = (input.maxProjectionAgeHours ?? MAX_PROJECTION_AGE_HOURS) * 3600_000
  const byName = new Map(players.map((p) => [normName(p.name), p]))
  const rowsByPlayer = new Map<number, HistoryRow[]>()
  for (const r of history) (rowsByPlayer.get(r.player_id) ?? rowsByPlayer.set(r.player_id, []).get(r.player_id)!).push(r)
  const proj = new Map(projections.map((r) => [`${r.player_id}|${r.game_date}|${r.stat}`, r]))

  const unmatched = new Set<string>()
  const noHistory = new Set<string>()
  const staleProj = new Set<string>()
  let projectionLines = 0, fallbackLines = 0, invalidQuotes = 0
  const picks: Pick[] = []
  const diag = (): Diagnostics => ({
    unmatchedPlayers: [...unmatched].sort(), insufficientHistory: [...noHistory].sort(), staleProjectionPlayers: [...staleProj].sort(),
    projectionLines, fallbackLines, invalidQuotes,
  })

  for (const ev of events) {
    const game = `${ev.away_team} @ ${ev.home_team}`
    const gameDate = etDate(ev.commence_time)
    const upcomingType: GameType = isPlayoffDate(gameDate) ? 'playoffs' : 'regular'

    // Group every book's Over/Under for the same player, stat and line.
    const lines = new Map<string, Line>()
    for (const b of ev.bookmakers ?? [])
      for (const m of b.markets) {
        const stat = MARKET_STAT[m.key]
        if (!stat) continue
        for (const out of m.outcomes) {
          if (!validQuote(out)) { invalidQuotes++; continue }
          const pl = byName.get(normName(out.description!))
          if (!pl) { unmatched.add(out.description!); continue }
          if (!rowsByPlayer.has(pl.id)) { noHistory.add(pl.name); continue }
          const k = `${pl.id}|${stat}|${out.point}`
          const L = lines.get(k) ?? lines.set(k, { pl, stat, point: out.point!, over: [], under: [] }).get(k)!
          ;(out.name === 'Over' ? L.over : L.under).push({ book: b.title, price: out.price })
        }
      }

    for (const L of lines.values()) {
      const rows = rowsByPlayer.get(L.pl.id)!
      const samples = rows.map((r) => ({ value: r[L.stat as 'pts' | 'reb' | 'ast' | 'fg3m'] as number, type: r.type }))
      const base = input.fallback === 'v3' ? predictV3(L.stat, samples, L.point, upcomingType) : predict(samples, L.point, upcomingType)
      if (!base) { noHistory.add(L.pl.name); continue }

      // Prefer the boosted model's mean with a negative-binomial tail, but only while it is fresh.
      const pr = proj.get(`${L.pl.id}|${gameDate}|${L.stat}`)
      let outcome = { over: base.pOver, under: base.pUnder, push: base.pPush }
      let projected = base.predicted
      let modelName: string = base.model
      let ageHours: number | null = null
      if (pr) {
        const made = pr.created_at ? Date.parse(`${pr.created_at.replace(' ', 'T')}Z`) : NaN
        const fresh = Number.isFinite(made) && now - made <= maxAgeMs && now - made >= -3600_000
        const nb = fresh ? outcomeProbs(L.point, { kind: 'nb', mu: pr.mean, alpha: pr.alpha }) : null
        if (nb) {
          outcome = nb
          projected = pr.mean
          modelName = pr.model
          ageHours = (now - made) / 3600_000
          projectionLines++
        } else {
          staleProj.add(L.pl.name)
          fallbackLines++
        }
      } else {
        fallbackLines++
      }

      const played = samples.filter((s) => s.type !== 'preseason').map((s) => s.value)

      // Market view with the margin removed, averaged over books that quote both sides.
      // It is the chance of OVER given no refund, because a book that refunds ties prices only the decided outcomes.
      const perBook = new Map<string, { o?: number; u?: number }>()
      for (const x of L.over) perBook.set(x.book, { ...perBook.get(x.book), o: Math.max(x.price, perBook.get(x.book)?.o ?? 0) })
      for (const x of L.under) perBook.set(x.book, { ...perBook.get(x.book), u: Math.max(x.price, perBook.get(x.book)?.u ?? 0) })
      const both = [...perBook.values()].filter((v) => v.o && v.u)
      const marketOver = both.length ? both.reduce((a, v) => a + devigPair(v.o!, v.u!), 0) / both.length : null

      for (const side of ['over', 'under'] as const) {
        const quotes = side === 'over' ? L.over : L.under
        if (!quotes.length) continue
        const best = new Map<string, number>()
        for (const q of quotes) best.set(q.book, Math.max(q.price, best.get(q.book) ?? 0))
        const sorted = [...best].map(([book, price]) => ({ book, price })).sort((a, b) => b.price - a.price)
        const top = sorted[0]

        const win = side === 'over' ? outcome.over : outcome.under
        const lose = side === 'over' ? outcome.under : outcome.over
        if (win + lose <= 0) continue // the line is certain to tie: nothing to bet
        const modelProb = win / (win + lose)
        const marketProb = marketOver == null ? null : side === 'over' ? marketOver : 1 - marketOver
        const prob = blendProb(modelProb, marketProb)
        const rate = hitRate(played, L.point, 10, side)
        picks.push({
          playerId: L.pl.id, player: L.pl.name, team: L.pl.team, teamName: L.pl.team ? TEAM_NAMES[L.pl.team] ?? null : null,
          stat: L.stat, side, line: L.point, price: top.price, book: top.book, prices: sorted.slice(0, 5),
          modelProb, marketProb, prob, push: outcome.push, impliedProb: 1 / top.price,
          ev: expectedValue(prob, outcome.push, top.price), risk: riskTier(prob), model: modelName,
          bigGap: marketProb != null && Math.abs(modelProb - marketProb) > BIG_GAP,
          projection: projected, hitRate10: rate, recent: played.slice(0, 10).reverse(), sample: base.sample,
          projectionAgeHours: ageHours, game, gameDate,
        })
      }
    }
  }

  if (input.selection === 'all') {
    return { picks: picks.sort((a, b) => b.ev - a.ev), diagnostics: diag() }
  }

  // Keep each player's best-value side and their safest side; the UI slices these into tabs.
  const groups = new Map<string, Pick[]>()
  for (const p of picks) {
    const k = `${p.playerId}|${p.stat}`
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  const keep = new Map<string, Pick>()
  for (const group of groups.values()) {
    const value = group.reduce((a, b) => (b.ev > a.ev ? b : a))
    const safe = group.reduce((a, b) => (b.prob > a.prob ? b : a))
    for (const p of [value, safe]) keep.set(`${p.playerId}|${p.stat}|${p.side}|${p.line}`, p)
  }
  return { picks: [...keep.values()].sort((a, b) => b.ev - a.ev).slice(0, 80), diagnostics: diag() }
}

