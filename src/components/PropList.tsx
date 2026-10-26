import { STAT_LABEL, fmt, pct } from '../lib/format'
import { evText, hitRate, projectionState, type Card } from '../lib/propsBoard'
import { InjuryTag } from './Availability'
import Headshot from './Headshot'
import { Term } from './MetricGuide'
import { SlipButton } from './PickTable'

/** The same props as a compact table, for scanning many at once. One row per card, showing the lead side; every number matches the card view. */
export default function PropList({ cards, onOpenPlayer }: { cards: Card[]; onOpenPlayer: (id: number) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-neutral-800">
      <table className="w-full whitespace-nowrap text-sm tabular-nums">
        <thead className="text-left text-xs text-neutral-500">
          <tr className="border-b border-neutral-800">
            <th scope="col" className="py-2 pl-4 font-normal">Player</th>
            <th scope="col" className="px-2 font-normal">Prop</th>
            <th scope="col" className="px-2 font-normal">Best side</th>
            <th scope="col" className="px-2 text-right font-normal"><Term k="proj" /></th>
            <th scope="col" className="px-2 text-right font-normal"><Term k="ev" /></th>
            <th scope="col" className="px-2 text-right font-normal"><Term k="model" /></th>
            <th scope="col" className="px-2 text-right font-normal"><Term k="market" /></th>
            <th scope="col" className="px-2 text-right font-normal"><Term k="hit" /></th>
            <th scope="col" className="py-2 pr-4 text-right font-normal"><span className="sr-only">Add to slip</span></th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => {
            const p = c.lead
            const hr = hitRate(c)
            const landed = p.recent.filter((v) => (p.side === 'over' ? v > p.line : v < p.line)).length
            const decided = p.recent.filter((v) => v !== p.line).length
            return (
              <tr key={c.key} className="border-t border-neutral-800/70 hover:bg-neutral-900">
                <td className="py-1.5 pl-4">
                  <button onClick={() => onOpenPlayer(p.playerId)} className="flex items-center gap-2 rounded text-left text-neutral-100 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500" aria-label={`Open ${p.player}`}>
                    <Headshot id={p.playerId} name={p.player} size={30} />{p.player}<InjuryTag injury={p.injury} />
                  </button>
                </td>
                <td className="px-2 text-neutral-300">{STAT_LABEL[p.stat]} <span className="font-medium text-neutral-50">{p.line}</span></td>
                <td className="px-2"><span className="text-neutral-300">{p.side === 'over' ? 'Over' : 'Under'}</span> <span className="font-semibold text-neutral-50">{p.price.toFixed(2)}</span> <span className="text-xs text-neutral-500">{p.book}</span></td>
                <td className="px-2 text-right text-neutral-300">{projectionState(p) === 'missing' ? '–' : fmt(p.projection)}{projectionState(p) !== 'ok' && <span className="ml-1 text-amber-500" title="Projection is stale, from the fallback model, or missing">!</span>}</td>
                <td className={`px-2 text-right font-medium ${p.basis === 'authoritative' ? (p.ev > 0 && p.auth?.evidence !== 'insufficient' ? 'text-emerald-400' : 'text-neutral-300') : 'text-neutral-500'}`} title={p.basis === 'authoritative' ? undefined : 'Simple blend, not validated'}>{p.basis === 'authoritative' ? '' : '≈ '}{evText(p.ev)}</td>
                <td className="px-2 text-right text-neutral-500">{pct(p.modelProb)}</td>
                <td className="px-2 text-right text-neutral-500">{pct(p.marketProb)}</td>
                <td className="px-2 text-right text-neutral-500">{hr < 0 ? '–' : `${landed}/${decided}`}</td>
                <td className="py-1 pr-4 text-right"><SlipButton pick={p} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
