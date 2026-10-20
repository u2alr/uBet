import { STAT_LABEL, pct } from '../lib/format'
import { combine, type Parlay } from '../lib/picks'
import { useSlip } from '../lib/slipContext'

export default function Parlays({ parlays, onOpenSlip }: { parlays: Parlay[]; onOpenSlip: () => void }) {
  const slip = useSlip()
  if (parlays.length === 0)
    return <p className="rounded-lg bg-neutral-900 px-4 py-6 text-sm text-neutral-500">Not enough picks yet to build parlays.</p>

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {parlays.map((p) => {
        const { odds, prob, ev } = combine(p.legs)
        return (
          <div key={p.name} className="flex flex-col rounded-lg bg-neutral-900 p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="text-neutral-100">{p.name}</h3>
              <span className="text-lg tabular-nums text-neutral-100">{odds.toFixed(2)}x</span>
            </div>
            <p className="mb-3 text-xs text-neutral-600">{p.blurb}</p>
            <ul className="mb-3 flex-1 space-y-1.5 text-sm">
              {p.legs.map((l) => (
                <li key={`${l.playerId}${l.stat}`} className="flex justify-between gap-2">
                  <span className="truncate text-neutral-300">{l.player}</span>
                  <span className="shrink-0 tabular-nums text-neutral-500">
                    {l.side === 'over' ? 'O' : 'U'} {l.line} {STAT_LABEL[l.stat]}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-xs text-neutral-500">
              <span title="Assumes the legs are independent, which they are not">No leg loses ~{pct(prob)}</span>
              <span>EV {ev > 0 ? '+' : ''}{(ev * 100).toFixed(0)}%</span>
            </div>
            <button
              className="mt-3 rounded-md bg-neutral-800 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
              onClick={() => { slip.addAll(p.legs); onOpenSlip() }}
            >
              Add to slip
            </button>
          </div>
        )
      })}
      <p className="text-xs text-neutral-600 sm:col-span-3">
        These multiply each leg's probability as if the legs were independent. Legs from the same game or the same player move
        together, so the real chance can differ a lot, and a book may reprice or refuse such combinations. Treat the figures as rough.
      </p>
    </div>
  )
}
