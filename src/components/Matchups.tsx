import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/format'
import { LADDER, STAT_NAME, bestStreak, gameValue, type CheatStat, type RecentGame } from '../lib/cheatSheet'
import { normAbbr } from '../lib/propsBoard'
import { teamId } from '../lib/teams'
import type { Injury } from '../../shared/injuries'
import { InjuryTag } from './Availability'
import { MatchupContext } from './DefensiveMatchup'
import Headshot from './Headshot'
import TeamLogo from './TeamLogo'

interface Player { id: number; name: string; team: string | null; gameDate: string; injury: Injury | null; games: RecentGame[] }
interface Game { id: string; date: string; state: 'pre' | 'in' | 'post'; home: { abbr: string }; away: { abbr: string } }
interface Absence { id: number; name: string; team: string | null; status: 'out' | 'doubtful' | 'questionable' }
type H2H = Record<string, RecentGame[]>
interface Row { p: Player; opp: string; home: boolean; date: string; stat: CheatStat; threshold: number; hits10: number; n10: number; hits5: number; n5: number; values: number[]; avg: number; minutes: number }

const STATS: CheatStat[] = ['pts', 'reb', 'ast', 'fg3m', 'pra']
const STAT_LONG: Record<CheatStat, string> = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', fg3m: 'Threes', pra: 'PRA' }
const SORTS = [['tip', 'Tip-off'], ['rate', 'Hit rate'], ['name', 'Player A to Z']] as const
const PAGE = 24

/**
 * Matchups: per player, how often he has cleared a threshold recently (hit rate), how he has done against tonight's opponent, and the defensive and offensive context around the game.
 * It needs no sportsbook line. The threshold is the highest one he cleared in at least `rate` of his last 10 games, so it describes history, not a price.
 */
