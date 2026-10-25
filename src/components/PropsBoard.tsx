import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import type { PicksMeta } from '../../shared/picks.ts'
import { STAT_LABEL, api, fmt, pct } from '../lib/format'
import type { Pick } from '../lib/picks'
import { logoUrl, teamByName, teamId } from '../lib/teams'
import { InjuryTag, RoleTag } from './Availability'
import Headshot from './Headshot'
import Notices from './Notices'
import { SlipButton } from './PickTable'
import { PickSpark } from './PickSpark'

const PickBars = lazy(() => import('./PickBars'))

// One card per player, stat and line, with both sides priced next to each other, grouped by game in tip-off order.
const STATS = [['all', 'All props'], ['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['fg3m', 'Threes'], ['pra', 'PRA']] as const
const SORTS = [['edge', 'Best edge'], ['hit', 'Hit rate'], ['line', 'Line'], ['name', 'Player']] as const
type StatKey = (typeof STATS)[number][0]
type SortKey = (typeof SORTS)[number][0]

interface Card { key: string; over: Pick | null; under: Pick | null; lead: Pick }
interface GameInfo { id: string; date: string; status: string; state: 'pre' | 'in' | 'post'; home: { abbr: string; score: string }; away: { abbr: string; score: string } }
interface Absence { id: number; name: string; team: string | null; status: 'out' | 'doubtful' | 'questionable'; label: string; note: string }
interface H2HGame { date: string; minutes: number; pts: number; reb: number; ast: number; fg3m: number }
type H2H = Record<string, H2HGame[]>
/** Head-to-head is 'loading' until it arrives, and 'error' if the request failed: a failure must never read as "no earlier games". */
type H2HState = { status: 'loading' | 'error' } | { status: 'ok'; data: H2H }
/** A meeting's value for a stat; PRA is points + rebounds + assists. */
const h2hValue = (r: H2HGame, stat: string): number => (stat === 'pra' ? r.pts + r.reb + r.ast : r[stat as 'pts' | 'reb' | 'ast' | 'fg3m'])

interface Section { game: string; date: string; cards: Card[]; info: GameInfo | null }

function toCards(picks: Pick[]): Card[] {
  const m = new Map<string, Card>()
  for (const p of picks) {
    const key = `${p.playerId}|${p.stat}|${p.line}`
    const c = m.get(key) ?? { key, over: null, under: null, lead: p }
    if (p.side === 'over') c.over = p; else c.under = p
    if (p.ev > c.lead.ev) c.lead = p
    m.set(key, c)
  }
  return [...m.values()]
}

const hit = (c: Card) => {
  const p = c.lead
  if (!p.recent.length) return -1
  return p.recent.filter((v) => (p.side === 'over' ? v > p.line : v < p.line)).length / p.recent.length
}

/** The opponent's abbreviation: the other team in "Away @ Home". */
function opponentOf(p: Pick): string | null {
  const [away, home] = p.game.split(' @ ')
  const mine = p.teamName
  const other = mine === away ? home : mine === home ? away : null
  return other ? teamByName(other)?.[0] ?? null : null
}

export default function PropsBoard({ refreshKey, onOpenPlayer }: { refreshKey: number; onOpenPlayer: (id: number) => void }) {
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [configured, setConfigured] = useState(true)
  const [meta, setMeta] = useState<PicksMeta | null>(null)
  const [error, setError] = useState('')
  const [stat, setStat] = useState<StatKey>('all')
  const [game, setGame] = useState('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortKey>('edge')
  const [positive, setPositive] = useState(false)
  const [h2h, setH2h] = useState<H2HState>({ status: 'loading' })
  const [sched, setSched] = useState<GameInfo[]>([])
  const [absent, setAbsent] = useState<Absence[]>([])

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

  // Who is on the injury report, shown on each game so the reader can judge minutes and usage. Optional: a failure just hides it.
  useEffect(() => {
    let live = true
    api<{ data: Absence[] }>('/absences').then((r) => live && setAbsent(r.data)).catch(() => live && setAbsent([]))
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
      .filter((c) => !positive || c.lead.ev > 0)
    const by: Record<SortKey, (a: Card, b: Card) => number> = {
      edge: (a, b) => b.lead.ev - a.lead.ev,
      hit: (a, b) => hit(b) - hit(a),
      line: (a, b) => b.lead.line - a.lead.line,
      name: (a, b) => a.lead.player.localeCompare(b.lead.player),
    }
    return list.sort(by[sort])
  }, [picks, stat, game, q, sort, positive])

  const sections = useMemo<Section[]>(() => {
    const m = new Map<string, Section>()
    for (const c of cards) {
      const g = m.get(c.lead.game) ?? m.set(c.lead.game, { game: c.lead.game, date: c.lead.gameDate, cards: [], info: null }).get(c.lead.game)!
      g.cards.push(c)
    }
    for (const g of m.values()) {
      const [a, h] = g.game.split(' @ ').map((n) => teamByName(n)?.[0])
      g.info = sched.find((x) => x.away.abbr === a && x.home.abbr === h) ?? null
    }
    // Tip-off order from the schedule; a game the schedule does not know goes last, by date.
    return [...m.values()].sort((a, b) => (a.info?.date ?? `${a.date}T99`).localeCompare(b.info?.date ?? `${b.date}T99`) || a.game.localeCompare(b.game))
  }, [cards, sched])

  // The page size resets whenever a filter changes, derived from the filters themselves rather than reset in an effect.
  const sig = `${stat}|${game}|${q}|${sort}|${positive}`
  const [paged, setPaged] = useState({ sig, n: 12 })
  const limit = paged.sig === sig ? paged.n : 12
  const setLimit = (n: number) => setPaged({ sig, n })

  return (
    <div className="space-y-5">
      <div className="sticky top-[5.25rem] z-10 sm:top-12 -mx-3 space-y-3 border-b border-neutral-800/80 bg-neutral-950/90 px-3 py-3 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STATS.map(([k, label]) => (
              <button key={k} onClick={() => setStat(k)}
                className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm ${stat === k ? 'bg-emerald-500 font-medium text-neutral-950' : 'bg-neutral-900 text-neutral-400 hover:text-neutral-100'}`}>
                {label}
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" aria-label="Search players"
            className="ml-auto w-56 rounded-full bg-neutral-900 px-4 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-emerald-500" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game" className="rounded-lg bg-neutral-900 px-3 py-1.5 text-neutral-300">
            <option value="all">All games</option>
            {games.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" className="rounded-lg bg-neutral-900 px-3 py-1.5 text-neutral-300">
            {SORTS.map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-neutral-400">
            <input type="checkbox" checked={positive} onChange={(e) => setPositive(e.target.checked)} className="accent-emerald-500" /> Positive edge only
          </label>
          <span className="ml-auto tabular-nums text-neutral-600">{picks ? `${cards.length} props` : ''}</span>
        </div>
      </div>

      {error && <p className="text-sm text-neutral-500">{error}</p>}
      <Notices meta={meta} />
      {picks === null ? <Empty>Loading…</Empty> : !configured ? (
        <Empty>Add an <code className="text-neutral-300">ODDS_API_KEY</code> to <code className="text-neutral-300">.dev.vars</code> to pull live lines.</Empty>
      ) : cards.length === 0 ? (
        <Empty>No props match these filters. Lines appear once books post them, for players you have synced.</Empty>
      ) : (
        <div className="space-y-10">
          {sections.map((g, i) => <GameSection key={g.game} g={g} index={i} absent={absent} h2h={h2h} limit={limit} more={() => setLimit(limit + 12)} onOpenPlayer={onOpenPlayer} />)}
        </div>
      )}
    </div>
  )
}

function GameSection({ g, index, absent, h2h, limit, more, onOpenPlayer }: { g: Section; index: number; absent: Absence[]; h2h: H2HState; limit: number; more: () => void; onOpenPlayer: (id: number) => void }) {
  // Only the first three games start open: a slate of 12 games would otherwise put thousands of nodes on the page.
  const [open, setOpen] = useState(index < 3)
  const [away, home] = g.game.split(' @ ')
  const players = new Set(g.cards.map((c) => c.lead.playerId)).size
  return (
    <section>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="mb-4 flex w-full flex-wrap items-center gap-3 text-left">
        {[away, home].map((n) => { const t = teamByName(n); return t && <TeamLogo key={n} id={t[1]} abbr={t[0]} size={40} /> })}
        <h2 className="text-xl font-semibold text-neutral-100">{away} <span className="text-neutral-600">@</span> {home}</h2>
        <GameStatus info={g.info} />
        <span className="text-sm text-neutral-500">{g.cards.length} props · {players} players</span>
        <span className="ml-auto text-sm text-neutral-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      <Absent game={g.game} absent={absent} />
      {open && (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {g.cards.slice(0, limit).map((c) => <PropTile key={c.key} c={c} h2h={h2h} onOpenPlayer={onOpenPlayer} />)}
          {g.cards.length > limit && (
            <button onClick={more} className="rounded-2xl border border-dashed border-neutral-800 py-10 text-sm text-neutral-500 hover:text-neutral-200">Show more ({g.cards.length - limit} left)</button>
          )}
        </div>
      )}
    </section>
  )
}

/** A team logo that falls back to the team's abbreviation instead of a broken-image box. */
function TeamLogo({ id, abbr, size }: { id: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[11px] font-medium text-neutral-400" style={{ width: size, height: size }} aria-hidden>{size >= 32 ? abbr : ''}</span>
  return <img src={logoUrl(id)} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="shrink-0" />
}

/** The injury report for the two teams in a game. Projections do not adjust for it (see research/PREREG_TEAMMATE_OUT.md), so it is shown for the reader. */
function Absent({ game, absent }: { game: string; absent: Absence[] }) {
  const [away, home] = game.split(' @ ').map((n) => teamByName(n)?.[0])
  const mine = absent.filter((a) => a.team && (a.team === away || a.team === home))
  if (!mine.length) return null
  const tone = { out: 'bg-red-500/15 text-red-300', doubtful: 'bg-amber-500/15 text-amber-300', questionable: 'bg-neutral-800 text-neutral-300' }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-neutral-500">Injury report</span>
      {mine.map((a) => (
        <span key={a.id} title={a.note || a.label} className={`rounded-full px-2.5 py-0.5 ${tone[a.status]}`}>{a.team} {a.name.split(' ').slice(-1)[0]} · {a.status === 'out' ? 'out' : a.status}</span>
      ))}
    </div>
  )
}

function GameStatus({ info }: { info: GameInfo | null }) {
  if (!info) return null
  if (info.state === 'pre') return <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300">{new Date(info.date).toLocaleTimeString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
  const score = `${info.away.abbr} ${info.away.score} – ${info.home.score} ${info.home.abbr}`
  return info.state === 'in'
    ? <span className="flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1 text-sm tabular-nums text-red-300"><span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />LIVE · {score} · {info.status}</span>
    : <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm tabular-nums text-neutral-400">Final · {score}</span>
}

function H2HLine({ p, rows, failed }: { p: Pick; rows: H2HGame[] | undefined; failed: boolean }) {
  const opp = opponentOf(p)
  if (!opp) return null
  if (failed) return <div className="px-4 pb-4 text-xs text-amber-500/80">vs {opp}: head-to-head unavailable right now</div>
  if (!rows) return <div className="px-4 pb-4 text-xs text-neutral-700">vs {opp}: loading…</div>
  if (!rows.length) return <div className="px-4 pb-4 text-xs text-neutral-600">vs {opp}: no earlier games</div>
  const vals = rows.map((r) => h2hValue(r, p.stat))
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const landed = vals.filter((v) => (p.side === 'over' ? v > p.line : v < p.line)).length
  return (
    <div className="flex items-center gap-2 px-4 pb-4 text-xs tabular-nums text-neutral-500" title={rows.map((r) => `${r.date}: ${h2hValue(r, p.stat)}`).join(' · ')}>
      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">vs {opp}</span>
      <span>{rows.length} gm{rows.length === 1 ? '' : 's'} · avg {avg.toFixed(1)}</span>
      <span className={landed * 2 >= rows.length ? 'text-emerald-400' : 'text-neutral-500'}>{landed}/{rows.length} {p.side}</span>
      <span className="ml-auto flex gap-0.5">
        {vals.slice().reverse().map((v, i) => <span key={i} className={`h-3.5 w-1.5 rounded-sm ${(p.side === 'over' ? v > p.line : v < p.line) ? 'bg-emerald-500' : 'bg-neutral-700'}`} />)}
      </span>
    </div>
  )
}

const H2H_STATS = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['pra', 'PRA']] as const

/** Every stat in the earlier meetings with tonight's opponent, newest first; the stat this card is about is highlighted. */
function H2HAll({ p, rows }: { p: Pick; rows: H2HGame[] | undefined }) {
  const opp = opponentOf(p)
  if (!opp || !rows?.length) return null
  return (
    <div className="border-t border-neutral-800 px-4 py-3">
      <div className="mb-1.5 text-xs uppercase tracking-widest text-neutral-500">{p.player.split(' ').pop()} vs {opp}, last {rows.length}</div>
      <table className="w-full text-xs tabular-nums sm:text-sm">
        <thead className="text-neutral-600">
          <tr><th className="text-left font-normal" />{rows.map((r) => <th key={r.date} className="px-1 text-right font-normal" title={r.date}>{r.date.slice(5)}</th>)}<th className="pl-2 text-right font-normal">Avg</th></tr>
        </thead>
        <tbody>
          <tr className="text-neutral-600"><td>MIN</td>{rows.map((r) => <td key={r.date} className="px-1 text-right">{Math.round(r.minutes)}</td>)}<td className="pl-2 text-right">{Math.round(rows.reduce((a, r) => a + r.minutes, 0) / rows.length)}</td></tr>
          {H2H_STATS.map(([k, label]) => {
            const mine = k === p.stat
            return (
              <tr key={k} className={mine ? 'text-neutral-100' : 'text-neutral-400'}>
                <td className={mine ? 'text-emerald-400' : ''}>{label}</td>
                {rows.map((r) => {
                  const ok = mine && (p.side === 'over' ? h2hValue(r, k) > p.line : h2hValue(r, k) < p.line)
                  return <td key={r.date} className={`px-1 text-right ${ok ? 'text-emerald-400' : ''}`}>{h2hValue(r, k)}</td>
                })}
                <td className="pl-2 text-right font-medium">{(rows.reduce((a, r) => a + h2hValue(r, k), 0) / rows.length).toFixed(1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PropTile({ c, h2h, onOpenPlayer }: { c: Card; h2h: H2HState; onOpenPlayer: (id: number) => void }) {
  const p = c.lead
  const [open, setOpen] = useState(false)
  const tid = teamId(p.team)
  const h = hit(c)
  const rows = h2h.status === 'ok' ? h2h.data[`${p.playerId}:${opponentOf(p)}`] ?? [] : undefined
  return (
    <div className="lift overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 430px' }}>
      <div className="flex items-center gap-3 px-4 pt-4">
        <button onClick={() => onOpenPlayer(p.playerId)} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Open player">
          <Headshot id={p.playerId} name={p.player} size={56} />
          <span className="min-w-0 leading-tight">
            <span className="flex items-center gap-1.5 truncate text-base font-medium text-neutral-100">{p.player}<InjuryTag injury={p.injury} /></span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
              {tid && <TeamLogo id={tid} abbr={p.team ?? ''} size={16} />}{p.team}
            </span>
            <RoleTag role={p.role} />
          </span>
        </button>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-neutral-500">{STAT_LABEL[p.stat]}</div>
          <div className="text-3xl font-semibold tabular-nums text-neutral-100">{p.line}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        {([['over', c.over], ['under', c.under]] as const).map(([side, x]) => (
          <div key={side} className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 ${x && x === p && x.ev > 0 ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'bg-neutral-800/70'}`}>
            <span className="text-sm">
              <span className="text-neutral-300">{side === 'over' ? 'Over' : 'Under'}</span>
              <span className="block text-xs tabular-nums text-neutral-500">{x ? `${x.book} · ${pct(x.prob)}` : 'not posted'}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-lg font-semibold tabular-nums text-neutral-100">{x ? x.price.toFixed(2) : '–'}</span>
              {x && <SlipButton pick={x} />}
            </span>
          </div>
        ))}
      </div>

      <div className="mx-4 mt-3 grid grid-cols-4 gap-2 rounded-xl bg-neutral-950/60 px-3 py-2 text-center">
        <Fact label="Model" value={pct(p.modelProb)} />
        <Fact label="Market" value={pct(p.marketProb)} />
        <Fact label="Hit L10" value={h < 0 ? '–' : `${Math.round(h * 100)}%`} />
        <Fact label="Games" value={String(p.sample)} />
      </div>
      {p.prices.length > 1 && (
        <div className="mx-4 mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-neutral-500">
          {p.prices.map((x) => <span key={x.book}>{x.book} <span className="text-neutral-300">{x.price.toFixed(2)}</span></span>)}
        </div>
      )}

      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-4 px-4 py-3 text-left" title="Show the last games large">
        <PickSpark p={p} w={150} h={40} />
        <span className="ml-auto grid grid-cols-2 gap-x-4 text-right text-sm tabular-nums">
          <Stat label="Proj" value={fmt(p.projection)} />
          <Stat label="Edge" value={`${p.ev > 0 ? '+' : ''}${(p.ev * 100).toFixed(1)}%`} tone={p.ev > 0 ? 'text-emerald-400' : 'text-neutral-400'} />
        </span>
      </button>
      <H2HLine p={p} rows={rows} failed={h2h.status === 'error'} />
      {open && <><div className="border-t border-neutral-800 px-1 pb-2"><Suspense fallback={<div className="h-32" />}><PickBars p={p} /></Suspense></div><H2HAll p={p} rows={rows} /></>}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <span><span className="block text-[11px] uppercase tracking-wider text-neutral-500">{label}</span><span className="text-base font-medium tabular-nums text-neutral-100">{value}</span></span>
}

function Stat({ label, value, tone = 'text-neutral-200' }: { label: string; value: string; tone?: string }) {
  return <span><span className="block text-[11px] uppercase tracking-wider text-neutral-500">{label}</span><span className={tone}>{value}</span></span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{children}</p>
}
