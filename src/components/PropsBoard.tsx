import { useEffect, useMemo, useState } from 'react'
import type { PicksMeta } from '../../shared/picks.ts'
import { STAT_LABEL, api, fmt, pct } from '../lib/format'
import type { Pick } from '../lib/picks'
import { logoUrl, teamId } from '../lib/teams'
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

  useEffect(() => {
    api<{ configured: boolean; data: Pick[]; meta: PicksMeta }>('/picks')
      .then((r) => { setConfigured(r.configured); setPicks(r.data); setMeta(r.meta ?? null) })
      .catch((e) => setError(e.message))
  }, [refreshKey])

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
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {cards.slice(0, limit).map((c) => <PropTile key={c.key} c={c} onOpenPlayer={onOpenPlayer} />)}
          </div>
          {cards.length > limit && (
            <button onClick={() => setLimit(limit + 60)} className="mx-auto block rounded-full bg-neutral-900 px-4 py-1.5 text-xs text-neutral-300 hover:text-neutral-100">
              Show {Math.min(60, cards.length - limit)} more of {cards.length - limit}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function PropTile({ c, onOpenPlayer }: { c: Card; onOpenPlayer: (id: number) => void }) {
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
              {tid && <img src={logoUrl(tid)} alt="" className="h-3.5 w-3.5" loading="lazy" />}{p.team} · {p.game.split(' @ ').map((t) => t.split(' ').pop()).join(' @ ')}
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
      {open && <div className="border-t border-neutral-800 px-1 pb-2"><PickBars p={p} /></div>}
    </div>
  )
}

function Stat({ label, value, tone = 'text-neutral-200' }: { label: string; value: string; tone?: string }) {
  return <span><span className="block text-[9px] uppercase tracking-wider text-neutral-600">{label}</span><span className={tone}>{value}</span></span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{children}</p>
}
