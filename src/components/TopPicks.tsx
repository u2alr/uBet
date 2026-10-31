import { STAT_LABEL } from '../lib/format'
import { evText, opponentOf, topPicks, type Card } from '../lib/propsBoard'
import { InjuryTag } from './Availability'
import Headshot from './Headshot'
import { SlipButton } from './PickTable'

/** A pinned strip of the slate's best props, above the per-game sections. Renders nothing when no prop qualifies. */
/** `strip` scrolls sideways above the games; `column` stacks the picks in a side panel. */
export default function TopPicks({ cards, onOpenPlayer, layout = 'strip' }: { cards: Card[]; onOpenPlayer: (id: number) => void; layout?: 'strip' | 'column' }) {
  const column = layout === 'column'
  const { picks: top, validated } = topPicks(cards, column ? 5 : 8)
  if (!top.length) return null
  return (
    <section aria-label="Top picks" className="space-y-2">
      <div className={column ? 'px-1' : 'flex items-baseline gap-2 px-1'}>
        <h2 className="text-sm font-semibold text-neutral-100">Top picks</h2>
        {validated
          ? <span className="text-xs text-neutral-500">Highest expected value on the slate, validated numbers only, one per player.</span>
          : <span className="text-xs text-amber-500">No validated edges right now. These are simple-blend estimates, not validated: treat them as leads to check, not recommendations.</span>}
      </div>
      <ul className={column ? 'space-y-2' : 'flex snap-x gap-3 overflow-x-auto pb-2'}>
        {top.map((c) => {
          const p = c.lead
          const opp = opponentOf(p)
          return (
            <li key={c.key} className={`${column ? '' : 'w-72 shrink-0 snap-start'} rounded-2xl border border-neutral-800 bg-neutral-900/60 p-3`}>
              <div className="flex items-center gap-2">
                <button onClick={() => onOpenPlayer(p.playerId)} aria-label={`Open ${p.player}`} className="flex min-w-0 flex-1 items-center gap-2 rounded text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
                  <Headshot id={p.playerId} name={p.player} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-50">{p.player}<InjuryTag injury={p.injury} /></span>
                    <span className="block truncate text-xs text-neutral-500">{opp ? `vs ${opp}` : p.game}</span>
                  </span>
                </button>
                <span className={`text-lg font-semibold tabular-nums ${validated ? 'text-emerald-400' : 'text-neutral-400'}`} title={validated ? 'Expected profit per unit staked' : 'Simple blend, not validated'}>{validated ? '' : '≈ '}{evText(p.ev)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span className="text-neutral-300">
                  {p.side === 'over' ? 'Over' : 'Under'} <span className="font-medium text-neutral-50">{p.line}</span> {STAT_LABEL[p.stat]}
                  <span className="ml-2 tabular-nums text-neutral-400">{p.price.toFixed(2)} <span className="text-xs text-neutral-600">{p.book}</span></span>
                </span>
                <SlipButton pick={p} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
