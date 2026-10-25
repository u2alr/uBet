import type { Pick } from '../lib/picks'
import { opponentOf } from '../lib/propsBoard'

import { h2hValue, type H2HGame } from '../lib/h2hView'

const landed = (p: Pick, v: number) => (p.side === 'over' ? v > p.line : v < p.line)

/** One line: how the player has done against tonight's opponent on this stat, with a bar per meeting. */
export function H2HSummary({ p, rows, failed }: { p: Pick; rows: H2HGame[] | undefined; failed: boolean }) {
  const opp = opponentOf(p)
  if (!opp) return null
  if (failed) return <p className="text-xs text-amber-500/80">vs {opp}: head-to-head unavailable right now</p>
  if (!rows) return <p className="text-xs text-neutral-600">vs {opp}: loading…</p>
  if (!rows.length) return <p className="text-xs text-neutral-600">vs {opp}: no earlier games</p>
  const vals = rows.map((r) => h2hValue(r, p.stat))
  const n = vals.filter((v) => landed(p, v)).length
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-neutral-400" title={rows.map((r) => `${r.date}: ${h2hValue(r, p.stat)}`).join(' · ')}>
      <span className="text-neutral-200">vs {opp}</span>
      <span>{rows.length} game{rows.length === 1 ? '' : 's'}, avg {(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}</span>
      <span className={n * 2 >= rows.length ? 'text-emerald-400' : ''}>{n} of {rows.length} on the {p.side}</span>
      <span className="ml-auto flex gap-0.5" aria-hidden>{vals.slice().reverse().map((v, i) => <span key={i} className={`h-3 w-1.5 rounded-sm ${landed(p, v) ? 'bg-emerald-500' : 'bg-neutral-700'}`} />)}</span>
    </p>
  )
}

const COLS = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['pra', 'PRA']] as const

/** Every stat across the earlier meetings with tonight's opponent, newest first. The stat this card is about is highlighted. */
export function H2HTable({ p, rows }: { p: Pick; rows: H2HGame[] | undefined }) {
  const opp = opponentOf(p)
  if (!opp || !rows?.length) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums sm:text-sm">
        <caption className="pb-1 text-left text-xs text-neutral-500">Last {rows.length} against {opp}, newest first</caption>
        <thead className="text-neutral-500">
          <tr><th scope="col" className="text-left font-normal"><span className="sr-only">Stat</span></th>{rows.map((r) => <th scope="col" key={r.date} className="px-1 text-right font-normal">{r.date.slice(5)}</th>)}<th scope="col" className="pl-2 text-right font-normal">Avg</th></tr>
        </thead>
        <tbody>
          <tr className="text-neutral-500"><th scope="row" className="text-left font-normal">MIN</th>{rows.map((r) => <td key={r.date} className="px-1 text-right">{Math.round(r.minutes)}</td>)}<td className="pl-2 text-right">{Math.round(rows.reduce((a, r) => a + r.minutes, 0) / rows.length)}</td></tr>
          {COLS.map(([k, label]) => {
            const mine = k === p.stat
            return (
              <tr key={k} className={mine ? 'text-neutral-100' : 'text-neutral-400'}>
                <th scope="row" className={`text-left font-normal ${mine ? 'text-emerald-400' : ''}`}>{label}</th>
                {rows.map((r) => <td key={r.date} className={`px-1 text-right ${mine && landed(p, h2hValue(r, k)) ? 'text-emerald-400' : ''}`}>{h2hValue(r, k)}</td>)}
                <td className="pl-2 text-right font-medium">{(rows.reduce((a, r) => a + h2hValue(r, k), 0) / rows.length).toFixed(1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
