import { useMemo } from 'react'
import { combineLegs, parlayLabel, teamLegsFromGames, type GameForTeamBets, type TeamLeg } from '../../shared/teamBets.ts'
import { pct } from '../lib/format'
import { normAbbr } from '../lib/propsBoard'
import { teamId } from '../lib/teams'
import { useSlip } from '../lib/slipContext'
import TeamLogo from './TeamLogo'

/**
 * Team bets: tonight's moneylines, one button per side, so a parlay like ATL + GSW + MIN + LAL is two taps per team. Prices are the best across books; the chance shown is the
 * market's no-margin win chance, because the app has no game-winner model of its own. Games with no price do not appear.
 */
export default function TeamBets({ games, onOpenSlip }: { games: GameForTeamBets[]; onOpenSlip: () => void }) {
  const slip = useSlip()
  const legs = useMemo(() => teamLegsFromGames(games, normAbbr), [games])
  const byGame = useMemo(() => {
    const m = new Map<string, TeamLeg[]>()
    for (const l of legs) (m.get(l.gameId) ?? m.set(l.gameId, []).get(l.gameId)!).push(l)
    return [...m.values()].sort((a, b) => a[0].date.localeCompare(b[0].date))
  }, [legs])
  const picked = slip.teamLegs
  const combined = combineLegs(picked.map((t) => ({ price: t.price, prob: t.marketProb })))

  if (!byGame.length) {
    return games.some((g) => g.state === 'pre')
      ? <p className="text-xs text-neutral-500">Team bets need moneyline prices, and the odds feed has none right now.</p>
      : null
  }
  return (
    <section aria-label="Team bets" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-medium text-neutral-300">Team bets</h2>
        <span className="text-xs text-neutral-500">Moneyline, best price across books. Tap teams to build a parlay.</span>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {byGame.map((pair) => (
          <li key={pair[0].gameId} className="flex shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60">
            {pair.map((l, i) => {
              const on = slip.hasTeam(l), id = teamId(l.team)
              return (
                <button key={l.team} onClick={() => slip.toggleTeam(l)} aria-pressed={on} title={`${l.team} to win ${l.game}: the market gives ${pct(l.marketProb)}`}
                  className={`flex items-center gap-2 px-3 py-2 text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${i ? 'border-l border-neutral-800' : ''} ${on ? 'bg-emerald-500 text-neutral-950' : 'text-neutral-200 hover:bg-neutral-800'}`}>
                  {id && <TeamLogo id={id} abbr={l.team} size={20} />}
                  <span className="font-medium">{l.team}</span>
                  <span className={on ? 'text-neutral-900' : 'text-neutral-400'}>{l.price.toFixed(2)}</span>
                </button>
              )
            })}
          </li>
        ))}
      </ul>
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm" role="status">
          <b className="text-neutral-100">{parlayLabel(picked)}</b>
          <span className="tabular-nums text-neutral-300">{combined.odds.toFixed(2)}x</span>
          <span className="tabular-nums text-neutral-400" title="Product of the market's no-margin win chances, as if the games were independent">all win ~{pct(combined.prob)}</span>
          <button onClick={onOpenSlip} className="ml-auto rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Open slip</button>
          <button onClick={() => picked.forEach((t) => slip.removeTeam(t))} className="text-xs text-neutral-500 hover:text-neutral-200">Clear</button>
        </div>
      )}
    </section>
  )
}
