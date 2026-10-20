import type { Stat } from '../../shared/baseline'
import { STAT_LABEL, pct } from '../lib/format'
import type { Pick } from '../lib/picks'
import { PickSpark } from './PickSpark'
import { RiskBadge, SlipButton } from './PickTable'

// Every prop line the books are offering for this one player, both sides, with our chance and the best price.
export default function PlayerProps({ picks, note, loading, onPick }: {
  picks: Pick[]; note: string; loading: boolean; onPick: (stat: Stat, line: number) => void
}) {
  if (loading) return <p className="text-sm text-neutral-500">Loading props…</p>
  if (picks.length === 0)
    return <p className="rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-500">{note || 'No prop lines posted for this player in the next games.'}</p>

  const sorted = [...picks].sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.stat.localeCompare(b.stat) || a.line - b.line || (a.side === 'over' ? -1 : 1))
  return (
    <div className="overflow-x-auto rounded-lg bg-neutral-900">
      <table className="w-full whitespace-nowrap text-xs">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-normal">Game</th>
            <th className="px-2 py-1 font-normal">Prop</th>
            <th className="px-2 py-1 font-normal">Best odds</th>
            <th className="px-2 py-1 text-right font-normal">Chance</th>
            <th className="px-2 py-2 font-normal">Last 10</th>
            <th className="px-2 py-1 text-right font-normal">Model</th>
            <th className="px-2 py-1 text-right font-normal">Market</th>
            <th className="px-2 py-1 text-right font-normal">Proj</th>
            <th className="px-2 py-1 text-right font-normal">EV</th>
            <th className="px-2 py-1 font-normal">Risk</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={`${p.stat}${p.side}${p.line}${p.gameDate}`} className="border-t border-neutral-800/60 hover:bg-neutral-800/60">
              <td className="px-3 py-1 text-xs text-neutral-500">{p.game}</td>
              <td className="px-2 py-1 tabular-nums">
                <button className="text-neutral-100 hover:underline" title="Chart this line" onClick={() => onPick(p.stat as Stat, p.line)}>
                  {p.side === 'over' ? 'O' : 'U'} {p.line}
                </button>{' '}
                <span className="text-neutral-500">{STAT_LABEL[p.stat]}</span>
              </td>
              <td className="px-2 py-1 tabular-nums">{p.price.toFixed(2)} <span className="text-xs text-neutral-600">{p.book}</span></td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-100">{pct(p.prob)}</td>
              <td className="px-2 py-1"><PickSpark p={p} /></td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-400">{pct(p.modelProb)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-400">{pct(p.marketProb)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-400">{p.projection.toFixed(1)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-100">{p.ev > 0 ? '+' : ''}{(p.ev * 100).toFixed(1)}%</td>
              <td className="px-2 py-1"><RiskBadge risk={p.risk} /></td>
              <td className="px-3 py-1 text-right"><SlipButton pick={p} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