export default function Matchups({ refreshKey, onOpenPlayer }: { refreshKey: number; onOpenPlayer: (id: number) => void }) {
  const [players, setPlayers] = useState<Player[] | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [absent, setAbsent] = useState<Absence[]>([])
  const [error, setError] = useState('')
  const [stat, setStat] = useState<CheatStat>('pts')
  const [rate, setRate] = useState(0.7)
  const [game, setGame] = useState('all')
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>('tip')
  const [q, setQ] = useState('')
  const [n, setN] = useState(PAGE)
  const [h2h, setH2h] = useState<{ key: string; data: H2H } | null>(null)

  useEffect(() => {
    api<{ data: Player[] }>('/cheatsheet').then((r) => setPlayers(r.data)).catch((e) => setError(e.message))
    api<{ data: Game[] }>('/games').then((r) => setGames(r.data)).catch(() => {})
    api<{ data: Absence[] }>('/absences').then((r) => setAbsent(r.data)).catch(() => setAbsent([]))
  }, [refreshKey])

  const next = useMemo(() => {
    const m = new Map<string, { opp: string; home: boolean; date: string; label: string }>()
    for (const g of [...games].filter((x) => x.state === 'pre').sort((a, b) => a.date.localeCompare(b.date))) {
      const h = normAbbr(g.home.abbr), a = normAbbr(g.away.abbr)
      if (!m.has(h)) m.set(h, { opp: a, home: true, date: g.date, label: `${a} @ ${h}` })
      if (!m.has(a)) m.set(a, { opp: h, home: false, date: g.date, label: `${a} @ ${h}` })
    }
    return m
  }, [games])
  const matchups = useMemo(() => [...new Set([...next.values()].map((v) => v.label))], [next])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const out: Row[] = []
    for (const p of players ?? []) {
      const nx = p.team ? next.get(p.team) : undefined
      if (!nx || (game !== 'all' && nx.label !== game) || (term && !p.name.toLowerCase().includes(term))) continue
      const s = bestStreak(p.games, stat, Math.min(10, p.games.length), rate)
      if (!s || s.games < 5 || s.minutes < 15) continue
      const five = p.games.slice(0, 5).map((g) => gameValue(g, stat))
      out.push({ p, opp: nx.opp, home: nx.home, date: nx.date, stat, threshold: s.threshold, hits10: s.hits, n10: s.games, hits5: five.filter((v) => v >= s.threshold).length, n5: five.length, values: s.values, avg: s.average, minutes: s.minutes })
    }
    return out.sort((a, b) => (sort === 'name' ? a.p.name.localeCompare(b.p.name) : sort === 'rate' ? b.hits10 / b.n10 - a.hits10 / a.n10 || b.threshold - a.threshold : a.date.localeCompare(b.date) || a.p.name.localeCompare(b.p.name)))
  }, [players, next, stat, rate, game, q, sort])

  const shown = rows.slice(0, n)
  const pairs = shown.map((r) => `${r.p.id}:${r.opp}`)
  const pairKey = pairs.join(',')
  useEffect(() => {
    if (!pairs.length) return
    let live = true
    api<{ data: H2H }>(`/h2h?pairs=${pairKey}`).then((r) => live && setH2h({ key: pairKey, data: r.data })).catch(() => {})
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- pairKey is the stable form of pairs
  }, [pairKey])

  const ctl = 'rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
  return (
    <div className="space-y-4">
      <div role="search" className="z-10 -mx-3 border-b border-neutral-800/80 bg-neutral-950/95 px-3 py-2 backdrop-blur sm:sticky sm:top-12 sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div role="group" aria-label="Statistic" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STATS.map((s) => (
              <button key={s} onClick={() => { setStat(s); setN(PAGE) }} aria-pressed={stat === s}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${stat === s ? 'bg-emerald-500 font-medium text-neutral-950' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'}`}>{STAT_LONG[s]}</button>
            ))}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <label className="sr-only" htmlFor="mu-rate">Hit rate in the last 10</label>
            <select id="mu-rate" value={rate} onChange={(e) => { setRate(Number(e.target.value)); setN(PAGE) }} className={ctl}><option value={0.9}>90%+ of last 10</option><option value={0.8}>80%+ of last 10</option><option value={0.7}>70%+ of last 10</option><option value={0.6}>60%+ of last 10</option></select>
            <label className="sr-only" htmlFor="mu-game">Game</label>
            <select id="mu-game" value={game} onChange={(e) => { setGame(e.target.value); setN(PAGE) }} className={`${ctl} max-w-[11rem] truncate`}><option value="all">All games</option>{matchups.map((g) => <option key={g} value={g}>{g}</option>)}</select>
            <label className="sr-only" htmlFor="mu-sort">Sort by</label>
            <select id="mu-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={ctl}>{SORTS.map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}</select>
            <label className="sr-only" htmlFor="mu-q">Search players</label>
            <input id="mu-q" type="search" value={q} onChange={(e) => { setQ(e.target.value); setN(PAGE) }} placeholder="Search players" className={`${ctl} w-40 placeholder:text-neutral-600`} />
          </div>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        For each player with a game coming up: the highest {STAT_NAME[stat]} threshold he cleared in at least {Math.round(rate * 100)}% of his last 10 (for example {LADDER[stat][4]}+), how he has done against tonight's opponent, and the defensive and offensive context.
        No sportsbook line is involved, and a hit rate is history, not an edge. Matchup context is descriptive: in testing, team-level defence helped slightly but is not yet used in predictions, and the individual-defender and likely-matchup estimates did not pass.
        <span className="ml-2 tabular-nums text-neutral-600" aria-live="polite">{players ? `${rows.length} players` : ''}</span>
      </p>

      {error && <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{error}</p>}
      {!players && !error ? <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading…</p> : rows.length === 0 && players ? (
        <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">No players match. Try a lower hit-rate bar or another statistic. Players need a game on the schedule and at least 5 recent games.</p>
      ) : (
        <>
          <ul className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((r) => <MatchupCard key={`${r.p.id}-${r.stat}`} r={r} meetings={h2h?.key === pairKey ? h2h.data[`${r.p.id}:${r.opp}`] ?? [] : undefined} out={absent.filter((a) => a.team === r.p.team && a.id !== r.p.id && a.status === 'out')} onOpen={() => onOpenPlayer(r.p.id)} />)}
          </ul>
          {rows.length > n && <button onClick={() => setN(n + PAGE)} className="w-full rounded-xl border border-dashed border-neutral-800 py-3 text-sm text-neutral-500 hover:text-neutral-200">Show more ({rows.length - n} left)</button>}
        </>
      )}
    </div>
  )
}

