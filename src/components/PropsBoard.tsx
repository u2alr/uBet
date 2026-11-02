import { useEffect, useId, useMemo, useState } from 'react'
import { normName, type PicksMeta } from '../../shared/picks.ts'
import type { Conference, StandingRow } from '../../shared/standings.ts'
import { STAT_LABEL, api } from '../lib/format'
import type { Pick } from '../lib/picks'
import { SORTS, capPerTeam, evRank, evText, favorite, groupConsecutive, shortName, normAbbr, opponentOf, sortCards, toCards, type Card, type SortKey } from '../lib/propsBoard'
import { teamByName } from '../lib/teams'
import type { H2H, H2HState } from '../lib/h2hView'
import { gameReasons, lean, type GameLeanRow } from '../../shared/games.ts'
import GamesRail, { type RailGame } from './GamesRail'
import LiveBox from './LiveBox'
import MetricGuide from './MetricGuide'
import Notices from './Notices'
import PropList from './PropList'
import PropTile from './PropTile'
import ReasonList from './ReasonList'
import TeamChip from './TeamChip'
import TopPicks from './TopPicks'

// The Props board: one card per player, stat and line, grouped by game in tip-off order. Filters live in one sticky toolbar.
const STATS = [['all', 'All'], ['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['fg3m', 'Threes'], ['pra', 'PRA']] as const
type StatKey = (typeof STATS)[number][0]
type View = 'cards' | 'list'

interface GameInfo {
  id: string; date: string; status: string; state: 'pre' | 'in' | 'post'; home: { abbr: string; name?: string; score: string }; away: { abbr: string; name?: string; score: string }
  odds?: { spread: number | null; total: number | null; homeWinProb: number | null; bestMoneyline?: { home: number; away: number } | null } | null
}
interface Absence { id: number; name: string; team: string | null; status: 'out' | 'doubtful' | 'questionable' | 'day-to-day'; label: string; note: string }
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
  const [top10, setTop10] = useState(true)
  const [view, setViewState] = useState<View>(readView)
  const [h2h, setH2h] = useState<H2HState>({ status: 'loading' })
  const [sched, setSched] = useState<GameInfo[]>([])
  const [absent, setAbsent] = useState<Absence[]>([])
  const [table, setTable] = useState<Map<string, TeamStanding>>(new Map())
  const [leans, setLeans] = useState<GameLeanRow[]>([])
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode: the choice just is not remembered */ } }

  useEffect(() => {
    api<{ configured: boolean; data: Pick[]; meta: PicksMeta }>('/picks')
      .then((r) => { setConfigured(r.configured); setPicks(r.data); setMeta(r.meta ?? null) })
      .catch((e) => { setError(e.message); setPicks([]) })
  }, [refreshKey])

  // The schedule decides the order of the games, and live scores come from it. While any game is in progress it refreshes every 30 seconds.
  const anyLive = sched.some((g) => g.state === 'in')
  useEffect(() => {
    let live = true
    const standings = () => api<{ data: Conference[] }>('/standings')
      .then((r) => live && setTable(new Map(r.data.flatMap((c) => c.rows.map((row) => [row.abbr, { ...row, conference: c.name }] as const))))).catch(() => {})
    const load = () => api<{ data: GameInfo[] }>('/games').then((r) => live && setSched(r.data)).catch(() => {})
    const onVisible = () => { if (document.visibilityState === 'visible') { load(); standings() } }
    document.addEventListener('visibilitychange', onVisible)
    load()
    const t = anyLive ? setInterval(() => { load(); standings() }, 30_000) : undefined
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible); if (t) clearInterval(t) }
  }, [refreshKey, anyLive])

  // Optional context. A failure just hides it.
  useEffect(() => {
    let live = true
    api<{ data: { rows: GameLeanRow[] } }>('/game-lean').then((r) => live && setLeans(r.data.rows)).catch(() => live && setLeans([]))
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
  // Every card that passes the filters; Top picks draws from this so the per-team cap can never hide the best values.
  const matching = useMemo(() => {
    const term = q.trim().toLowerCase()
    return toCards((picks ?? []).filter((p) => (stat === 'all' || p.stat === stat) && (game === 'all' || p.game === game) && (!term || p.player.toLowerCase().includes(term))))
      .filter((c) => !positive || (c.lead.basis === 'authoritative' && c.lead.ev > 0))
  }, [picks, stat, game, q, positive])
  // The board shows each team's 10 likeliest leads. Searching for a player lifts the cap, so a name always finds them.
  const capped = top10 && !q.trim()
  const cards = useMemo(() => sortCards(capped ? capPerTeam(matching, 10) : matching, sort), [matching, capped, sort])

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
    // Games the books have no props for (or odds are down) still show: scores, standings, injuries and the live box score do not depend on odds.
    const newest = Math.max(0, ...sched.map((x) => Date.parse(x.date)))
    if (stat === 'all' && game === 'all' && !q.trim() && !positive)
      for (const x of sched) {
        const away = x.away.name, home = x.home.name
        if (!away || !home || x.state === 'post' && newest - Date.parse(x.date) > 36 * 3600_000) continue
        const key = `${away} @ ${home}`
        if (![...m.values()].some((s) => s.info?.id === x.id) && !m.has(key)) m.set(key, { game: key, date: x.date.slice(0, 10), cards: [], info: x })
      }
    // Tip-off order from the schedule; a game the schedule does not know goes last, by date.
    return [...m.values()].sort((a, b) => (a.info?.date ?? `${a.date}T99`).localeCompare(b.info?.date ?? `${b.date}T99`) || a.game.localeCompare(b.game))
  }, [cards, sched, stat, game, q, positive])

  // The page size resets whenever a filter changes, derived from the filters themselves rather than reset in an effect.
  const sig = `${stat}|${game}|${q}|${sort}|${positive}|${view}|${capped}`
  const [paged, setPaged] = useState({ sig, n: 12 })
  const step = view === 'list' ? 40 : 12
  const limit = paged.sig === sig ? paged.n : step
  const setLimit = (n: number) => setPaged({ sig, n })

  // Which games are open. Until a game is toggled (or picked in the rail) only the first three games with lines start open: a slate of 12 would otherwise put thousands of nodes on the page.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [active, setActive] = useState<string | null>(null)
  const [emptyOpen, setEmptyOpen] = useState(false)
  const lined = sections.filter((g) => g.cards.length > 0), empty = sections.filter((g) => g.cards.length === 0)
  const isOpen = (g: Section) => openMap[g.game] ?? (lined.indexOf(g) >= 0 && lined.indexOf(g) < 3)
  const toggle = (g: Section) => setOpenMap((m) => ({ ...m, [g.game]: !isOpen(g) }))
  const pickGame = (game: string) => {
    setOpenMap((m) => ({ ...m, [game]: true }))
    setActive(game)
    if (empty.some((g) => g.game === game)) setEmptyOpen(true)
    // Wait a frame so the section exists and is open before scrolling to it.
    requestAnimationFrame(() => document.getElementById(sectionId(game))?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const rail: RailGame[] = sections.map((g) => ({ game: g.game, time: g.info ? new Date(g.info.date).toLocaleTimeString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null, state: g.info?.state ?? null, props: g.cards.length }))

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
            <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-neutral-400" title="Show only each team's 10 props whose lead side has the highest chance of winning. Chance of winning is not the same as value. Searching a player ignores this.">
              <input type="checkbox" checked={top10} onChange={(e) => setTop10(e.target.checked)} className="accent-emerald-500" /> Top 10 per team
            </label>
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

      <div className="space-y-3 xl:grid xl:grid-cols-[12rem_minmax(0,1fr)_18rem] xl:items-start xl:gap-6 xl:space-y-0">
        <div className="hidden xl:sticky xl:top-36 xl:block xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto"><GamesRail games={rail} active={active} onPick={pickGame} /></div>

        <div className="min-w-0 space-y-3">
        <div className="xl:hidden"><TopPicks cards={matching} onOpenPlayer={onOpenPlayer} layout="strip" /></div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="min-w-0 flex-1"><Notices meta={meta} /></div>
          <MetricGuide />
          {coverage && coverage.omitted.length > 0 && (
            <span className="text-xs text-amber-400">{coverage.omitted.length} later game{coverage.omitted.length === 1 ? ' is' : 's are'} not loaded (size limit).</span>
          )}
          <span className="text-xs tabular-nums text-neutral-600" aria-live="polite">{picks ? (capped && matching.length > cards.length ? `${cards.length} of ${matching.length} props` : `${cards.length} props`) : ''}</span>
        </div>

        {error && <p className="text-sm text-neutral-500">{error}</p>}
        {picks === null ? <Empty>Loading…</Empty> : !configured ? (
          <Empty>Add an <code className="text-neutral-300">SHARPAPI_KEY</code> to <code className="text-neutral-300">.dev.vars</code> to pull live lines.</Empty>
        ) : sections.length === 0 ? (
          <Empty>No props match these filters. Lines appear once books post them, for players you have synced.</Empty>
        ) : (

          <div className="space-y-8">
            {groupConsecutive(lined, (g) => g.info ? new Date(g.info.date).toLocaleTimeString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Time not set').map((grp) => (
            <div key={grp.key} className="space-y-1">
              <h2 className="px-3 pb-1 text-xs font-medium uppercase tracking-widest text-neutral-500">{grp.key}</h2>
              {grp.items.map((g) => <GameSection key={g.game} g={g} open={isOpen(g)} onToggle={() => toggle(g)} absent={absent} table={table} leans={leans} h2h={h2h} view={view} limit={limit} more={() => setLimit(limit + step)} onOpenPlayer={onOpenPlayer} />)}
            </div>
          ))}
          {empty.length > 0 && (
              <div className="space-y-6">
                <button onClick={() => setEmptyOpen(!emptyOpen)} aria-expanded={emptyOpen} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-left text-sm text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
                  <span aria-hidden className={`inline-block transition-transform ${emptyOpen ? 'rotate-90' : ''}`}>›</span>
                  {empty.length} {empty.length === 1 ? 'game has' : 'games have'} no sportsbook lines yet
                  <span className="ml-auto text-xs text-neutral-600">{emptyOpen ? 'Hide' : 'Show'}</span>
                </button>
                {emptyOpen && empty.map((g) => <GameSection key={g.game} g={g} open={isOpen(g)} onToggle={() => toggle(g)} absent={absent} table={table} leans={leans} h2h={h2h} view={view} limit={limit} more={() => setLimit(limit + step)} onOpenPlayer={onOpenPlayer} />)}
              </div>
            )}
          </div>
        )}
        </div>

        <div className="hidden xl:sticky xl:top-36 xl:flex xl:max-h-[calc(100vh-10rem)] xl:flex-col xl:gap-4 xl:overflow-y-auto">
          <TopPicks cards={matching} onOpenPlayer={onOpenPlayer} layout="column" />
        </div>
      </div>
    </div>
  )
}

