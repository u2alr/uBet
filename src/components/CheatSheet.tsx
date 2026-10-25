import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/format'
import { LADDER, STAT_NAME, SORTS, bestStreak, sortRows, type CheatStat, type RecentGame, type Row, type SortKey } from '../lib/cheatSheet'
import { normAbbr } from '../lib/propsBoard'
import { teamId } from '../lib/teams'
import { InjuryTag } from './Availability'
import Headshot from './Headshot'
import TeamLogo from './TeamLogo'
import type { Injury } from '../../shared/injuries'

interface Player { id: number; name: string; team: string | null; gameDate: string; injury: Injury | null; games: RecentGame[] }
interface Game { id: string; date: string; state: 'pre' | 'in' | 'post'; home: { abbr: string }; away: { abbr: string } }

const STATS: CheatStat[] = ['pts', 'reb', 'ast', 'fg3m', 'pra']
const STAT_LONG: Record<CheatStat, string> = { pts: 'Points', reb: 'Rebounds', ast: 'Assists', fg3m: 'Threes', pra: 'PRA' }
const WINDOWS = [3, 5, 10] as const
const RATES = [[1, 'Every game'], [0.8, '80% or better'], [0.7, '70% or better']] as const
const PAGE = 48

/** Cheat sheet: for each player with a game coming up, the highest threshold they cleared in their last N games ("15+ PTS, 3/3 in the last 3"). History only. */
export default function CheatSheet({ refreshKey, onOpenPlayer }: { refreshKey: number; onOpenPlayer: (id: number) => void }) {
  const [players, setPlayers] = useState<Player[] | null>(null)
  const [games, setGames] = useState<Game[]>([])
  const [error, setError] = useState('')
  const [stat, setStat] = useState<CheatStat>('pts')
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(5)
  const [rate, setRate] = useState<number>(1)
  const [minMinutes, setMinMinutes] = useState(15)
  const [sort, setSort] = useState<SortKey>('level')
  const [team, setTeam] = useState('all')
  const [q, setQ] = useState('')

  useEffect(() => {
    api<{ data: Player[] }>('/cheatsheet').then((r) => setPlayers(r.data)).catch((e) => setError(e.message))
    api<{ data: Game[] }>('/games').then((r) => setGames(r.data)).catch(() => {})
  }, [refreshKey])

  const next = useMemo(() => {
    const m = new Map<string, { opp: string; home: boolean; date: string }>()
    for (const g of [...games].filter((x) => x.state === 'pre').sort((a, b) => a.date.localeCompare(b.date))) {
      const h = normAbbr(g.home.abbr), a = normAbbr(g.away.abbr)
      if (!m.has(h)) m.set(h, { opp: a, home: true, date: g.date })
      if (!m.has(a)) m.set(a, { opp: h, home: false, date: g.date })
    }
    return m
  }, [games])

  const teams = useMemo(() => [...new Set((players ?? []).map((p) => p.team).filter((t): t is string => !!t))].sort(), [players])
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const out: Row[] = []
    for (const p of players ?? []) {
      if ((team !== 'all' && p.team !== team) || (term && !p.name.toLowerCase().includes(term))) continue
      const s = bestStreak(p.games, stat, window, rate)
      if (s && s.minutes >= minMinutes) out.push({ playerId: p.id, player: p.name, team: p.team, streak: s })
    }
    return sortRows(out, sort)
  }, [players, stat, window, rate, minMinutes, sort, team, q])

  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players])
  const sig = `${stat}|${window}|${rate}|${minMinutes}|${sort}|${team}|${q}`
  const [page, setPage] = useState({ sig, n: PAGE })
  const limit = page.sig === sig ? page.n : PAGE

  const ctl = 'rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500'
  const seg = (active: boolean) => `rounded-md px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${active ? 'bg-neutral-700 text-neutral-50' : 'text-neutral-400 hover:text-neutral-200'}`
  return (
    <div className="space-y-4">
      <div role="search" className="z-10 -mx-3 border-b border-neutral-800/80 bg-neutral-950/95 px-3 py-2 backdrop-blur sm:sticky sm:top-12 sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div role="group" aria-label="Statistic" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STATS.map((s) => (
              <button key={s} onClick={() => setStat(s)} aria-pressed={stat === s}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${stat === s ? 'bg-emerald-500 font-medium text-neutral-950' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'}`}>{STAT_LONG[s]}</button>
            ))}
          </div>
          <div role="group" aria-label="Number of recent games" className="flex rounded-lg bg-neutral-900 p-0.5">
            {WINDOWS.map((w) => <button key={w} onClick={() => setWindow(w)} aria-pressed={window === w} className={seg(window === w)}>Last {w}</button>)}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <label className="sr-only" htmlFor="cs-rate">Hit rate</label>
            <select id="cs-rate" value={rate} onChange={(e) => setRate(Number(e.target.value))} className={ctl}>{RATES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
            <label className="sr-only" htmlFor="cs-min">Minutes</label>
            <select id="cs-min" value={minMinutes} onChange={(e) => setMinMinutes(Number(e.target.value))} className={ctl} title="Average minutes over the window: filters out bench cameos">
              <option value={0}>Any minutes</option><option value={15}>15+ min</option><option value={20}>20+ min</option><option value={28}>28+ min</option>
            </select>
            <label className="sr-only" htmlFor="cs-team">Team</label>
            <select id="cs-team" value={team} onChange={(e) => setTeam(e.target.value)} className={ctl}><option value="all">All teams</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <label className="sr-only" htmlFor="cs-sort">Sort by</label>
            <select id="cs-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={ctl}>{SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}</select>
            <label className="sr-only" htmlFor="cs-q">Search players</label>
            <input id="cs-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" className={`${ctl} w-40 placeholder:text-neutral-600`} />
          </div>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        Players with a game coming up, and the highest {STAT_NAME[stat]} threshold they reached in {rate === 1 ? 'every one' : `at least ${Math.round(rate * 100)}%`} of their last {window} games (for example {LADDER[stat][4]}+).
        This is history only: it ignores the opponent, minutes tonight and the book's price, and a streak is not an edge. Check the line before betting.
        <span className="ml-2 tabular-nums text-neutral-600" aria-live="polite">{players ? `${rows.length} players` : ''}</span>
      </p>

      {error && <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{error}</p>}
      {!players && !error ? <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading…</p> : rows.length === 0 && players ? (
        <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">No players match. Try fewer games, a lower hit-rate bar, or a lower minutes filter. Players need a projection for an upcoming game and at least {window} games on record.</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {rows.slice(0, limit).map((r) => <StreakCard key={r.playerId} r={r} player={byId.get(r.playerId)!} next={r.team ? next.get(r.team) : undefined} onOpen={() => onOpenPlayer(r.playerId)} />)}
          </ul>
          {rows.length > limit && <button onClick={() => setPage({ sig, n: limit + PAGE })} className="w-full rounded-xl border border-dashed border-neutral-800 py-3 text-sm text-neutral-500 hover:text-neutral-200">Show more ({rows.length - limit} left)</button>}
        </>
      )}
    </div>
  )
}

