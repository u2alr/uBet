import { useEffect, useState } from 'react'
import type { Bin, Summary } from '../../shared/metrics.ts'
import type { TrackRecord as Record_ } from '../../shared/trackRecord.ts'
import { STAT_LABEL, api, pct } from '../lib/format'

// Enough decided bets that a hit rate or yield means something. Below this the panel says so instead of dressing luck up as skill.
const ENOUGH = 200

const signed = (n: number | null, d = 1) => (n == null ? '–' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(d)}%`)
const range = (ci: [number, number] | null, f: (n: number) => string) => (ci ? `${f(ci[0])} to ${f(ci[1])}` : 'not enough bets')

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-neutral-900 px-4 py-3">
      <div className="text-xs uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="text-xl tabular-nums text-neutral-100">{value}</div>
      {sub && <div className="text-xs tabular-nums text-neutral-500">{sub}</div>}
    </div>
  )
}

function Rows({ title, rows, label }: { title: string; rows: Record<string, Summary>; label?: (k: string) => string }) {
  const entries = Object.entries(rows)
  if (!entries.length) return null
  return (
    <div className="overflow-x-auto rounded-lg bg-neutral-900">
      <table className="w-full whitespace-nowrap text-xs">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="px-3 py-1.5 font-normal">{title}</th>
            <th className="px-2 py-1.5 text-right font-normal">Bets</th>
            <th className="px-2 py-1.5 text-right font-normal">Hit rate</th>
            <th className="px-2 py-1.5 text-right font-normal" title="Profit per unit staked, refunds included">Yield</th>
            <th className="px-3 py-1.5 text-right font-normal">Units</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, s]) => (
            <tr key={k} className="border-t border-neutral-800/60">
              <td className="px-3 py-1 text-neutral-200">{label ? label(k) : k}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-400">{s.settled}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-300">{s.hitRate == null ? '–' : pct(s.hitRate)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-300">{signed(s.yield)}</td>
              <td className="px-3 py-1 text-right tabular-nums text-neutral-400">{s.units > 0 ? '+' : ''}{s.units.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Calibration({ bins }: { bins: Bin[] }) {
  const used = bins.filter((b) => b.n > 0)
  if (!used.length) return null
  return (
    <div className="overflow-x-auto rounded-lg bg-neutral-900">
      <table className="w-full whitespace-nowrap text-xs">
        <caption className="px-3 pt-2 text-left text-neutral-500">When we said this chance, how often did it win?</caption>
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="px-3 py-1.5 font-normal">Stated chance</th>
            <th className="px-2 py-1.5 text-right font-normal">Bets</th>
            <th className="px-2 py-1.5 text-right font-normal">Said</th>
            <th className="px-3 py-1.5 text-right font-normal">Won</th>
          </tr>
        </thead>
        <tbody>
          {used.map((b) => (
            <tr key={b.lo} className="border-t border-neutral-800/60">
              <td className="px-3 py-1 text-neutral-200">{pct(b.lo)} to {pct(Math.min(1, b.hi))}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-400">{b.n}</td>
              <td className="px-2 py-1 text-right tabular-nums text-neutral-400">{pct(b.meanStated!)}</td>
              <td className="px-3 py-1 text-right tabular-nums text-neutral-100">{pct(b.observed!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TrackRecord({ refreshKey }: { refreshKey: number }) {
  const [t, setT] = useState<Record_ | null>(null)
  useEffect(() => {
    let live = true
    api<{ data: Record_ }>('/results/report').then((r) => live && setT(r.data)).catch(() => live && setT(null))
    return () => { live = false }
  }, [refreshKey])
  if (!t || t.overall.settled === 0) return null
  const o = t.overall, decided = o.wins + o.losses
  const b = t.brier
  return (
    <section className="space-y-3" aria-label="Track record">
      <h2 className="text-xs uppercase tracking-widest text-neutral-500">Track record · {o.settled} graded</h2>
      {decided < ENOUGH && (
        <p className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-amber-400">
          {decided} decided bets so far. Under {ENOUGH}, a hit rate or yield is mostly luck: read these as a first look, not a verdict.
        </p>
      )}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-neutral-800 sm:grid-cols-4">
        <Stat label="Hit rate" value={o.hitRate == null ? '–' : pct(o.hitRate)} sub={range(o.hitRateCI, pct)} />
        <Stat label="Yield" value={signed(o.yield)} sub={range(o.yieldCI, (n) => signed(n, 0))} />
        <Stat label="Units" value={`${o.units > 0 ? '+' : ''}${o.units.toFixed(1)}`} sub={`${o.wins}W ${o.losses}L ${o.pushes} refunded`} />
        <Stat label="Model vs market" value={b.model == null || b.market == null ? '–' : b.model < b.market ? 'Model closer' : 'Market closer'}
          sub={b.n ? `Brier ${b.model!.toFixed(3)} vs ${b.market!.toFixed(3)} · ${b.n} bets` : 'no bets with both chances'} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Calibration bins={t.calibration} />
        <Rows title="Statistic" rows={t.byStat} label={(k) => STAT_LABEL[k] ?? k} />
        <Rows title="Odds taken" rows={t.byOdds} />
        <Rows title="Basis" rows={t.byBasis} label={(k) => (k === 'authoritative' ? 'Validated engine' : k === 'legacy' ? 'Simple blend' : k)} />
      </div>
      <p className="text-xs text-neutral-600">Brier score: lower means the chances were closer to what happened. Slices of a small record look good or bad by chance alone.</p>
    </section>
  )
}
