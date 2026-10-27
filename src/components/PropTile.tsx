import { Suspense, lazy, useId, useState } from 'react'
import { STAT_LABEL, fmt, pct } from '../lib/format'
import type { Pick } from '../lib/picks'
import { hitRate, evText, projectionEdge, projectionState, type Card } from '../lib/propsBoard'
import { teamId } from '../lib/teams'
import { InjuryTag, RoleTag } from './Availability'
import { H2HSummary, H2HTable } from './H2HPanels'
import { h2hRows, type H2HState } from '../lib/h2hView'
import Headshot from './Headshot'
import EvidenceBadge from './EvidenceBadge'
import { Term } from './MetricGuide'
import { SlipButton } from './PickTable'
import { PickSpark } from './PickSpark'
import ScheduleFatigue from './ScheduleFatigue'
import TeamLogo from './TeamLogo'

const PickBars = lazy(() => import('./PickBars'))

const CAUTION: Record<string, string> = { stale: 'Projection is over 24 hours old', fallback: 'Fallback average model, not the boosted projection', missing: 'No projection available' }

/** Over / under with the best price and book. The side with positive expected value is the only one that is highlighted. */
function Side({ label, p, lead, missing }: { label: string; p: Pick | null; lead: boolean; missing: string }) {
  // Green only where the numbers are authoritative AND the evidence behind them is not marked insufficient (a +11% EV from a 28-point model/market gap is not a green light).
  const good = !!p && lead && p.basis === 'authoritative' && p.ev > 0 && p.auth?.evidence !== 'insufficient'
  return (
    <div className={`flex items-center justify-between rounded-xl border px-3 py-2 ${good ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-neutral-800'}`}>
      <div className="leading-tight">
        <div className="text-sm text-neutral-300">{label}</div>
        <div className="text-xs text-neutral-500">{p ? p.book : missing}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold tabular-nums text-neutral-50">{p ? p.price.toFixed(2) : '–'}</span>
        {p && <SlipButton pick={p} />}
      </div>
    </div>
  )
}