function MatchupCard({ r, meetings, out, onOpen }: { r: Row; meetings?: RecentGame[]; out: Absence[]; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  const tid = teamId(r.p.team), oppId = teamId(r.opp)
  const top = Math.max(r.threshold, ...r.values) * 1.1 || 1
  const vs = meetings?.map((g) => gameValue(g, r.stat))
  const vsHits = vs?.filter((v) => v >= r.threshold).length
  return (
    <li className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
      <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500" aria-label={`Open ${r.p.name}`}>
        <Headshot id={r.p.id} name={r.p.name} size={44} />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="flex items-center gap-1.5 text-base font-medium text-neutral-50"><span className="truncate">{r.p.name}</span><InjuryTag injury={r.p.injury} /></span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            {tid && <TeamLogo id={tid} abbr={r.p.team ?? ''} size={14} />}<span>{r.p.team}</span><span className="text-neutral-600">{r.home ? 'vs' : '@'}</span>{oppId && <TeamLogo id={oppId} abbr={r.opp} size={14} />}<span>{r.opp}</span>
            <span className="text-neutral-600">·</span><span>{new Date(r.date).toLocaleTimeString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
          </span>
        </span>
      </button>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="leading-none">
          <div className="text-3xl font-semibold tabular-nums text-neutral-50">{r.threshold}+ <span className="text-base font-medium text-neutral-400">{STAT_NAME[r.stat]}</span></div>
          <div className="mt-1.5 text-sm tabular-nums text-neutral-300">{r.hits10}/{r.n10} <span className="text-neutral-500">last {r.n10}</span> · {r.hits5}/{r.n5} <span className="text-neutral-500">last {r.n5}</span></div>
        </div>
        <svg width={Math.max(64, r.values.length * 14)} height={44} role="img" aria-label={`Last ${r.values.length} games, oldest first: ${r.values.join(', ')}`}>
          {r.values.map((v, i) => { const h = Math.max(2, (v / top) * 40); return <rect key={i} x={i * 14} y={44 - h} width={11} height={h} rx={2} className={v >= r.threshold ? 'fill-emerald-500' : 'fill-neutral-600'} /> })}
          <line x1={0} x2={r.values.length * 14} y1={44 - (r.threshold / top) * 40} y2={44 - (r.threshold / top) * 40} stroke="#a3a3a3" strokeDasharray="2 2" strokeOpacity={0.7} />
        </svg>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-neutral-500">
        <span>avg {r.avg.toFixed(1)}</span><span>{r.minutes.toFixed(0)} min</span>
        <span>{vs === undefined ? 'vs ' + r.opp + ': loading…' : vs.length ? `vs ${r.opp}: ${vsHits}/${vs.length} at ${r.threshold}+, avg ${(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(1)}` : `vs ${r.opp}: no earlier meetings on record`}</span>
      </p>
      {out.length > 0 && <p className="mt-1.5 text-xs text-red-300/90">Teammates listed out: {out.slice(0, 4).map((a) => a.name).join(', ')}{out.length > 4 ? '…' : ''}. Minutes and usage may shift; the history above does not account for it.</p>}
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 text-sm text-emerald-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">{open ? 'Hide matchup context' : 'Defensive & offensive context'}</button>
      {open && <div className="mt-2"><MatchupContext playerId={r.p.id} opp={r.opp} stat={r.stat} own={r.p.team} /></div>}
    </li>
  )
}
