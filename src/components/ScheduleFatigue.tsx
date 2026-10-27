import { useEffect, useState } from 'react'
import type { MatchupSummary, TeamFacts, WorkloadFacts } from '../../shared/schedule.ts'
import { api } from '../lib/format'
import type { Pick } from '../lib/picks'
import { opponentOf } from '../lib/propsBoard'
import { teamByName } from '../lib/teams'

interface Context {
  date: string; away: TeamFacts; home: TeamFacts; matchup: MatchupSummary; players: Record<string, WorkloadFacts>
  model: { version: string; evaluated: boolean; adjustsPredictions: boolean; groupsKept: string[]; summary: string }
  source: string; newestGameUsed: string | null
}

// One request per game, shared by every card of that game; players are fetched for the card that asked.
const cache = new Map<string, Promise<Context>>()
function load(home: string, away: string, date: string, tip: string | null, playerId: number): Promise<Context> {
  const key = `${home}|${away}|${date}|${tip ?? ''}|${playerId}`
  let p = cache.get(key)
  if (!p) {
    const qs = new URLSearchParams({ home, away, date, players: String(playerId), ...(tip ? { tip } : {}) })
    p = api<{ data: Context }>(`/schedule-context?${qs}`).then((r) => r.data)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

const days = (n: number | null) => (n === null ? 'unknown' : n === 1 ? 'yesterday' : n >= 10 ? '10 or more days ago' : `${n} days ago`)

/**
 * Schedule & Fatigue: what is KNOWN or properly estimated about rest, travel and workload before this game. Facts are separated from model effects: this section never shows a
 * probability impact, because the pre-registered evaluation is what decides whether any of these inputs may change a prediction.
 */
export default function ScheduleFatigue({ p, tipIso }: { p: Pick; tipIso: string | null }) {
  const [ctx, setCtx] = useState<Context | null>(null)
  const [error, setError] = useState(false)
  const [away, home] = p.game.split(' @ ').map((n) => teamByName(n)?.[0])
  useEffect(() => {
    if (!away || !home) return
    let live = true
    load(home, away, p.gameDate, tipIso, p.playerId).then((c) => live && setCtx(c)).catch(() => live && setError(true))
    return () => { live = false }
  }, [away, home, p.gameDate, tipIso, p.playerId])

  if (!away || !home) return null
  if (error) return <p className="text-xs text-neutral-500">Schedule &amp; fatigue unavailable right now.</p>
  if (!ctx) return <p className="text-xs text-neutral-600">Loading schedule &amp; fatigue…</p>

  const mine = (p.team === home ? ctx.home : ctx.away) as TeamFacts
  const opp = opponentOf(p) === home ? ctx.home : ctx.away
  const w = ctx.players[String(p.playerId)]
  const unknown = [...mine.unknown, ...(w?.unknown ?? [])]
  const lines: { label: string; text: string; estimate?: boolean }[] = []
  if (mine.restDays !== null && opp.restDays !== null) {
    lines.push({ label: 'Rest', text: `${p.team} last played ${days(mine.restDays)}${mine.backToBack ? ` (a ${mine.b2bType?.replace(/_/g, ' ')} back-to-back)` : ''}; ${opponentOf(p)} last played ${days(opp.restDays)}.${mine.threeInFour ? ' Third game in four nights.' : ''}` })
  } else lines.push({ label: 'Rest', text: 'The previous game is not in the database, so rest is unknown.' })
  if (mine.travel) lines.push({ label: 'Travel', estimate: true, text: mine.travel.sameCity ? 'Same city as the previous game.' : `About ${mine.travel.miles.toLocaleString()} miles since the previous game${mine.travel.direction === 'none' ? ', same time zone' : `, ${Math.abs(mine.travel.tzShift)} hour${Math.abs(mine.travel.tzShift) === 1 ? '' : 's'} ${mine.travel.direction}ward`}.${mine.roadTripGames >= 2 ? ` Game ${mine.roadTripGames + (mine.isHome ? 0 : 1)} of a road trip.` : ''}` })
  if (w && w.lastGameMinutes !== null) lines.push({ label: 'Workload', text: `${p.player.split(' ').slice(-1)[0]} played ${w.lastGameMinutes} minutes last game (recent average ${w.averageLast10}).${w.heavyLastGame ? ' That is heavy for him.' : ''} ${w.cumulative.d7} minutes in the last 7 days.${w.returning === 'possible' ? ` First game after ${w.daysSincePrevious} days away; the reason is not known.` : ''}` })
  if (p.injury) lines.push({ label: 'Availability', text: `Listed ${p.injury.label} by ESPN (can lag).` })
  if (ctx.matchup.flags.length) lines.push({ label: 'Flag', text: ctx.matchup.flags.map((f) => f.reason).join(' ') + ' This is an observation, not a probability.' })

  return (
    <section aria-label="Schedule and fatigue" className="space-y-1.5 rounded-xl border border-neutral-800 p-3">
      <h4 className="text-xs uppercase tracking-widest text-neutral-500">Schedule &amp; fatigue</h4>
      <dl className="space-y-1 text-sm">
        {lines.map((l) => (
          <div key={l.label} className="flex gap-3"><dt className="w-20 shrink-0 text-neutral-500">{l.label}</dt><dd className="text-neutral-300">{l.text}{l.estimate && <span className="ml-1 text-xs text-neutral-500">(estimate from city locations)</span>}</dd></div>
        ))}
        <div className="flex gap-3"><dt className="w-20 shrink-0 text-neutral-500">Model</dt>
          <dd className="text-neutral-300">{ctx.model.adjustsPredictions ? 'These inputs are part of the projection.' : 'No adjustment: ' + ctx.model.summary}</dd></div>
      </dl>
      <p className="text-xs text-neutral-600">Source: {ctx.source}{ctx.newestGameUsed ? `; newest game used ${ctx.newestGameUsed}` : ''}.{unknown.length ? ` Not known: ${unknown.join('; ')}.` : ''}</p>
    </section>
  )
}
