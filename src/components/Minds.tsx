import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MINDS_V1 } from '../../shared/minds'
import { INK, MIND_COLOR } from '../lib/colors'
import { STAT_LABEL, api, pct } from '../lib/format'
import Headshot from './Headshot'
import { PickBars, PickSpark } from './PickSpark'
import MindsCharts from './MindsCharts'

interface Bet { id: number; day: string; mind: string; kind: string; odds: number; prob: number; ev: number; status: string; profit: number | null }
interface Leg {
  betId: number; idx: number; playerId: number; player: string; stat: string; side: string; line: number; price: number
  book: string | null; gameDate: string; prob: number; modelProb: number | null; marketProb: number | null; actual: number | null; result: string | null
  /** The player's last 10 regular-season games before this bet, oldest first. */
  recent: number[]
}
interface Sum {
  mind: string; bets: number; settled: number; won: number; lost: number; open: number; units: number
  statedProb: number | null; actualRate: number | null; statedEv: number | null
  staked: number | null; avgOdds: number | null; avgEv: number | null; combos: number; singles: number; days: number
  bestWin: number | null; worstLoss: number | null
}
interface Res { data: { bets: Bet[]; legs: Leg[]; summary: Sum[]; curve: { mind: string; day: string; units: number }[]; minBets: number } }

