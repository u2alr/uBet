import { useEffect, useMemo, useState } from 'react'
import type { PicksMeta } from '../../shared/picks.ts'
import { STAT_LABEL, api, fmt, pct } from '../lib/format'
import type { Pick } from '../lib/picks'
import { logoUrl, teamByName, teamId } from '../lib/teams'
import { InjuryTag, RoleTag } from './Availability'
import Headshot from './Headshot'
import Notices from './Notices'
import { SlipButton } from './PickTable'
import { PickBars, PickSpark } from './PickSpark'

// One card per player, stat and line, with both sides priced next to each other. Filters live in one sticky row above the grid.
const STATS = [['all', 'All props'], ['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['fg3m', 'Threes']] as const
const SORTS = [['edge', 'Best edge'], ['hit', 'Hit rate'], ['line', 'Line'], ['name', 'Player']] as const
type StatKey = (typeof STATS)[number][0]
type SortKey = (typeof SORTS)[number][0]

interface Card { key: string; over: Pick | null; under: Pick | null; lead: Pick }

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

interface H2HGame { date: string; minutes: number; pts: number; reb: number; ast: number; fg3m: number }
type H2H = Record<string, H2HGame[]>

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
  const [h2h, setH2h] = useState<H2H>({})

  useEffect(() => {
    api<{ configured: boolean; data: Pick[]; meta: PicksMeta }>('/picks')
      .then((r) => { setConfigured(r.configured); setPicks(r.data); setMeta(r.meta ?? null) })
      .catch((e) => setError(e.message))
  }, [refreshKey])

  // Head-to-head: every listed player's recent games against tonight's opponent, fetched once the props are in.
  useEffect(() => {
    if (!picks?.length) return
    const pairs = [...new Set(picks.map((p) => { const o = opponentOf(p); return o ? `${p.playerId}:${o}` : '' }).filter(Boolean))].slice(0, 200)
    if (!pairs.length) return
    let live = true
    api<{ data: H2H }>(`/h2h?pairs=${pairs.join(',')}`).then((r) => live && setH2h(r.data)).catch(() => live && setH2h({}))
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

  // The page size resets whenever a filter changes, derived from the filters themselves rather than reset in an effect.
  const sig = `${stat}|${game}|${q}|${sort}|${positive}`
  const byGame = useMemo(() => {
    const m = new Map<string, { game: string; date: string; cards: Card[] }>()
    for (const c of cards) { const g = m.get(c.lead.game) ?? m.set(c.lead.game, { game: c.lead.game, date: c.lead.gameDate, cards: [] }).get(c.lead.game)!; g.cards.push(c) }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game))
  }, [cards])
  const [paged, setPaged] = useState({ sig, n: 60 })
  const limit = paged.sig === sig ? paged.n : 60
  const setLimit = (n: number) => setPaged({ sig, n })

  return (
    <div className="space-y-3">
      <div className="sticky top-12 z-10 -mx-3 space-y-2 border-b border-neutral-800/80 bg-neutral-950/90 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {STATS.map(([k, label]) => (
              <button key={k} onClick={() => setStat(k)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${stat === k ? 'bg-emerald-500 font-medium text-neutral-950' : 'bg-neutral-900 text-neutral-400 hover:text-neutral-100'}`}>
                {label}
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" aria-label="Search players"
            className="ml-auto w-44 rounded-full bg-neutral-900 px-3 py-1 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-emerald-500" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game" className="rounded-md bg-neutral-900 px-2 py-1 text-neutral-300">
            <option value="all">All games</option>
            {games.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" className="rounded-md bg-neutral-900 px-2 py-1 text-neutral-300">
            {SORTS.map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-neutral-400">
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
        <div className="space-y-5">
          {byGame.map((g) => <GameSection key={g.game} g={g} h2h={h2h} limit={limit} more={() => setLimit(limit + 60)} onOpenPlayer={onOpenPlayer} />)}
        </div>
      )}
    </div>
  )
}

function GameSection({ g, h2h, limit, more, onOpenPlayer }: { g: { game: string; date: string; cards: Card[] }; h2h: H2H; limit: number; more: () => void; onOpenPlayer: (id: number) => void }) {
  const [open, setOpen] = useState(true)
  const [away, home] = g.game.split(' @ ')
  const ids = [away, home].map((n) => teamByName(n))
  const players = new Set(g.cards.map((c) => c.lead.playerId)).size
  return (
    <section>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="mb-2 flex w-full items-center gap-2 text-left">
        {ids.map((t, i) => t && <img key={i} src={logoUrl(t[1])} alt="" className="h-6 w-6" loading="lazy" />)}
        <h2 className="text-sm font-medium text-neutral-100">{away} <span className="text-neutral-600">@</span> {home}</h2>
        <span className="text-xs text-neutral-500">{g.cards.length} props · {players} players</span>
        <span className="ml-auto text-xs text-neutral-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {g.cards.slice(0, limit).map((c) => <PropTile key={c.key} c={c} h2h={h2h} onOpenPlayer={onOpenPlayer} />)}
          {g.cards.length > limit && (
            <button onClick={more} className="rounded-xl border border-dashed border-neutral-800 py-6 text-xs text-neutral-500 hover:text-neutral-200">Show more of {g.cards.length - limit}</button>
          )}
        </div>
      )}
    </section>
  )
}

function H2HLine({ p, rows }: { p: Pick; rows: H2HGame[] | undefined }) {
  const opp = opponentOf(p)
  if (!opp) return null
  if (!rows?.length) return <div className="px-3 pb-2 text-[11px] text-neutral-700">vs {opp}: no earlier games</div>
  const vals = rows.map((r) => r[p.stat as 'pts' | 'reb' | 'ast' | 'fg3m'])
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const landed = vals.filter((v) => (p.side === 'over' ? v > p.line : v < p.line)).length
  return (
    <div className="flex items-center gap-2 px-3 pb-2 text-[11px] tabular-nums text-neutral-500" title={rows.map((r) => `${r.date}: ${r[p.stat as 'pts']}`).join(' · ')}>
      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">vs {opp}</span>
      <span>{rows.length} gm{rows.length === 1 ? '' : 's'} · avg {avg.toFixed(1)}</span>
      <span className={landed * 2 >= rows.length ? 'text-emerald-400' : 'text-neutral-500'}>{landed}/{rows.length} {p.side}</span>
      <span className="ml-auto flex gap-0.5">
        {vals.slice().reverse().map((v, i) => <span key={i} className={`h-3 w-1.5 rounded-sm ${(p.side === 'over' ? v > p.line : v < p.line) ? 'bg-emerald-500' : 'bg-neutral-700'}`} />)}
      </span>
    </div>
  )
}

const H2H_STATS = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM']] as const

/** Every stat in the earlier meetings with tonight's opponent, newest first; the stat this card is about is highlighted. */
function H2HAll({ p, rows }: { p: Pick; rows: H2HGame[] | undefined }) {
  const opp = opponentOf(p)
  if (!opp || !rows?.length) return null
  return (
    <div className="border-t border-neutral-800 px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-neutral-500">{p.player.split(' ').pop()} vs {opp}, last {rows.length}</div>
      <table className="w-full text-[11px] tabular-nums">
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
                  const ok = mine && (p.side === 'over' ? r[k] > p.line : r[k] < p.line)
                  return <td key={r.date} className={`px-1 text-right ${ok ? 'text-emerald-400' : ''}`}>{r[k]}</td>
                })}
                <td className="pl-2 text-right font-medium">{(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PropTile({ c, h2h, onOpenPlayer }: { c: Card; h2h: H2H; onOpenPlayer: (id: number) => void }) {
  const p = c.lead
  const [open, setOpen] = useState(false)
  const tid = teamId(p.team)
  const h = hit(c)
  return (
    <div className="lift overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <div className="flex items-center gap-2 px-3 pt-2">
        <button onClick={() => onOpenPlayer(p.playerId)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Open player">
          <Headshot id={p.playerId} name={p.player} size={42} />
          <span className="min-w-0 leading-tight">
            <span className="flex items-center gap-1.5 truncate text-sm text-neutral-100">{p.player}<InjuryTag injury={p.injury} /></span>
            <span className="flex items-center gap-1 text-[11px] text-neutral-500">
              {tid && <img src={logoUrl(tid)} alt="" className="h-3.5 w-3.5" loading="lazy" />}{p.team}
            </span>
            <RoleTag role={p.role} />
          </span>
        </button>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">{STAT_LABEL[p.stat]}</div>
          <div className="text-xl font-semibold tabular-nums text-neutral-100">{p.line}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 px-3 pt-2">
        {([['over', c.over], ['under', c.under]] as const).map(([side, x]) => (
          <div key={side} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${x && x === p && x.ev > 0 ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'bg-neutral-800/70'}`}>
            <span className="text-xs">
              <span className="text-neutral-400">{side === 'over' ? 'Over' : 'Under'}</span>
              <span className="block text-[10px] tabular-nums text-neutral-600">{x ? `${x.book} · ${pct(x.prob)}` : 'not posted'}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-medium tabular-nums text-neutral-100">{x ? x.price.toFixed(2) : '–'}</span>
              {x && <SlipButton pick={x} />}
            </span>
          </div>
        ))}
      </div>

      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left" title="Show the last games large">
        <PickSpark p={p} w={120} h={30} />
        <span className="ml-auto grid grid-cols-3 gap-x-3 text-right text-[11px] tabular-nums">
          <Stat label="Proj" value={fmt(p.projection)} />
          <Stat label="L10" value={h < 0 ? '–' : `${Math.round(h * 100)}%`} />
          <Stat label="Edge" value={`${p.ev > 0 ? '+' : ''}${(p.ev * 100).toFixed(1)}%`} tone={p.ev > 0 ? 'text-emerald-400' : 'text-neutral-400'} />
        </span>
      </button>
      <H2HLine p={p} rows={h2h[`${p.playerId}:${opponentOf(p)}`]} />
      {open && <><div className="border-t border-neutral-800 px-1 pb-2"><PickBars p={p} /></div><H2HAll p={p} rows={h2h[`${p.playerId}:${opponentOf(p)}`]} /></>}
    </div>
  )
}

function Stat({ label, value, tone = 'text-neutral-200' }: { label: string; value: string; tone?: string }) {
  return <span><span className="block text-[9px] uppercase tracking-wider text-neutral-600">{label}</span><span className={tone}>{value}</span></span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{children}</p>
}