/** The anchor a game's section is scrolled to from the rail. */
const sectionId = (game: string) => `game-${game.replace(/\W+/g, '-')}`

function GameSection({ g, open, onToggle, absent, table, leans, h2h, view, limit, more, onOpenPlayer }: {
  g: Section; open: boolean; onToggle: () => void; absent: Absence[]; table: Map<string, TeamStanding>; leans: GameLeanRow[]; h2h: H2HState; view: View; limit: number; more: () => void; onOpenPlayer: (id: number) => void
}) {
  const [box, setBox] = useState(false)
  const bodyId = useId()
  const [away, home] = g.game.split(' @ ')
  const shown = g.cards.slice(0, limit)
  const [aAbbr, hAbbr] = [away, home].map((n) => teamByName(n)?.[0] ?? n.split(' ').pop())
  const fav = g.info?.state === 'pre' ? favorite(g.info) : null
  // The game's best lead by expected value, whatever the board is sorted by: the one number worth knowing before opening it.
  const best = g.cards.reduce<Card | null>((m, c) => (!m || evRank(c.lead) > evRank(m.lead) ? c : m), null)?.lead
  return (
    <section id={sectionId(g.game)} aria-label={g.game} className="scroll-mt-40">
      <h3>
      <button onClick={onToggle} aria-expanded={open} aria-controls={open ? bodyId : undefined} title={g.game}
        className="grid min-h-11 w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl px-3 py-1.5 text-left hover:bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 sm:grid-cols-[1rem_9.5rem_minmax(0,1fr)_minmax(0,1.3fr)]">
        <span aria-hidden className={`text-neutral-500 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="flex items-center gap-2">
          {[away, home].map((n) => { const t = teamByName(n); return t && <TeamChip key={n} id={t[1]} abbr={t[0]} size={24} /> })}
          <span className="whitespace-nowrap text-sm font-semibold text-neutral-50">{aAbbr} <span className="font-normal text-neutral-600">@</span> {hAbbr}</span>
        </span>
        <span className="min-w-0 truncate text-sm tabular-nums text-neutral-400">
          {g.info && g.info.state !== 'pre' ? <GameStatus info={g.info} />
            : fav ? <>{fav.tossUp ? 'Toss-up' : <><b className="font-medium text-neutral-200">{fav.abbr}</b> {fav.spread != null ? (fav.spread === 0 ? 'pick' : fav.spread) : `${Math.round(fav.prob * 100)}%`}</>}{fav.total != null && <span className="text-neutral-500"> · {fav.total}</span>}</>
            : <span className="text-neutral-600">no market</span>}
        </span>
        <span className="hidden min-w-0 truncate text-sm tabular-nums text-neutral-400 sm:block">
          {best
            ? <><span className="text-neutral-300">{shortName(best.player)}</span> {best.side === 'over' ? 'O' : 'U'} {best.line} {STAT_LABEL[best.stat]} <span className={best.basis === 'authoritative' && best.ev > 0 ? 'text-emerald-400' : 'text-neutral-500'}>{best.basis === 'authoritative' ? '' : '≈ '}{evText(best.ev)}</span></>
            : <span className="text-neutral-600">no sportsbook lines</span>}
        </span>
      </button>
      </h3>
      {/* The toggle collapses everything under the title: context, box score and props. */}
      {open && (
        <div id={bodyId} className="mt-1 px-3">
          <GameContext game={g.game} info={g.info} absent={absent} table={table} leans={leans} />
          {g.info && g.info.state !== 'pre' && (
            <div className="mt-2">
              <button onClick={() => setBox(!box)} aria-expanded={box} className="text-sm text-emerald-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">{box ? 'Hide box score' : g.info.state === 'in' ? 'Live box score' : 'Box score'}</button>
              {box && <div className="mt-2"><LiveBox gameId={g.info.id} live={g.info.state === 'in'} onOpenPlayer={onOpenPlayer} /></div>}
            </div>
          )}
          {g.cards.length > 0 && (
            <div className="mt-3">
              {view === 'list'
                ? <PropList cards={shown} onOpenPlayer={onOpenPlayer} />
                : <div className="grid items-start gap-4 md:grid-cols-2 min-[1900px]:grid-cols-3">{shown.map((c) => <PropTile key={c.key} c={c} h2h={h2h} tipIso={g.info?.date ?? null} onOpenPlayer={onOpenPlayer} />)}</div>}
              {g.cards.length > limit && (
                <button onClick={more} className="mt-3 w-full rounded-xl border border-dashed border-neutral-800 py-3 text-sm text-neutral-500 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Show more ({g.cards.length - limit} left)</button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`

/** "Gary Payton III" -> "Payton", "Mikel Brown Jr." -> "Brown". */
const surname = (name: string) => { const w = name.split(' '); return /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w[w.length - 1]) && w.length > 2 ? w[w.length - 2] : w[w.length - 1] }

/** One summary line under the game title (market favourite, model view, injuries out), with records, model reasoning and the injury report behind "Game info". */
function GameContext({ game, info, absent, table, leans }: { game: string; info: GameInfo | null; absent: Absence[]; table: Map<string, TeamStanding>; leans: GameLeanRow[] }) {
  const [more, setMore] = useState(false)
  const detailId = useId()
  const teams = game.split(' @ ').map((n) => teamByName(n)).filter((t) => !!t)
  const rows = teams.map((t) => ({ abbr: t![0], s: table.get(t![0]) })).filter((x) => x.s)
  const mine = absent.filter((a) => a.team && teams.some((t) => t![0] === a.team))
  const fav = info && info.state === 'pre' ? favorite(info) : null
  const [aw, hm] = teams.map((t) => t![0])
  const row = info?.state === 'pre' ? leans.find((l) => l.home === hm && l.away === aw) : undefined
  const view = row ? lean(row, info?.odds?.homeWinProb ?? null) : null
  if (!rows.length && !mine.length && !fav && !row) return null
  const tone = { out: 'bg-red-500/15 text-red-300', doubtful: 'bg-amber-500/15 text-amber-300', questionable: 'bg-neutral-800 text-neutral-300', 'day-to-day': 'bg-neutral-800 text-neutral-400' }
  const outCount = mine.filter((a) => a.status === 'out').length
  // The model counts the rotation players the report listed Out when it was scored. Anyone the report lists now who is not among them is shown, not hidden.
  const counted = new Set([row?.absent_home, row?.absent_away].flatMap((s) => (s ?? '').split(';')).map((s) => normName(s.replace(/\s*\(\d+ min\)\s*$/, ''))).filter(Boolean))
  const uncertain = mine.filter((a) => a.status !== 'out' || (!!row && !counted.has(normName(a.name))))
    .map((a) => ({ team: a.team!, name: a.name, status: a.status === 'out' ? 'out, not counted' : a.status }))
  const hasDetail = rows.length > 0 || !!row || mine.length > 0
  return (
    <div className="mt-1.5 text-sm text-neutral-400">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
        {fav && (
          <span className="flex flex-wrap items-center gap-x-2" title="From the betting market (no-margin win chance averaged over books). The app has no game-winner model of its own.">
            <span className="text-neutral-500">Market</span>
            {fav.tossUp
              ? <b className="font-medium text-neutral-200">toss-up</b>
              : <><b className="font-medium text-emerald-400">{fav.abbr}</b><span className="text-neutral-300">{Math.round(fav.prob * 100)}%</span></>}
            {fav.spread != null && !fav.tossUp && <span className="text-neutral-500">{fav.abbr} {fav.spread === 0 ? 'pick' : fav.spread}</span>}
            {fav.total != null && <span className="text-neutral-500">total {fav.total}</span>}
          </span>
        )}
        {row && view && (
          <span className={`flex items-center gap-x-2 ${view.lean ? 'text-amber-300' : ''}`} title="Home advantage, Elo and the rotation players the injury report lists Out. Tested with the players who actually sat out (a best case); late scratches and lineup news are not seen; not tested against sportsbook lines.">
            <span className="text-neutral-500">Model</span>
            <b className="font-medium text-neutral-200">{view.modelPick} {Math.round(view.modelProb * 100)}%</b>
            {view.lean && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs">lean vs market</span>}
          </span>
        )}
        {outCount > 0 && <span className="text-xs text-red-300/80">{outCount} out</span>}
        {hasDetail && (
          <button onClick={() => setMore(!more)} aria-expanded={more} aria-controls={detailId} className="ml-auto rounded px-1 py-1.5 text-xs text-emerald-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
            Why &amp; game info {more ? '▴' : '▾'}
          </button>
        )}
      </div>
      {more && (
        <div id={detailId} className="mt-2 space-y-1.5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
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
          {row && view && <ReasonList title={`Why the model favours ${view.modelPick}`} reasons={gameReasons(row, info?.odds?.homeWinProb ?? null, uncertain)} />}
          {mine.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-neutral-500">Injury report</span>
              {mine.map((a) => <span key={a.id} title={a.note || a.label} className={`rounded-full px-2.5 py-0.5 ${tone[a.status]}`}>{a.team} {surname(a.name)} · {a.status}</span>)}
            </p>
          )}
        </div>
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

