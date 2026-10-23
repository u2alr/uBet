import { useMemo, useState } from 'react'
import type { Stat } from '../../shared/baseline'
import { STAT_LABEL, fmt } from '../lib/format'
import type { Pick } from '../lib/picks'
import type { GameRow } from '../lib/stats'
import { logoUrl, teamByName, teamId } from '../lib/teams'

// A player against one opponent: every meeting in the box scores we hold, with all four props side by side.
const STATS = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['pra', 'PRA']] as const
type Key = (typeof STATS)[number][0]
const val = (g: GameRow, k: Key | 'minutes'): number => (k === 'pra' ? g.pts + g.reb + g.ast : g[k])

/** Tonight's opponent, read from the player's posted props ("Away @ Home"). */
function tonightsOpponent(picks: Pick[]): string | null {
  const p = picks[0]
  if (!p) return null
  const [away, home] = p.game.split(' @ ')
  const other = p.teamName === away ? home : p.teamName === home ? away : null
  return other ? teamByName(other)?.[0] ?? null : null
}

export default function PlayerH2H({ games, picks, stat, line }: { games: GameRow[]; picks: Pick[]; stat: Stat; line: number | null }) {
  const real = useMemo(() => games.filter((g) => g.opp && g.gameType !== 'preseason' && g.minutes > 0), [games])
  const opps = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of real) m.set(g.opp!, (m.get(g.opp!) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [real])
  const tonight = tonightsOpponent(picks)
  const [pick, setPick] = useState<string | null>(null)
  const opp = pick ?? (tonight && opps.some(([o]) => o === tonight) ? tonight : tonight ?? real[0]?.opp ?? null)
  // Season filter: every season this player has faced this opponent, newest first. "All" is the default.
  const [season, setSeason] = useState<'all' | number>('all')
  const vsOpp = real.filter((g) => g.opp === opp)           // newest first, as the log arrives
  const seasons = [...new Set(vsOpp.map((g) => g.season))].sort((a, b) => b - a)
  const activeSeason = season !== 'all' && seasons.includes(season) ? season : 'all'
  const rows = activeSeason === 'all' ? vsOpp : vsOpp.filter((g) => g.season === activeSeason)
  if (opps.length === 0) return null

  const mine: Key = STATS.some(([k]) => k === stat) ? (stat as Key) : 'pts'
  const avg = (k: Key | 'minutes') => (rows.length ? rows.reduce((a, g) => a + val(g, k), 0) / rows.length : null)
  const landed = (v: number, over: boolean) => (over ? v > (line ?? Infinity) : v < (line ?? -Infinity))
  const overs = line == null ? null : rows.filter((g) => landed(val(g, mine), true)).length
  const unders = line == null ? null : rows.filter((g) => landed(val(g, mine), false)).length
  const tid = opp ? teamId(opp) : null
  const top = Math.max(1, ...rows.map((g) => val(g, mine)), line ?? 0)

  return (
    <section className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {tid && <img src={logoUrl(tid)} alt="" className="h-9 w-9" />}
        <h3 className="text-lg font-semibold text-neutral-100">Head-to-head{opp ? ` vs ${opp}` : ''}</h3>
        {tonight && opp === tonight && <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">tonight's opponent</span>}
        <select value={opp ?? ''} onChange={(e) => { setPick(e.target.value); setSeason('all') }} aria-label="Opponent" className="ml-auto rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300">
          {opps.map(([o, n]) => <option key={o} value={o}>{o} ({n})</option>)}
        </select>
        <select value={activeSeason} onChange={(e) => setSeason(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Season" className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300">
          <option value="all">All seasons</option>
          {seasons.map((y) => <option key={y} value={y}>{y}-{String(y + 1).slice(2)} ({vsOpp.filter((g) => g.season === y).length})</option>)}
        </select>
      </div>

      {rows.length === 0 ? <p className="text-sm text-neutral-500">No games against {opp} in the box scores{activeSeason === 'all' ? ' yet' : ' for that season'}.</p> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Tile label="Meetings" value={String(rows.length)} />
            <Tile label="Minutes" value={fmt(avg('minutes'))} />
            {STATS.map(([k, label]) => <Tile key={k} label={`${label} avg`} value={fmt(avg(k))} hot={k === mine} />)}
          </div>
          {line != null && overs != null && unders != null && (
            <p className="text-sm text-neutral-400">
              {STAT_LABEL[mine]} against {line}: <b className="text-emerald-400">{overs} over</b> · <b className="text-neutral-200">{unders} under</b>
              {rows.length - overs - unders > 0 && <> · {rows.length - overs - unders} exactly on the line</>} in {rows.length}
            </p>
          )}

          {/* One bar per meeting for the chosen stat, oldest on the left; green bars cleared the line. */}
          <div className="flex h-28 items-end gap-1.5 rounded-xl bg-neutral-950/60 px-3 pb-2 pt-2" role="img" aria-label={`${STAT_LABEL[mine]} in each meeting`}>
            {rows.slice().reverse().map((g) => (
              <div key={g.date} className="flex h-full flex-1 flex-col items-center justify-end" title={`${g.date}: ${val(g, mine)}`}>
                <span className="mb-0.5 text-[10px] tabular-nums text-neutral-400">{val(g, mine)}</span>
                <div className={`w-full max-w-8 rounded-t ${line != null && val(g, mine) > line ? 'bg-emerald-500' : 'bg-neutral-600'}`} style={{ height: `${Math.max(3, (val(g, mine) / top) * 70)}%` }} />
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm tabular-nums">
              <thead className="text-left text-xs text-neutral-500">
                <tr><th className="py-1 font-normal">Date</th><th className="font-normal">Where</th><th className="font-normal">Result</th><th className="text-right font-normal">MIN</th>
                  {STATS.map(([k, label]) => <th key={k} className={`text-right font-normal ${k === mine ? 'text-emerald-400' : ''}`}>{label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 12).map((g) => (
                  <tr key={g.date} className="border-t border-neutral-800 text-neutral-300">
                    <td className="py-1">{g.date}</td>
                    <td className="text-neutral-500">{g.home ? 'Home' : 'Away'}</td>
                    <td className={g.won ? 'text-emerald-400' : 'text-neutral-500'}>{g.won ? 'W' : 'L'}</td>
                    <td className="text-right text-neutral-500">{Math.round(g.minutes)}</td>
                    {STATS.map(([k]) => <td key={k} className={`text-right ${k === mine ? (line != null && val(g, k) > line ? 'font-medium text-emerald-400' : 'font-medium text-neutral-100') : ''}`}>{val(g, k)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function Tile({ label, value, hot = false }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${hot ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30' : 'bg-neutral-800/60'}`}>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-neutral-100">{value}</div>
    </div>
  )
}
