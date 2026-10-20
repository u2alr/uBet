import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { INK, MIND_COLOR } from '../lib/colors'
import { STAT_LABEL, api } from '../lib/format'

interface Bet { id: number; day: string; mind: string; kind: string; odds: number; prob: number; ev: number; status: string; profit: number | null }
interface Leg { betId: number; idx: number; player: string; stat: string; side: string; line: number; price: number; book: string | null; gameDate: string; actual: number | null; result: string | null }
interface Sum { mind: string; bets: number; settled: number; won: number; lost: number; open: number; units: number; statedProb: number | null; actualRate: number | null; statedEv: number | null }
interface Res { data: { bets: Bet[]; legs: Leg[]; summary: Sum[]; curve: { mind: string; day: string; units: number }[]; minBets: number } }

const NAMES: Record<string, string> = { sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat', control: 'Control (random)' }
const STYLE: Record<string, string> = {
  sam: 'plays it safe: likely singles and a double',
  val: 'only bets with a positive expected value',
  lou: 'long-odds combos of 3 to 5 legs',
  cat: 'bets where the model and the market disagree',
  control: 'random picks from the same pool: the benchmark to beat',
}
const ORDER = ['sam', 'val', 'lou', 'cat', 'control']
const STATUS: Record<string, string> = { open: 'Open', won: 'Won', lost: 'Lost', push: 'Push', void: 'Void' }

export default function Minds({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Res>('/minds').then(setRes).catch((e) => setError(e.message)) }, [refreshKey])

  const series = useMemo(() => {
    if (!res) return []
    const days = [...new Set(res.data.curve.map((c) => c.day))].sort()
    const run: Record<string, number> = {}
    return days.map((day) => {
      const row: Record<string, number | string> = { day }
      for (const c of res.data.curve) if (c.day === day) run[c.mind] = (run[c.mind] ?? 0) + c.units
      for (const m of ORDER) if (m in run) row[m] = Number(run[m].toFixed(2))
      return row
    })
  }, [res])

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="text-sm text-neutral-500">Loading…</p>
  const { bets, legs, summary, minBets } = res.data
  const sum = (m: string) => summary.find((s) => s.mind === m)
  const legsOf = (id: number) => legs.filter((l) => l.betId === id)

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
        Five rule-based pickers. Each card is frozen when it is made and graded from box scores. Flat 1 unit per bet, at most 5 bets a day each.
        No mind gets a verdict before {minBets} settled bets: until then, treat every number below as noise.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {ORDER.map((m) => {
          const s = sum(m)
          const settled = s?.settled ?? 0
          const units = s?.units ?? 0
          return (
            <div key={m} className="rounded-lg bg-neutral-900 p-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: MIND_COLOR[m] }} />
                <span className="text-sm font-medium text-neutral-100">{NAMES[m]}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">{STYLE[m]}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
                <dt className="text-neutral-500">Record</dt>
                <dd className="text-right tabular-nums text-neutral-200">{s?.won ?? 0}W {s?.lost ?? 0}L · {s?.open ?? 0} open</dd>
                <dt className="text-neutral-500">Units</dt>
                <dd className="text-right tabular-nums text-neutral-200">{units > 0 ? '+' : ''}{units.toFixed(2)}</dd>
                <dt className="text-neutral-500">Said / got</dt>
                <dd className="text-right tabular-nums text-neutral-200">
                  {s?.statedProb == null || s.actualRate == null ? '–' : `${(s.statedProb * 100).toFixed(0)}% / ${(s.actualRate * 100).toFixed(0)}%`}
                </dd>
              </dl>
              <div className="mt-3 h-1 overflow-hidden rounded bg-neutral-800">
                <div className="h-full" style={{ width: `${Math.min(100, (settled / minBets) * 100)}%`, background: MIND_COLOR[m] }} />
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">{settled} of {minBets} settled bets</p>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg bg-neutral-900 p-4">
        <h2 className="mb-2 text-sm text-neutral-300">Units by day (cumulative)</h2>
        {series.length < 2 ? (
          <p className="py-8 text-center text-sm text-neutral-500">The chart starts once two days of bets have settled.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="day" stroke={INK.axis} tick={{ fill: INK.legend, fontSize: 11 }} />
                <YAxis stroke={INK.axis} tick={{ fill: INK.legend, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#171717', border: '1px solid #262626', color: INK.tooltip, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: INK.legend }} formatter={(v: string) => NAMES[v] ?? v} />
                {ORDER.map((m) => (
                  <Line key={m} type="monotone" dataKey={m} stroke={MIND_COLOR[m]} strokeWidth={2} dot={false} connectNulls
                    strokeDasharray={m === 'control' ? '5 4' : undefined} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm text-neutral-300">Cards</h2>
        {bets.length === 0 && (
          <p className="rounded-lg bg-neutral-900 px-4 py-6 text-sm text-neutral-500">
            No cards yet. Run <code className="text-neutral-300">node minds/run.mjs</code> to generate today's bets.
          </p>
        )}
        {bets.slice(0, 60).map((b) => (
          <div key={b.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-lg bg-neutral-900 px-4 py-3 text-sm">
            <span className="flex w-36 items-center gap-2 text-neutral-200">
              <span className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[b.mind] }} />{NAMES[b.mind] ?? b.mind}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              {legsOf(b.id).map((l) => (
                <div key={l.idx} className="text-neutral-300">
                  {l.player} <span className="text-neutral-500">{l.side} {l.line} {STAT_LABEL[l.stat as keyof typeof STAT_LABEL] ?? l.stat}</span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {l.price.toFixed(2)}{l.book ? ` ${l.book}` : ''}{l.actual != null ? ` · got ${l.actual} (${l.result})` : ''}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-right text-xs tabular-nums text-neutral-400">
              {b.kind === 'combo' ? `${legsOf(b.id).length}-leg ` : ''}{b.odds.toFixed(2)}x · says {(b.prob * 100).toFixed(0)}%
              <div className="text-neutral-200">{STATUS[b.status]}{b.profit != null ? ` ${b.profit > 0 ? '+' : ''}${b.profit.toFixed(2)}` : ''}</div>
              <div className="text-neutral-500">{b.day}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
