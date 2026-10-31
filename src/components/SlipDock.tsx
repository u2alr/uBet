import { useState } from 'react'
import { conflicts } from '../../shared/teamBets.ts'
import { STAT_LABEL, pct } from '../lib/format'
import { pickKey } from '../lib/picks'
import { slipTotals } from '../lib/slipMath'
import { useSlip } from '../lib/slipContext'

/** The slip, always beside the props. Add and remove legs and read the parlay without leaving the board; logging a bet stays on the full Slip screen. */
export default function SlipDock({ onOpenSlip }: { onOpenSlip: () => void }) {
  const slip = useSlip()
  const [stake, setStake] = useState('10')
  const { legs, teamLegs } = slip
  const count = legs.length + teamLegs.length
  const { odds, prob, ev } = slipTotals(legs, teamLegs)
  const amount = Number(stake) || 0
  const games = new Map<string, number>()
  for (const l of legs) games.set(l.game, (games.get(l.game) ?? 0) + 1)
  const correlated = [...games.values()].some((n) => n > 1) || new Set(legs.map((l) => l.playerId)).size < legs.length

  return (
    <aside aria-label="Bet slip" className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">Your slip</h2>
        <span className="text-xs text-neutral-500">{count} {count === 1 ? 'leg' : 'legs'}</span>
      </div>

      {count === 0 ? (
        <p className="text-xs leading-snug text-neutral-500">Press <b className="text-neutral-300">+</b> on a prop to build a parlay here.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {teamLegs.map((t) => (
              <li key={`${t.gameId}${t.team}`} className="flex items-start justify-between gap-2 rounded-lg bg-neutral-950/50 px-2.5 py-2 text-xs">
                <span className="min-w-0"><span className="block truncate text-neutral-100">{t.team} to win</span><span className="block truncate text-neutral-500">{t.game}</span></span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums"><span className="text-neutral-100">{t.price.toFixed(2)}</span><button className="text-neutral-600 hover:text-neutral-200" onClick={() => slip.removeTeam(t)} aria-label={`Remove ${t.team}`}>✕</button></span>
              </li>
            ))}
            {legs.map((l) => (
              <li key={pickKey(l)} className="flex items-start justify-between gap-2 rounded-lg bg-neutral-950/50 px-2.5 py-2 text-xs">
                <span className="min-w-0"><span className="block truncate text-neutral-100">{l.player}</span><span className="block truncate text-neutral-500">{l.side === 'over' ? 'Over' : 'Under'} {l.line} {STAT_LABEL[l.stat]}</span></span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums"><span className="text-neutral-100">{l.price.toFixed(2)}</span><button className="text-neutral-600 hover:text-neutral-200" onClick={() => slip.remove(l)} aria-label={`Remove ${l.player}`}>✕</button></span>
              </li>
            ))}
          </ul>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
            <dt className="text-neutral-500">Combined odds</dt><dd className="text-right font-medium text-neutral-100">{odds.toFixed(2)}x</dd>
            <dt className="text-neutral-500">No leg loses</dt><dd className="text-right text-neutral-300" title="Assumes the legs are independent, which they are not">{pct(prob)}</dd>
            <dt className="text-neutral-500">Expected value</dt><dd className="text-right text-neutral-300">{ev > 0 ? '+' : ''}{(ev * 100).toFixed(0)}%</dd>
          </dl>

          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="dock-stake" className="text-neutral-500">Stake</label>
            <input id="dock-stake" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)}
              className="w-16 rounded-md bg-neutral-800 px-2 py-1.5 tabular-nums text-neutral-100 outline-none focus:ring-1 focus:ring-emerald-500" />
            <span className="ml-auto text-neutral-400">returns <b className="text-neutral-100">{(amount * odds).toFixed(2)}</b></span>
          </div>

          {(correlated || conflicts(teamLegs)) && <p className="text-xs leading-snug text-neutral-500">{conflicts(teamLegs) ? 'Two teams from one game cannot both win. ' : 'Legs from the same game or player move together, so the chance above is probably off.'}</p>}
          {legs.some((l) => l.basis !== 'authoritative') && <p className="text-xs leading-snug text-amber-400/90">Some legs are unvalidated simple-blend estimates.</p>}

          <div className="flex items-center gap-2">
            <button onClick={onOpenSlip} className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Review and log</button>
            <button onClick={slip.clear} className="rounded-lg px-2 py-2 text-xs text-neutral-500 hover:text-neutral-200">Clear</button>
          </div>
        </>
      )}
    </aside>
  )
}
