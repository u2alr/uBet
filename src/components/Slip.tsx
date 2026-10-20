import { useState } from 'react'
import { STAT_LABEL, pct } from '../lib/format'
import { combine } from '../lib/picks'
import { useSlip } from '../lib/slipContext'

export default function Slip() {
  const slip = useSlip()
  const [stake, setStake] = useState('10')
  const { legs } = slip

  if (legs.length === 0)
    return (
      <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">
        Your slip is empty. Press <b className="text-neutral-300">+</b> on any pick, or add a suggested parlay from Today.
      </p>
    )

  const { odds, prob, ev } = combine(legs)
  const amount = Number(stake) || 0

  const games = new Map<string, number>()
  for (const l of legs) games.set(l.game, (games.get(l.game) ?? 0) + 1)
  const sameGame = [...games.values()].some((n) => n > 1)
  const samePlayer = new Set(legs.map((l) => l.playerId)).size < legs.length

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-900">
        {legs.map((l) => (
          <li key={`${l.playerId}${l.stat}${l.side}${l.line}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="truncate text-neutral-100">{l.player}</div>
              <div className="text-xs text-neutral-500">
                {l.side === 'over' ? 'Over' : 'Under'} {l.line} {STAT_LABEL[l.stat]} · {l.game}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4 tabular-nums">
              <span className="text-xs text-neutral-500">{pct(l.prob)}</span>
              <span className="text-neutral-100">{l.price.toFixed(2)}</span>
              <button className="text-neutral-600 hover:text-neutral-200" onClick={() => slip.remove(l)} title="Remove">✕</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-neutral-800 text-center">
        <Stat label="Combined odds" value={`${odds.toFixed(2)}x`} />
        <Stat label="No leg loses (if independent)" value={pct(prob)} />
        <Stat label="Expected value" value={`${ev > 0 ? '+' : ''}${(ev * 100).toFixed(0)}%`} />
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-neutral-900 p-3 text-sm">
        <label className="text-neutral-500" htmlFor="stake">Stake</label>
        <input
          id="stake"
          inputMode="decimal"
          className="w-24 rounded-md bg-neutral-800 px-3 py-2 tabular-nums outline-none focus:ring-1 focus:ring-neutral-600"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
        />
        <span className="ml-auto text-neutral-400">
          Returns <b className="text-neutral-100">{(amount * odds).toFixed(2)}</b> · profit{' '}
          <b className="text-neutral-100">{(amount * (odds - 1)).toFixed(2)}</b>
        </span>
      </div>

      {(sameGame || samePlayer) && (
        <p className="text-xs text-neutral-500">
          {samePlayer && 'Two legs on the same player move together. '}
          {sameGame && 'Legs from the same game are correlated, so the hit chance above is probably off. '}
          Books often refuse or reprice these.
        </p>
      )}
      <p className="text-xs text-neutral-600">
        The chance multiplies each leg's blended probability, which assumes the legs are independent. They are not, and nothing here knows by how much. A parlay needs every leg to win; a tie on a whole-number line removes that leg.
      </p>

      <button className="text-xs text-neutral-500 hover:text-neutral-300" onClick={slip.clear}>Clear slip</button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900 py-4">
      <div className="text-xl tabular-nums text-neutral-100">{value}</div>
      <div className="text-xs uppercase tracking-widest text-neutral-500">{label}</div>
    </div>
  )
}
