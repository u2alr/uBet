import { useEffect, useMemo, useState } from 'react'
import type { PicksMeta } from '../../shared/picks.ts'
import type { Conference, StandingRow } from '../../shared/standings.ts'
import { api } from '../lib/format'
import type { Pick } from '../lib/picks'
import { SORTS, favorite, normAbbr, opponentOf, sortCards, toCards, type Card, type SortKey } from '../lib/propsBoard'
import { teamByName } from '../lib/teams'
import type { H2H, H2HState } from '../lib/h2hView'
import MetricGuide from './MetricGuide'
import Notices from './Notices'
import PropList from './PropList'
import PropTile from './PropTile'
import TeamLogo from './TeamLogo'

// The Props board: one card per player, stat and line, grouped by game in tip-off order. Filters live in one sticky toolbar.
const STATS = [['all', 'All'], ['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['fg3m', 'Threes'], ['pra', 'PRA']] as const
type StatKey = (typeof STATS)[number][0]
type View = 'cards' | 'list'

interface GameInfo {
  id: string; date: string; status: string; state: 'pre' | 'in' | 'post'; home: { abbr: string; score: string }; away: { abbr: string; score: string }
  odds?: { spread: number | null; total: number | null; homeWinProb: number | null } | null
}
interface Absence { id: number; name: string; team: string | null; status: 'out' | 'doubtful' | 'questionable'; label: string; note: string }
type TeamStanding = StandingRow & { conference: string }
interface Section { game: string; date: string; cards: Card[]; info: GameInfo | null }

const VIEW_KEY = 'ubet.props.view'
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards' } catch { return 'cards' } }

export default function PropsBoard({ refreshKey, onOpenPlayer }: { refreshKey: number; onOpenPlayer: (id: number) => void }) {
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [configured, setConfigured] = useState(true)
  const [meta, setMeta] = useState<PicksMeta | null>(null)
  const coverage = (meta as (PicksMeta & { coverage?: { omitted: unknown[] } }) | null)?.coverage
  const [error, setError] = useState('')
  const [stat, setStat] = useState<StatKey>('all')
  const [game, setGame] = useState('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('ev')
  const [positive, setPositive] = useState(false)
  const [view, setViewState] = useState<View>(readView)
  const [h2h, setH2h] = useState<H2HState>({ status: 'loading' })
  const [sched, setSched] = useState<GameInfo[]>([])
  const [absent, setAbsent] = useState<Absence[]>([])
  const [table, setTable] = useState<Map<string, TeamStanding>>(new Map())
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode: the choice just is not remembered */ } }

  useEffect(() => {
    api<{ configured: boolean; data: Pick[]; meta: PicksMeta }>('/picks')
      .then((r) => { setConfigured(r.configured); setPicks(r.data); setMeta(r.meta ?? null) })
      .catch((e) => setError(e.message))
  }, [refreshKey])

  // The schedule decides the order of the games, and live scores come from it. While any game is in progress it refreshes every 30 seconds.
  const anyLive = sched.some((g) => g.state === 'in')
  useEffect(() => {
    let live = true
    const load = () => api<{ data: GameInfo[] }>('/games').then((r) => live && setSched(r.data)).catch(() => {})
    load()
    const t = anyLive ? setInterval(load, 30_000) : undefined
    return () => { live = false; if (t) clearInterval(t) }
  }, [refreshKey, anyLive])

  // Optional context. A failure just hides it.
  useEffect(() => {
    let live = true
    api<{ data: Absence[] }>('/absences').then((r) => live && setAbsent(r.data)).catch(() => live && setAbsent([]))
    api<{ data: Conference[] }>('/standings')
      .then((r) => live && setTable(new Map(r.data.flatMap((c) => c.rows.map((row) => [row.abbr, { ...row, conference: c.name }] as const)))))
      .catch(() => live && setTable(new Map()))
    return () => { live = false }
  }, [refreshKey])

  // Head-to-head: every listed player's recent games against tonight's opponent, fetched once the props are in.
  useEffect(() => {
    if (!picks?.length) return
    const pairs = [...new Set(picks.map((p) => { const o = opponentOf(p); return o ? `${p.playerId}:${o}` : '' }).filter(Boolean))].slice(0, 200)
    if (!pairs.length) return
    let live = true
    api<{ data: H2H }>(`/h2h?pairs=${pairs.join(',')}`).then((r) => live && setH2h({ status: 'ok', data: r.data })).catch(() => live && setH2h({ status: 'error' }))
    return () => { live = false }
  }, [picks])

  const games = useMemo(() => [...new Set((picks ?? []).map((p) => p.game))].sort(), [picks])
  const cards = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = toCards((picks ?? []).filter((p) => (stat === 'all' || p.stat === stat) && (game === 'all' || p.game === game) && (!term || p.player.toLowerCase().includes(term))))
      .filter((c) => !positive || (c.lead.basis === 'authoritative' && c.lead.ev > 0))
    return sortCards(list, sort)
  }, [picks, stat, game, q, sort, positive])

  const sections = useMemo<Section[]>(() => {
    const m = new Map<string, Section>()
    for (const c of cards) {
      const g = m.get(c.lead.game) ?? m.set(c.lead.game, { game: c.lead.game, date: c.lead.gameDate, cards: [], info: null }).get(c.lead.game)!
      g.cards.push(c)
    }
    for (const g of m.values()) {
      const [a, h] = g.game.split(' @ ').map((n) => teamByName(n)?.[0])
      g.info = sched.find((x) => normAbbr(x.away.abbr) === a && normAbbr(x.home.abbr) === h) ?? null
    }
    // Tip-off order from the schedule; a game the schedule does not know goes last, by date.
    return [...m.values()].sort((a, b) => (a.info?.date ?? `${a.date}T99`).localeCompare(b.info?.date ?? `${b.date}T99`) || a.game.localeCompare(b.game))
  }, [cards, sched])

  // The page size resets whenever a filter changes, derived from the filters themselves rather than reset in an effect.
  const sig = `${stat}|${game}|${q}|${sort}|${positive}|${view}`
  const [paged, setPaged] = useState({ sig, n: 12 })
  const step = view === 'list' ? 40 : 12
  const limit = paged.sig === sig ? paged.n : step
  const setLimit = (n: number) => setPaged({ sig, n })

  const ctl = 'rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
  return (
    <div className="space-y-3">
      <div role="search" className="z-10 -mx-3 border-b border-neutral-800/80 bg-neutral-950/95 px-3 py-2 backdrop-blur sm:sticky sm:top-12 sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div role="group" aria-label="Prop category" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STATS.map(([k, label]) => (
              <button key={k} onClick={() => setStat(k)} aria-pressed={stat === k}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${stat === k ? 'bg-emerald-500 font-medium text-neutral-950' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <label className="sr-only" htmlFor="props-game">Game</label>
            <select id="props-game" value={game} onChange={(e) => setGame(e.target.value)} className={`${ctl} max-w-[11rem] truncate`}>
              <option value="all">All games</option>
              {games.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <label className="sr-only" htmlFor="props-sort">Sort by</label>
            <select id="props-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={ctl} title={SORTS.find((s) => s.key === sort)?.hint}>
              {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-neutral-400" title="Hide props whose best side has zero or negative expected value">
              <input type="checkbox" checked={positive} onChange={(e) => setPositive(e.target.checked)} className="accent-emerald-500" /> +EV only
            </label>
            <label className="sr-only" htmlFor="props-search">Search players</label>
            <input id="props-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players"
              className={`${ctl} w-40 placeholder:text-neutral-600`} />
            <div role="group" aria-label="Layout" className="flex rounded-lg bg-neutral-900 p-0.5 text-sm">
              {(['cards', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                  className={`rounded-md px-3 py-1 capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${view === v ? 'bg-neutral-700 text-neutral-50' : 'text-neutral-400 hover:text-neutral-200'}`}>{v}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <div className="min-w-0 flex-1"><Notices meta={meta} /></div>
        <MetricGuide />
        {coverage && coverage.omitted.length > 0 && (
          <span className="text-xs text-amber-400">{coverage.omitted.length} later game{coverage.omitted.length === 1 ? ' is' : 's are'} not loaded (size limit).</span>
        )}
        <span className="text-xs tabular-nums text-neutral-600" aria-live="polite">{picks ? `${cards.length} props` : ''}</span>
      </div>

      {error && <p className="text-sm text-neutral-500">{error}</p>}
      {picks === null ? <Empty>Loading…</Empty> : !configured ? (
        <Empty>Add an <code className="text-neutral-300">ODDS_API_KEY</code> to <code className="text-neutral-300">.dev.vars</code> to pull live lines.</Empty>
      ) : cards.length === 0 ? (
        <Empty>No props match these filters. Lines appear once books post them, for players you have synced.</Empty>
      ) : (
        <div className="space-y-8">
          {sections.map((g, i) => <GameSection key={g.game} g={g} index={i} absent={absent} table={table} h2h={h2h} view={view} limit={limit} more={() => setLimit(limit + step)} onOpenPlayer={onOpenPlayer} />)}
        </div>
      )}
    </div>
  )
}

function GameSection({ g, index, absent, table, h2h, view, limit, more, onOpenPlayer }: {
  g: Section; index: number; absent: Absence[]; table: Map<string, TeamStanding>; h2h: H2HState; view: View; limit: number; more: () => void; onOpenPlayer: (id: number) => void
}) {
  // Only the first three games start open: a slate of 12 games would otherwise put thousands of nodes on the page.
  const [open, setOpen] = useState(index < 3)
  const [away, home] = g.game.split(' @ ')
  const players = new Set(g.cards.map((c) => c.lead.playerId)).size
  const shown = g.cards.slice(0, limit)
  return (
    <section aria-label={g.game}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
        {[away, home].map((n) => { const t = teamByName(n); return t && <TeamLogo key={n} id={t[1]} abbr={t[0]} size={32} /> })}
        <h2 className="text-lg font-semibold text-neutral-50">{away} <span className="font-normal text-neutral-600">@</span> {home}</h2>
        <GameStatus info={g.info} />
        <span className="text-sm text-neutral-500">{g.cards.length} props · {players} players</span>
        <span className="ml-auto text-sm text-neutral-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      <GameContext game={g.game} info={g.info} absent={absent} table={table} />
      {open && (
        <div className="mt-3">
          {view === 'list'
            ? <PropList cards={shown} onOpenPlayer={onOpenPlayer} />
            : <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">{shown.map((c) => <PropTile key={c.key} c={c} h2h={h2h} onOpenPlayer={onOpenPlayer} />)}</div>}
          {g.cards.length > limit && (
            <button onClick={more} className="mt-3 w-full rounded-xl border border-dashed border-neutral-800 py-3 text-sm text-neutral-500 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Show more ({g.cards.length - limit} left)</button>
          )}
        </div>
      )}
    </section>
  )
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

/** Each team's record and seed, plus the injury report for both teams, as one quiet block under the game title. */
function GameContext({ game, info, absent, table }: { game: string; info: GameInfo | null; absent: Absence[]; table: Map<string, TeamStanding> }) {
  const teams = game.split(' @ ').map((n) => teamByName(n)).filter((t) => !!t)
  const rows = teams.map((t) => ({ abbr: t![0], s: table.get(t![0]) })).filter((x) => x.s)
  const mine = absent.filter((a) => a.team && teams.some((t) => t![0] === a.team))
  const fav = info && info.state === 'pre' ? favorite(info) : null
  if (!rows.length && !mine.length && !fav) return null
  const tone = { out: 'bg-red-500/15 text-red-300', doubtful: 'bg-amber-500/15 text-amber-300', questionable: 'bg-neutral-800 text-neutral-300' }
  return (
    <div className="mt-1.5 space-y-1.5 text-sm text-neutral-400">
      {rows.length > 0 && (
        <p className="flex flex-wrap gap-x-6 gap-y-0.5 tabular-nums">
          {rows.map(({ abbr, s }) => (
            <span key={abbr}><b className="font-medium text-neutral-200">{abbr}</b> {s!.wins}-{s!.losses}
              <span className="text-neutral-500"> · {s!.seed === 99 ? 'unseeded' : `${ordinal(s!.seed)} ${s!.conference}`} · last 10 {s!.last10}</span>
              {s!.streak && <span className={s!.streak.startsWith('W') ? ' text-emerald-400' : ' text-red-400'}> {s!.streak}</span>}
            </span>
          ))}
        </p>
      )}
      {fav && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums" title="From the betting market (no-margin win chance averaged over books). The app has no game-winner model of its own.">
          <span className="text-neutral-500">Market favours</span>
          {fav.tossUp
            ? <b className="font-medium text-neutral-200">a toss-up</b>
            : <><b className="font-medium text-emerald-400">{fav.abbr}</b><span className="text-neutral-300">{Math.round(fav.prob * 100)}% to win</span></>}
          {fav.spread != null && !fav.tossUp && <span className="text-neutral-500">{fav.abbr} {fav.spread === 0 ? 'pick' : fav.spread}</span>}
          {fav.total != null && <span className="text-neutral-500">total {fav.total}</span>}
        </p>
      )}
      {mine.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-neutral-500">Injury report</span>
          {mine.map((a) => <span key={a.id} title={a.note || a.label} className={`rounded-full px-2.5 py-0.5 ${tone[a.status]}`}>{a.team} {a.name.split(' ').slice(-1)[0]} · {a.status}</span>)}
        </p>
      )}
    </div>
  )
}

function GameStatus({ info }: { info: GameInfo | null }) {
  if (!info) return null
  if (info.state === 'pre') return <span className="rounded-full bg-neutral-800 px-3 py-0.5 text-sm text-neutral-300">{new Date(info.date).toLocaleTimeString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
  const score = `${info.away.abbr} ${info.away.score} – ${info.home.score} ${info.home.abbr}`
  return info.state === 'in'
    ? <span className="flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-0.5 text-sm tabular-nums text-red-300"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />LIVE · {score} · {info.status}</span>
    : <span className="rounded-full bg-neutral-800 px-3 py-0.5 text-sm tabular-nums text-neutral-400">Final · {score}</span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{children}</p>
}