function StreakCard({ r, player, next, onOpen }: { r: Row; player: Player; next?: { opp: string; home: boolean; date: string }; onOpen: () => void }) {
  const s = r.streak
  const top = Math.max(s.threshold, ...s.values) * 1.1 || 1
  const tid = teamId(r.team)
  const oppId = next ? teamId(next.opp) : null
  return (
    <li className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 190px' }}>
      <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500" aria-label={`Open ${r.player}`}>
        <Headshot id={r.playerId} name={r.player} size={44} />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="flex items-center gap-1.5 text-base font-medium text-neutral-50"><span className="truncate">{r.player}</span><InjuryTag injury={player.injury} /></span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            {tid && <TeamLogo id={tid} abbr={r.team ?? ''} size={14} />}<span>{r.team}</span>
            {next && <><span className="text-neutral-600">{next.home ? 'vs' : '@'}</span>{oppId && <TeamLogo id={oppId} abbr={next.opp} size={14} />}<span>{next.opp}</span><span className="text-neutral-600">·</span><span>{new Date(next.date).toLocaleTimeString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span></>}
          </span>
        </span>
      </button>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="leading-none">
          <div className="text-3xl font-semibold tabular-nums text-neutral-50">{s.threshold}+ <span className="text-base font-medium text-neutral-400">{STAT_NAME[s.stat]}</span></div>
          <div className={`mt-1.5 text-sm tabular-nums ${s.hits === s.games ? 'text-emerald-400' : 'text-neutral-300'}`}>{s.hits}/{s.games} <span className="text-neutral-500">in the last {s.games}</span></div>
        </div>
        <svg width={Math.max(64, s.values.length * 14)} height={44} role="img" aria-label={`Last ${s.values.length} games, oldest first: ${s.values.join(', ')}`}>
          {s.values.map((v, i) => { const h = Math.max(2, (v / top) * 40); return <rect key={i} x={i * 14} y={44 - h} width={11} height={h} rx={2} className={v >= s.threshold ? 'fill-emerald-500' : 'fill-neutral-600'} /> })}
          <line x1={0} x2={s.values.length * 14} y1={44 - (s.threshold / top) * 40} y2={44 - (s.threshold / top) * 40} stroke="#a3a3a3" strokeDasharray="2 2" strokeOpacity={0.7} />
        </svg>
      </div>
      <p className="mt-2 flex gap-x-4 text-xs tabular-nums text-neutral-500"><span>avg {s.average.toFixed(1)}</span><span>{s.minutes.toFixed(0)} min</span><span title="Values, oldest first">{s.values.join(' · ')}</span></p>
    </li>
  )
}