export default function PropTile({ c, h2h, tipIso = null, onOpenPlayer }: { c: Card; h2h: H2HState; tipIso?: string | null; onOpenPlayer: (id: number) => void }) {
  const p = c.lead
  const [open, setOpen] = useState(false)
  const panel = useId()
  const tid = teamId(p.team)
  const hr = hitRate(c)
  const state = projectionState(p)
  const gap = projectionEdge(p)
  const rows = h2hRows(h2h, p)
  const side = p.side === 'over' ? 'Over' : 'Under'
  const auth = p.basis === 'authoritative'
  const landed = p.recent.filter((v) => (p.side === 'over' ? v > p.line : v < p.line)).length
  const decided = p.recent.filter((v) => v !== p.line).length
  return (
    <article className="rounded-2xl border border-neutral-800 bg-neutral-900/60" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }}>
      <div className="space-y-3 p-4">
        <header className="flex items-center gap-3">
          <button onClick={() => onOpenPlayer(p.playerId)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500" aria-label={`Open ${p.player}`}>
            <Headshot id={p.playerId} name={p.player} size={48} />
            <span className="min-w-0 leading-snug">
              <span className="flex items-center gap-1.5 text-base font-medium text-neutral-50"><span className="truncate">{p.player}</span><InjuryTag injury={p.injury} /></span>
              <span className="flex items-center gap-1.5 text-xs text-neutral-500">{tid && <TeamLogo id={tid} abbr={p.team ?? ''} size={14} />}{p.team}<RoleTag role={p.role} /></span>
            </span>
          </button>
          <div className="text-right leading-none">
            <div className="text-xs uppercase tracking-wider text-neutral-500">{STAT_LABEL[p.stat]}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-neutral-50">{p.line}</div>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <Side label="Over" p={c.over} lead={p === c.over} missing={p.counterpart === 'not_posted' ? 'not posted' : 'unavailable'} />
          <Side label="Under" p={c.under} lead={p === c.under} missing={p.counterpart === 'not_posted' ? 'not posted' : 'unavailable'} />
        </div>

        {/* Primary: what the model projects, and what the best side is worth. */}
        <div className="flex items-baseline gap-x-5 gap-y-1">
          <span className="text-sm text-neutral-400"><Term k="proj" /> <b className="text-base font-semibold tabular-nums text-neutral-50">{state === 'missing' ? '–' : fmt(p.projection)}</b>
            {gap != null && <span className={`ml-1 text-xs tabular-nums ${gap > 0 ? 'text-emerald-400' : 'text-neutral-500'}`}>({gap > 0 ? '+' : ''}{gap.toFixed(1)} {side.toLowerCase()})</span>}</span>
          <span className="ml-auto text-sm text-neutral-400">{side} <Term k="ev" /> <b className={`text-base font-semibold tabular-nums ${auth ? (p.ev > 0 && p.auth?.evidence !== 'insufficient' ? 'text-emerald-400' : 'text-neutral-200') : 'text-neutral-400'}`} title={auth ? undefined : 'Simple blend, not validated: the engine could not price this line'}>{auth ? '' : '≈ '}{evText(p.ev)}</b>{!auth && <span className="ml-1 text-xs text-neutral-500">unvalidated</span>}</span>
        </div>
        {state !== 'ok' && <p className="text-xs text-amber-500/90">{CAUTION[state]}</p>}

        {/* Secondary: quiet, one line, all for the same side. */}
        <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-neutral-500">
          <span><Term k="model" /> {pct(p.modelProb)}</span>
          <span><Term k="market" /> {pct(p.marketProb)}</span>
          <span><Term k="hit" /> {hr < 0 ? '–' : `${landed}/${decided}`}</span>
          <span><Term k="games" /> {p.sample}</span>
        </p>
      </div>

      <div className="border-t border-neutral-800">
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={panel}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
          <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
          {open ? 'Hide details' : 'Details'}
          <span className="ml-auto flex items-center gap-3"><PickSpark p={p} w={64} h={18} /></span>
        </button>
        {open && (
          <div id={panel} className="space-y-4 border-t border-neutral-800 px-4 py-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm tabular-nums">
              {([['Over', c.over], ['Under', c.under]] as const).map(([name, x]) => x && (
                <div key={name} className="contents">
                  <dt className="text-neutral-500">{name} <Term k="win" /></dt><dd className="text-right text-neutral-200">{(x.prob * 100).toFixed(1)}% <span className="text-neutral-500">· <Term k="ev" /> {evText(x.ev)}</span></dd>
                </div>
              ))}
              <dt className="text-neutral-500">Evidence</dt><dd className="text-right"><EvidenceBadge p={p} /></dd>
              {p.auth && p.basis === 'authoritative' && (
                <>
                  <dt className="text-neutral-500">EV is computed at</dt><dd className="text-right text-neutral-200">{p.auth.price.executable?.toFixed(2) ?? '–'} <span className="text-neutral-500">· {p.auth.price.independentBooks} independent book{p.auth.price.independentBooks === 1 ? '' : 's'}{p.auth.price.best != null && p.auth.price.executable != null && p.auth.price.best > p.auth.price.executable + 1e-9 ? `, best ${p.auth.price.best.toFixed(2)} capped to the next book + 3%` : ''}</span></dd>
                  <dt className="text-neutral-500">Conservative <Term k="ev" /></dt><dd className="text-right text-neutral-200">{p.auth.ev.conservative == null ? '–' : evText(p.auth.ev.conservative)} <span className="text-neutral-500">· lower bound</span></dd>
                </>
              )}
              {p.legacy && <><dt className="text-neutral-500">Older simple blend <span className="text-neutral-600">(not validated)</span></dt><dd className="text-right text-neutral-500">{pct(p.legacy.prob)} · {evText(p.legacy.ev)}</dd></>}
              {p.push > 0.005 && <><dt className="text-neutral-500">Refund chance (lands on the line)</dt><dd className="text-right text-neutral-200">{pct(p.push)}</dd></>}
              <dt className="text-neutral-500">Projection source</dt><dd className="text-right text-neutral-200">{p.model === 'gbm-v1' ? 'Boosted model' : 'Fallback average'}{p.projectionAgeHours != null && <span className="text-neutral-500"> · {p.projectionAgeHours < 1 ? 'under 1h' : `${Math.round(p.projectionAgeHours)}h`} old</span>}</dd>
            </dl>
            {p.prices.length > 0 && (
              <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-neutral-500">
                <span className="text-neutral-400">{side} at every book:</span>{p.prices.map((x) => <span key={x.book}>{x.book} <span className="text-neutral-200">{x.price.toFixed(2)}</span></span>)}
              </p>
            )}
            <div className="flex items-center gap-4"><PickSpark p={p} w={150} h={40} /><span className="text-xs text-neutral-500">Last {p.recent.length} games against {p.line}; bright bars landed on the {p.side}.</span></div>
            <Suspense fallback={<div className="h-32" />}><PickBars p={p} /></Suspense>
            <ScheduleFatigue p={p} tipIso={tipIso} />
            <H2HSummary p={p} rows={rows} failed={h2h.status === 'error'} />
            <H2HTable p={p} rows={rows} />
          </div>
        )}
      </div>
    </article>
  )
}