const NAMES: Record<string, string> = { sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat', control: 'Control (random)' }
const STYLE: Record<string, string> = {
  sam: 'plays it safe: likely singles and a double',
  val: 'only bets with a positive expected value',
  lou: 'long-odds combos of 3 to 5 legs',
  cat: 'bets where the model and the market disagree',
  control: 'random picks from the same pool: the benchmark to beat',
}
const c = MINDS_V1
const p0 = (x: number) => `${Math.round(x * 100)}%`
// The rules, read from the frozen config so this text can never drift from what the minds actually do.
const RULES: Record<string, string[]> = {
  sam: [
    `Up to ${c.sam.singles} singles with a win chance of ${p0(c.sam.singleProb)} or more, most likely first.`,
    `Plus one double: two legs from different games, each ${p0(c.sam.doubleLegProb)} or more.`,
  ],
  val: [
    `Up to ${c.val.singles} singles with expected value of +${p0(c.val.minEv)} or more and a win chance of ${p0(c.val.minProb)} or more, best value first.`,
    `Plus a double of the top two such legs (different games) if the pair's combined EV is +${p0(c.val.doubleEv)} or more.`,
  ],
  lou: [
    `Up to ${c.lou.combos} combos of ${c.lou.minLegs} to ${c.maxLegs} legs from different games and players.`,
    `Each leg needs a win chance of ${p0(c.lou.legProb)} or more and a price of ${c.lou.legPrice.toFixed(1)} or more; the combo must pay ${c.lou.minOdds}x or more.`,
  ],
  cat: [
    `Up to ${c.cat.singles} singles where our model and the books differ by ${p0(c.cat.minGap)} or more, with EV of +${p0(c.cat.minEv)} or more. Biggest disagreement first.`,
    'It bets either side: our model can be more or less bullish than the market.',
  ],
  control: [
    `${c.control.singles} random singles from the same pool the others use, chosen with a seed from the date.`,
    'It has no opinion. A mind that cannot beat it, on both profit and closing-line value, has shown no skill.',
  ],
}
const SHARED = [
  `Every mind: fresh boosted-model projection, ${c.minSample}+ games of history, ${c.minMarketBooks}+ books quoting both sides of the line.`,
  `Flat 1 unit per bet, at most ${c.maxBetsPerDay} bets per mind per day, a combo has at most ${c.maxLegs} legs. A mind may pass.`,
  'Combo legs are treated as independent. A pushed or voided leg is dropped from a combo.',
]
const ORDER = ['sam', 'val', 'lou', 'cat', 'control']
const STATUS: Record<string, string> = { open: 'Open', won: 'Won', lost: 'Lost', push: 'Push', void: 'Void' }
const settledStatus = new Set(['won', 'lost', 'push'])
const signed = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export default function Minds({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'open' | 'settled'>('all')
  useEffect(() => { api<Res>('/minds').then(setRes).catch((e) => setError(e.message)) }, [refreshKey])

  const series = useMemo(() => {
    if (!res) return []
    const days = [...new Set(res.data.curve.map((x) => x.day))].sort()
    const run: Record<string, number> = {}
    return days.map((day) => {
      const row: Record<string, number | string> = { day }
      for (const x of res.data.curve) if (x.day === day) run[x.mind] = (run[x.mind] ?? 0) + x.units
      for (const m of ORDER) if (m in run) row[m] = Number(run[m].toFixed(2))
      return row
    })
  }, [res])

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="text-sm text-neutral-500">Loading…</p>
  const { bets, legs, summary, minBets } = res.data
  const sum = (m: string) => summary.find((s) => s.mind === m)
  const legsOf = (id: number) => legs.filter((l) => l.betId === id)
  // What the bets were *expected* to earn, to set beside what they did: the honest comparison.
  const expectedUnits = (m: string) => bets.filter((b) => b.mind === m && settledStatus.has(b.status)).reduce((a, b) => a + b.ev, 0)

  const visible = bets.filter((b) =>
    (!pick || b.mind === pick) && (show === 'all' || (show === 'open' ? b.status === 'open' : b.status !== 'open')))
  const byDay = new Map<string, Bet[]>()
  for (const b of visible.slice(0, 120)) byDay.set(b.day, [...(byDay.get(b.day) ?? []), b])

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        Five rule-based pickers. Each card is frozen when it is made and graded from box scores. No mind gets a verdict before {minBets} settled bets:
        until then, treat every number below as noise. Click a mind to see only its bets and its rules.
      </p>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {ORDER.map((m) => {
          const s = sum(m)
          const settled = s?.settled ?? 0
          const units = s?.units ?? 0
          const exp = expectedUnits(m)
          const roi = s?.staked ? units / s.staked : null
          const on = pick === m
          return (
            <button key={m} onClick={() => setPick(on ? null : m)} aria-pressed={on}
              className={`lift rounded-lg bg-neutral-900 p-3 text-left ${on ? 'ring-1 ring-neutral-500' : 'hover:bg-neutral-800/60'}`}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: MIND_COLOR[m] }} />
                <span className="text-sm font-medium text-neutral-100">{NAMES[m]}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-neutral-500">{STYLE[m]}</p>
              <dl className="mt-2 grid grid-cols-2 gap-y-0.5 text-[11px]">
                <dt className="text-neutral-500">Record</dt>
                <dd className="text-right tabular-nums text-neutral-200">{s?.won ?? 0}W {s?.lost ?? 0}L · {s?.open ?? 0} open</dd>
                <dt className="text-neutral-500">Units</dt>
                <dd className="text-right tabular-nums text-neutral-200">{signed(units)}{roi != null && <span className="text-neutral-500"> ({signed(roi * 100, 0)}% ROI)</span>}</dd>
                <dt className="text-neutral-500" title="Sum of each settled bet's expected profit, at the prices we took">Expected</dt>
                <dd className="text-right tabular-nums text-neutral-200">{settled ? signed(exp) : '–'}</dd>
                <dt className="text-neutral-500">Said / got</dt>
                <dd className="text-right tabular-nums text-neutral-200">{s?.statedProb == null || s.actualRate == null ? '–' : `${p0(s.statedProb)} / ${p0(s.actualRate)}`}</dd>
                <dt className="text-neutral-500">Avg odds</dt>
                <dd className="text-right tabular-nums text-neutral-200">{s?.avgOdds ? `${s.avgOdds.toFixed(2)}x` : '–'}</dd>
                <dt className="text-neutral-500">Avg EV</dt>
                <dd className="text-right tabular-nums text-neutral-200">{s?.avgEv != null ? `${signed(s.avgEv * 100, 1)}%` : '–'}</dd>
                <dt className="text-neutral-500">Mix</dt>
                <dd className="text-right tabular-nums text-neutral-200">{s?.singles ?? 0} single · {s?.combos ?? 0} combo</dd>
                <dt className="text-neutral-500">Days</dt>
                <dd className="text-right tabular-nums text-neutral-200">{s?.days ?? 0}</dd>
                {s?.bestWin != null && <><dt className="text-neutral-500">Best / worst</dt><dd className="text-right tabular-nums text-neutral-200">{signed(s.bestWin)} / {signed(s.worstLoss ?? 0)}</dd></>}
              </dl>
              <div className="mt-2 h-1 overflow-hidden rounded bg-neutral-800">
                <div className="h-full transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, (settled / minBets) * 100)}%`, background: MIND_COLOR[m] }} />
              </div>
              <p className="mt-0.5 text-[11px] text-neutral-500">{settled} of {minBets} settled bets</p>
            </button>
          )
        })}
      </div>

      <details className="rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400" open={pick !== null}>
        <summary className="cursor-pointer text-neutral-300">Rules{pick ? `: ${NAMES[pick]}` : ''}</summary>
        <div className="mt-2 space-y-2">
          {(pick ? [pick] : ORDER).map((m) => (
            <div key={m}>
              <div className="flex items-center gap-2 text-neutral-200"><span className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[m] }} />{NAMES[m]}</div>
              <ul className="ml-4 list-disc text-neutral-400">{RULES[m].map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          ))}
          <ul className="list-disc border-t border-neutral-800 pl-4 pt-2 text-neutral-500">{SHARED.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      </details>

      <div className="rounded-lg bg-neutral-900 p-3">
        <h2 className="mb-1 text-sm text-neutral-300">Units by day (cumulative)</h2>
        {series.length < 2 ? (
          <p className="py-6 text-center text-sm text-neutral-500">The chart starts once two days of bets have settled.</p>
        ) : (
          <div className="h-52">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid stroke={INK.grid} vertical={false} />
                <XAxis dataKey="day" stroke={INK.axis} tick={{ fill: INK.legend, fontSize: 11 }} />
                <YAxis stroke={INK.axis} tick={{ fill: INK.legend, fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#171717', border: '1px solid #262626', color: INK.tooltip, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: INK.legend }} formatter={(v: string) => NAMES[v] ?? v} />
                {ORDER.map((m) => (
                  <Line key={m} type="monotone" dataKey={m} stroke={MIND_COLOR[m]} strokeWidth={pick === m ? 3 : 2} strokeOpacity={pick && pick !== m ? 0.25 : 1}
                    dot={false} connectNulls strokeDasharray={m === 'control' ? '5 4' : undefined} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <MindsCharts bets={bets} legs={legs} pick={pick} />

      <div className="flex items-center justify-between">
        <h2 className="text-sm text-neutral-300">Bets{pick ? `: ${NAMES[pick]}` : ''} <span className="text-xs text-neutral-600">{visible.length}</span></h2>
        <div className="flex overflow-hidden rounded-md bg-neutral-900 text-xs">
          {(['all', 'open', 'settled'] as const).map((v) => (
            <button key={v} onClick={() => setShow(v)} className={`px-3 py-1 capitalize ${show === v ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{v}</button>
          ))}
        </div>
      </div>

      {visible.length === 0 && (
        <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">
          {bets.length === 0 ? <>No cards yet. Run <code className="text-neutral-300">node minds/run.mjs</code> to generate today's bets.</> : 'No bets match this filter.'}
        </p>
      )}
      {[...byDay].map(([day, list]) => {
        const done = list.filter((b) => b.status !== 'open')
        const net = done.reduce((a, b) => a + (b.profit ?? 0), 0)
        return (
          <div key={day} className="space-y-1">
            <div className="text-xs text-neutral-500">
              {dayLabel(day)} · {list.length} bets · {done.length} settled{done.length > 0 && <> · <span className="tabular-nums text-neutral-300">{signed(net)} units</span></>}
            </div>
            {list.map((b) => (
              <div key={b.id} className="flex flex-wrap items-start gap-x-4 gap-y-0.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs">
                <span className="flex w-32 shrink-0 items-center gap-2 text-neutral-200">
                  <span className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[b.mind] }} />{NAMES[b.mind] ?? b.mind}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {legsOf(b.id).map((l) => <LegRow key={l.idx} l={l} />)}
                </div>
                <div className="text-right tabular-nums text-neutral-400">
                  {b.kind === 'combo' ? `${legsOf(b.id).length}-leg ` : 'single '}{b.odds.toFixed(2)}x · says {p0(b.prob)} · EV {signed(b.ev * 100, 1)}%
                  <div className="text-neutral-200">{STATUS[b.status]}{b.profit != null ? ` ${signed(b.profit)}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function LegRow({ l }: { l: Leg }) {
  const [open, setOpen] = useState(false)
  const gap = l.modelProb != null && l.marketProb != null ? l.modelProb - l.marketProb : null
  const hits = l.recent.filter((v) => (l.side === 'over' ? v > l.line : v < l.line)).length
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 text-neutral-300">
        <Headshot id={l.playerId} name={l.player} size={34} />
        <span className="text-neutral-100">{l.player}</span>
        <span className="text-neutral-400">{l.side === 'over' ? 'Over' : 'Under'} {l.line} {STAT_LABEL[l.stat] ?? l.stat}</span>
        <button className="block" onClick={() => setOpen(!open)} aria-expanded={open}
          title={l.recent.length ? `Last ${l.recent.length} games before this bet: ${hits} landed. Click to enlarge.` : 'No earlier games stored'}>
          <PickSpark p={l} />
        </button>
        <span className="tabular-nums text-neutral-500">
          @ {l.price.toFixed(2)}{l.book ? ` ${l.book}` : ''} · model {pct(l.modelProb)} · market {pct(l.marketProb)}
          {gap != null && ` (${gap > 0 ? '+' : ''}${Math.round(gap * 100)})`} · blended {pct(l.prob)}
          {l.recent.length > 0 && ` · hit ${hits}/${l.recent.length} lately`}
        </span>
        {l.actual != null && (
          <span className={l.result === 'won' ? 'text-neutral-100' : 'text-neutral-500'}>· got {l.actual} ({l.result})</span>
        )}
      </div>
      {open && <PickBars p={l} />}
    </div>
  )
}
