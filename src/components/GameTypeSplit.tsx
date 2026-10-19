import type { Stat } from '../../shared/baseline'
import { STAT_LABEL, fmt, pct } from '../lib/format'
import { mean, type GameRow } from '../lib/stats'

const TYPES = [
  ['regular', 'Regular season', 'Full weight in the projection'],
  ['playoffs', 'Playoffs', 'Full weight only for playoff games, 60% otherwise'],
  ['preseason', 'Preseason', '30% weight: minutes and rotations are unreliable'],
] as const

/** Side-by-side look at how the same player performs in each kind of game. */
export default function GameTypeSplit({ games, stat, line }: { games: GameRow[]; stat: Stat; line: number | null }) {
  const rows = TYPES.map(([type, label, note]) => {
    const g = games.filter((x) => x.gameType === type)
    const v = g.map((x) => x[stat])
    return {
      label, note, n: g.length,
      avg: v.length ? mean(v) : null,
      min: g.length ? mean(g.map((x) => x.minutes)) : null,
      per36: g.length && mean(g.map((x) => x.minutes)) > 0 ? (mean(v) / mean(g.map((x) => x.minutes))) * 36 : null,
      over: line != null && v.length ? v.filter((x) => x > line).length / v.length : null,
    }
  }).filter((r) => r.n > 0)

  if (rows.length < 2) return null
  const th = 'px-2 py-2 text-right font-normal'
  const td = 'px-2 py-2 text-right tabular-nums'

  return (
    <div className="overflow-x-auto rounded-lg bg-neutral-900">
      <div className="px-4 pt-4">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">{STAT_LABEL[stat]} by game type</h3>
        <p className="text-xs text-neutral-600">Per-36 strips out minutes, so a short preseason stint compares fairly.</p>
      </div>
      <table className="mt-2 w-full whitespace-nowrap text-sm">
        <thead className="text-xs text-neutral-500">
          <tr>
            <th className="px-4 py-2 text-left font-normal">Type</th>
            <th className={th}>GP</th><th className={th}>MIN</th><th className={th}>AVG</th><th className={th}>PER 36</th>
            <th className="px-4 py-2 text-right font-normal">{line != null ? `OVER ${line}` : 'OVER'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((r) => (
            <tr key={r.label} title={r.note}>
              <td className="px-4 py-2 text-neutral-200">{r.label}</td>
              <td className={td}>{r.n}</td>
              <td className={`${td} text-neutral-400`}>{fmt(r.min)}</td>
              <td className={`${td} text-neutral-100`}>{fmt(r.avg)}</td>
              <td className={td}>{fmt(r.per36)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{pct(r.over)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
