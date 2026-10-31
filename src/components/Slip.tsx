import { useState } from 'react'
import { STAT_LABEL, api, pct } from '../lib/format'
import { conflicts, parlayLabel } from '../../shared/teamBets.ts'
import { pickKey } from '../lib/picks'
import { slipTotals } from '../lib/slipMath'
import { useSlip } from '../lib/slipContext'

export default function Slip() {
  const slip = useSlip()
  const [stake, setStake] = useState('10')
  // The odds actually taken at the book, per leg. Blank means the price shown. Grading uses these, not the app's price.
  const [taken, setTaken] = useState<Record<string, string>>({})
  const [logState, setLogState] = useState<{ status: 'idle' | 'saving' | 'done' | 'error'; message?: string }>({ status: 'idle' })
  const { legs, teamLegs } = slip

  if (legs.length === 0 && teamLegs.length === 0)
    return (
      <div className="space-y-2">
      {logState.status === 'done' && <p className="rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300" role="status">{logState.message}</p>}
      <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">
        Your slip is empty. Press <b className="text-neutral-300">+</b> on any pick, or add a suggested parlay from Today.
      </p>
      </div>
    )

  const priceOf = (l: (typeof legs)[number]) => { const t = Number(taken[pickKey(l)]); return Number.isFinite(t) && t > 1 ? t : l.price }
  const { odds, prob, ev } = slipTotals(legs, teamLegs)
  const myOdds = legs.reduce((a, l) => a * priceOf(l), 1) * teamLegs.reduce((a, t) => a * t.price, 1)
  const amount = Number(stake) || 0
  const bad = legs.some((l) => taken[pickKey(l)] && !(Number(taken[pickKey(l)]) > 1))

  async function logBet() {
    setLogState({ status: 'saving' })
    try {
      await api('/my-bets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stake: amount, legs: legs.map((l) => ({ playerId: l.playerId, player: l.player, stat: l.stat, side: l.side, line: l.line, price: priceOf(l), book: l.book, gameDate: l.gameDate })) }),
      })
      setLogState({ status: 'done', message: 'Logged. It is graded after the games, once box scores are synced, and shows under Results.' })
      slip.clear()
    } catch (e) {
      setLogState({ status: 'error', message: (e as Error).message })
    }
  }

  const games = new Map<string, number>()
  for (const l of legs) games.set(l.game, (games.get(l.game) ?? 0) + 1)
  const sameGame = [...games.values()].some((n) => n > 1)
  const samePlayer = new Set(legs.map((l) => l.playerId)).size < legs.length

  return (
    <div className="space-y-3">
      {teamLegs.length > 0 && (
        <section aria-label="Team legs" className="space-y-1.5 rounded-lg bg-neutral-900 p-3">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500">Team bets: {parlayLabel(teamLegs)}</h3>
          <ul className="divide-y divide-neutral-800 text-sm">
            {teamLegs.map((t) => (
              <li key={`${t.gameId}${t.team}`} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="text-neutral-100">{t.team} to win</span> <span className="text-xs text-neutral-500">{t.game}</span></span>
                <span className="flex shrink-0 items-center gap-4 tabular-nums"><span className="text-xs text-neutral-500" title="The market's no-margin chance">{pct(t.marketProb)}</span><span className="text-neutral-100">{t.price.toFixed(2)}</span><button className="text-neutral-600 hover:text-neutral-200" onClick={() => slip.removeTeam(t)} title="Remove">✕</button></span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-neutral-500">Team chances are the market's no-margin win chances (the app has no game-winner model), so the expected value below measures price shopping against the market, not an edge.{conflicts(teamLegs) ? ' Two teams from one game cannot both win.' : ''}</p>
        </section>
      )}
      {legs.length > 0 && <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-900">
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
              <label className="sr-only" htmlFor={`taken-${pickKey(l)}`}>Odds you actually got for {l.player}</label>
              <input id={`taken-${pickKey(l)}`} inputMode="decimal" placeholder="got" title="The decimal odds you actually got, if different"
                className="w-16 rounded-md bg-neutral-800 px-2 py-1 text-right text-xs tabular-nums text-neutral-200 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-emerald-500"
                value={taken[pickKey(l)] ?? ''} onChange={(e) => setTaken((t) => ({ ...t, [pickKey(l)]: e.target.value }))} />
              <button className="text-neutral-600 hover:text-neutral-200" onClick={() => slip.remove(l)} title="Remove">✕</button>
            </div>
          </li>
        ))}
      </ul>}

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

      {legs.some((l) => l.basis !== 'authoritative') && (
        <p className="text-xs text-amber-400/90">Some legs use the older simple blend, which is not validated: the figures above mix calculations.</p>
      )}
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

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-neutral-900 p-3 text-sm">
        <button onClick={logBet} disabled={logState.status === 'saving' || amount <= 0 || bad || teamLegs.length > 0 || legs.length === 0}
          className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-neutral-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">
          {logState.status === 'saving' ? 'Logging…' : 'I placed this bet'}
        </button>
        <span className="text-xs text-neutral-500">Records {amount.toFixed(2)} at <b className="text-neutral-300">{myOdds.toFixed(2)}x</b>{myOdds !== odds ? ' (your odds)' : ''} so it can be graded. The app never places bets.</span>
        {bad && <span className="text-xs text-amber-400">Odds you got must be decimal odds above 1.</span>}
        {teamLegs.length > 0 && <span className="text-xs text-amber-400">Parlays with team legs cannot be logged yet: game results are not stored reliably, so they could not be graded. Remove the team legs to log the player props.</span>}
        {logState.status === 'error' && <span className="text-xs text-red-400" role="alert">{logState.message}</span>}
      </div>
      {logState.status === 'done' && <p className="text-xs text-emerald-400" role="status">{logState.message}</p>}

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
