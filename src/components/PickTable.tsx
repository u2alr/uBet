import { Fragment, useState } from 'react'
import { STAT_LABEL, fmt, pct } from '../lib/format'
import type { Risk } from '../../shared/baseline'
import { groupByGame, type Pick } from '../lib/picks'
import { useSlip } from '../lib/slipContext'
import { InjuryTag, RoleTag } from './Availability'
import Headshot from './Headshot'
import { PickBars, PickSpark } from './PickSpark'

const RISK: Record<Risk, { label: string; cls: string }> = {
  safe: { label: 'Safe', cls: 'bg-neutral-200 text-neutral-900' },
  balanced: { label: 'Even', cls: 'bg-neutral-800 text-neutral-300' },
  risky: { label: 'Risky', cls: 'border border-neutral-600 text-neutral-400' },
}

export function RiskBadge({ risk }: { risk: Risk }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${RISK[risk].cls}`}>{RISK[risk].label}</span>
}

export function SlipButton({ pick }: { pick: Pick }) {
  const slip = useSlip()
  const on = slip.has(pick)
  return (
    <button
      onClick={() => slip.toggle(pick)}
      title={on ? 'Remove from slip' : 'Add to slip'}
      className={`h-6 w-6 rounded text-sm leading-none ${on ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-100'}`}
    >
      {on ? '✓' : '+'}
    </button>
  )
}

export default function PickTable({ picks, onOpenPlayer, empty }: {
  picks: Pick[]; onOpenPlayer: (id: number) => void; empty: string
}) {
  if (picks.length === 0) return <p className="rounded-lg bg-neutral-900 px-4 py-6 text-sm text-neutral-500">{empty}</p>
  return (
    <div className="overflow-x-auto rounded-lg bg-neutral-900">
      <table className="w-full whitespace-nowrap text-xs">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="px-3 py-1.5 font-normal">Player</th>
            <th className="px-2 py-1.5 font-normal">Bet</th>
            <th className="px-2 py-1.5 font-normal">Best odds</th>
            <th className="px-2 py-1.5 text-right font-normal">Chance</th>
            <th className="px-2 py-1.5 text-right font-normal" title="Our model alone">Model</th>
            <th className="px-2 py-1.5 text-right font-normal" title="The books, margin removed">Market</th>
            <th className="px-2 py-1.5 text-right font-normal">Proj</th>
            <th className="px-2 py-2 font-normal" title="Last 10 games against the line. Bright bars landed on this side. Click a row to enlarge.">Last 10</th>
            <th className="px-2 py-1.5 text-right font-normal" title="How often this side hit in the last 10 games">L10</th>
            <th className="px-2 py-1.5 text-right font-normal" title="Games behind the estimate">Games</th>
            <th className="px-2 py-1.5 text-right font-normal">EV</th>
            <th className="px-2 py-1.5 font-normal">Risk</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {groupByGame(picks).map((g) => (
            <Fragment key={g.game}>
              <tr className="border-t border-neutral-800 bg-neutral-950/40">
                <td colSpan={13} className="px-3 pb-0.5 pt-2 text-xs uppercase tracking-widest text-neutral-400">{g.game}</td>
              </tr>
              {g.teams.map((t) => (
                <Fragment key={t.team}>
                  <tr>
                    <td colSpan={13} className="px-3 pb-0 pt-1 text-xs text-neutral-600">{t.team}</td>
                  </tr>
                  {t.picks.map((p) => (
                    <PickRow key={`${p.playerId}${p.stat}${p.side}${p.line}`} p={p} onOpenPlayer={onOpenPlayer} />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PickRow({ p, onOpenPlayer }: { p: Pick; onOpenPlayer: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
    <tr className="border-t border-neutral-800/60 hover:bg-neutral-800/60">
      <td className="px-3 py-0.5">
        <button className="flex items-center gap-2 text-neutral-100 hover:underline" onClick={() => onOpenPlayer(p.playerId)}>
          <Headshot id={p.playerId} name={p.player} size={30} />
          <span className="flex flex-col items-start leading-tight">
            <span className="flex items-center gap-1.5">{p.player}<InjuryTag injury={p.injury} /></span>
            <RoleTag role={p.role} />
          </span>
        </button>
      </td>
      <td className="px-2 py-0.5 tabular-nums">
        <span className="text-neutral-100">{p.side === 'over' ? 'O' : 'U'} {p.line}</span>{' '}
        <span className="text-neutral-500">{STAT_LABEL[p.stat]}</span>
        {p.push > 0.005 && <span className="ml-1 text-xs text-neutral-600" title="Chance the stat lands exactly on this whole-number line, in which case the stake is refunded">push {pct(p.push)}</span>}
      </td>
      <td className="px-2 py-0.5 tabular-nums" title={p.prices.map((x) => `${x.book} ${x.price.toFixed(2)}`).join(' · ')}>
        {p.price.toFixed(2)} <span className="text-xs text-neutral-600">{p.book}</span>
        {p.prices.length > 1 && <span className="text-xs text-neutral-700"> +{p.prices.length - 1}</span>}
      </td>
      <td className="px-2 py-0.5 text-right tabular-nums text-neutral-100">
        {p.bigGap && <span className="mr-1 cursor-help text-neutral-500" title={`Model ${pct(p.modelProb)} vs market ${pct(p.marketProb)}. A gap this big usually means news the model cannot see (injury, trade, role change).`}>⚠</span>}
        <span title="Chance of winning if the bet is not refunded (model blended with the market). It is not the same thing as how sure the model is.">{pct(p.prob)}</span>
      </td>
      <td className="px-2 py-0.5 text-right tabular-nums text-neutral-400">{pct(p.modelProb)}</td>
      <td className="px-2 py-0.5 text-right tabular-nums text-neutral-400">{pct(p.marketProb)}</td>
      <td className="px-2 py-0.5 text-right tabular-nums text-neutral-400" title={`Projection from ${p.model === 'gbm-v1' ? 'the boosted model' : 'the fallback average model'}`}>{fmt(p.projection)}</td>
      <td className="px-2 py-0.5">
        <button className="block" onClick={() => setOpen(!open)} aria-expanded={open} title="Show the last games large"><PickSpark p={p} /></button>
      </td>
      <td className="px-2 py-0.5 text-right tabular-nums text-neutral-400">{pct(p.hitRate10)}</td>
      <td className="px-2 py-0.5 text-right tabular-nums text-neutral-500">{p.sample}</td>
      <td className="px-2 py-0.5 text-right tabular-nums text-neutral-100">{p.ev > 0 ? '+' : ''}{(p.ev * 100).toFixed(1)}%</td>
      <td className="px-2 py-0.5"><RiskBadge risk={p.risk} /></td>
      <td className="px-3 py-0.5 text-right"><SlipButton pick={p} /></td>
    </tr>
    {open && <tr className="bg-neutral-950/40"><td colSpan={13}><PickBars p={p} /></td></tr>}
    </>
  )
}
