import { useEffect, useState } from 'react'
import { describeMatchup, teamLines, type DefenseMeta, type MatchupRow, type TeamMetricRow } from '../../shared/defense.ts'
import { api } from '../lib/format'
import type { Pick } from '../lib/picks'
import { opponentOf } from '../lib/propsBoard'

interface Context {
  available: boolean
  team?: TeamMetricRow[]; matchup?: MatchupRow[]; meta?: DefenseMeta; source?: string
  model: { version: string; evaluated: boolean; adjustsPredictions: boolean; groupsKept: string[]; summary: string }
}

// One request per player and opponent, shared by every card that asks for it.
const cache = new Map<string, Promise<Context>>()
function load(player: number, opp: string): Promise<Context> {
  const key = `${player}|${opp}`
  let p = cache.get(key)
  if (!p) {
    p = api<{ data: Context }>(`/defense-context?${new URLSearchParams({ player: String(player), opp })}`).then((r) => r.data)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

const CONFIDENCE = { high: 'High', medium: 'Medium', low: 'Low' } as const

/**
 * Defensive Matchup: who is likely to guard him (an estimate from history, never a confirmed assignment), what the available sample says about those defenders,
 * and notable traits of the team defence for THIS statistic. It never shows a probability impact: the pre-registered evaluation decides whether any of it may change a prediction.
 */
export default function DefensiveMatchup({ p }: { p: Pick }) {
  const [ctx, setCtx] = useState<Context | null>(null)
  const [error, setError] = useState(false)
  const opp = opponentOf(p)
  useEffect(() => {
    if (!opp) return
    let live = true
    load(p.playerId, opp).then((c) => live && setCtx(c)).catch(() => live && setError(true))
    return () => { live = false }
  }, [p.playerId, opp])

  if (!opp || error) return null
  if (!ctx) return <p className="text-xs text-neutral-600">Loading defensive matchup…</p>
  if (!ctx.available || !ctx.meta) return null

  const view = describeMatchup(ctx.matchup ?? [], ctx.meta)
  const lines = teamLines(ctx.team ?? [], p.stat)
  if (!view && !lines.length) return null
  return (
    <section aria-label="Defensive matchup" className="space-y-1.5 rounded-xl border border-neutral-800 p-3">
      <h4 className="text-xs uppercase tracking-widest text-neutral-500">Defensive matchup</h4>
      <dl className="space-y-1 text-sm">
        {view && (
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-neutral-500">Likely</dt>
            <dd className="text-neutral-300">
              {view.defenders.map((d, i) => (
                <span key={d.name} className="block">
                  {d.name} <span className="text-neutral-500">({Math.round(d.share * 100)}% of the estimate)</span>
                  {i === 0 || d.share >= 0.2 ? <span className="text-neutral-400"> · {d.rating.label}; {d.sample}</span> : null}
                </span>
              ))}
              <span className="block text-xs text-neutral-500">Estimated assignment, not confirmed. {view.basis}{view.concentrated ? '' : ' The weight is spread across several defenders, so switches or help could change who guards him.'}</span>
            </dd>
          </div>
        )}
        {view?.confidence && (
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-neutral-500">Confidence</dt>
            <dd className="text-neutral-300">{CONFIDENCE[view.confidence]} <span className="text-xs text-neutral-500">(how much matchup history stands behind the defenders above; assignments can still change)</span></dd></div>
        )}
        {lines.length > 0 && (
          <div className="flex gap-3"><dt className="w-20 shrink-0 text-neutral-500">Team</dt>
            <dd className="text-neutral-300">{lines.map((l) => <span key={l} className="block">{l}</span>)}</dd></div>
        )}
        <div className="flex gap-3"><dt className="w-20 shrink-0 text-neutral-500">Model</dt>
          <dd className="text-neutral-300">{ctx.model.adjustsPredictions ? 'These inputs are part of the projection.' : `No adjustment: ${ctx.model.summary}`}</dd></div>
      </dl>
      <p className="text-xs text-neutral-600">
        Source: NBA.com per-game matchups, {ctx.meta.games_with_matchups.toLocaleString()} games through {ctx.meta.matchups_through}; computed {ctx.meta.as_of}. A defender is rated only with enough sample ({ctx.meta.defenders_rated} rated league-wide); switches are not recorded in the feed and late absences are not known.
      </p>
    </section>
  )
}
