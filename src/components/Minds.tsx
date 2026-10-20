import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MINDS_V3 } from '../../shared/minds'
import { INK, MIND_COLOR } from '../lib/colors'
import { STAT_LABEL, api, pct } from '../lib/format'
import Headshot from './Headshot'
import LazyMount from './LazyMount'
import { PickBars, PickSpark } from './PickSpark'
import MindsCharts from './MindsCharts'

interface Bet { id: number; day: string; mind: string; kind: string; odds: number; prob: number; ev: number; status: string; profit: number | null }
interface Leg {
  betId: number; idx: number; playerId: number; player: string; stat: string; side: string; line: number; price: number
  book: string | null; gameDate: string; prob: number; modelProb: number | null; marketProb: number | null; actual: number | null; result: string | null
  /** The player's last 10 regular-season games before this bet, oldest first. */
  recent: number[]
  eventId: string | null
  team: string | null
}
interface Sum {
  mind: string; bets: number; settled: number; won: number; lost: number; open: number; units: number
  statedProb: number | null; actualRate: number | null; statedEv: number | null
  staked: number | null; avgOdds: number | null; avgEv: number | null; combos: number; singles: number; days: number
  bestWin: number | null; worstLoss: number | null
}
interface Res { data: { bets: Bet[]; legs: Leg[]; summary: Sum[]; curve: { mind: string; day: string; units: number }[]; minBets: number; version: string; current: string; versions: { version: string; bets: number; settled: number; since: string }[] } }

const NAMES: Record<string, string> = { sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat', control: 'Control (random)' }
const STYLE: Record<string, string> = {
  sam: 'plays it safe: likely singles and a double',
  val: 'only bets with a positive expected value',
  lou: 'long-odds combos of 3 to 5 legs',
  cat: 'bets where the model and the market disagree',
  control: 'random picks from the same pool: the benchmark to beat',
}
const c = MINDS_V3
const p0 = (x: number) => `${Math.round(x * 100)}%`
// The rules, read from the frozen config so this text can never drift from what the minds actually do.
const RULES: Record<string, string[]> = {
  sam: [
    `Up to ${c.betsPerTeamPerGame} singles for each team in each game: win chance ${p0(c.sam.singleProb)} or more and no negative expected value, likeliest first.`,
    `Plus up to ${c.samDoubles} doubles a day: two such legs from different games, each ${p0(c.sam.doubleLegProb)} or more.`,
  ],
  val: [
    `Up to ${c.betsPerTeamPerGame} singles for each team in each game: expected value of +${p0(c.val.minEv)} or more and a win chance of ${p0(c.val.minProb)} or more, best value first.`,
    `Plus ${c.valDoubles} double a day of two legs (different games), each worth +${p0(c.val.doubleLegEv)} or more, if the pair is worth +${p0(c.val.doubleEv)} or more combined.`,
  ],
  lou: [
    `Up to ${c.louCombos} parlays a day of ${c.lou.minLegs} to ${c.maxLegs} legs from different games and players; each leg ${p0(c.lou.legProb)}+ and priced ${c.lou.legPrice.toFixed(1)} or more, every leg used once, paying ${c.lou.minOdds}x or more.`,
    `If five parlays cannot be built, it is topped up with 2-leg longshots paying ${c.lou.fillDoubleOdds}x or more.`,
  ],
  cat: [
    `Up to ${c.betsPerTeamPerGame} singles for each team in each game, on the side the market rates below ${p0(c.cat.maxMarketProb)}, where our model is higher by ${p0(c.cat.minGap)} or more and the bet has +${p0(c.cat.minEv)} EV or more. Biggest disagreement first.`,
    'Gaps of 25 points or more are skipped: those are usually something the model cannot see.',
  ],
  control: ['Version 1 only: 3 random singles from the same pool, as a benchmark. Removed in version 2.'],
}
const SHARED = [
  `Starters and stars only: a team's top ${c.starterTopN} players by recent minutes, averaging ${c.minRoleMinutes}+ with no big drop. Their minutes, and so their props, are the most predictable.`,
  `Also required: fresh boosted-model projection, ${c.minSample}+ games of history, ${c.minMarketBooks}+ books quoting both sides, not on the injury list, no model/market gap over ${p0(c.maxGap)}.`,
  `A mind never lowers a floor to fill a quota: a team with fewer qualifying lines simply gets fewer bets. At most ${c.maxBetsPerPlayer} bets per player a day, and ${c.maxAllUnder} all-Under bets per team-game.`,
  'Flat 1 unit per bet. Combo legs are treated as independent. A pushed or voided leg is dropped from a combo.',
]
const BASE = ['sam', 'val', 'lou', 'cat']
const STATUS: Record<string, string> = { open: 'Open', won: 'Won', lost: 'Lost', push: 'Push', void: 'Void' }
const settledStatus = new Set(['won', 'lost', 'push'])
const signed = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export default function Minds({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'open' | 'settled'>('all')
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => { api<Res>(`/minds${version ? `?version=${version}` : ''}`).then(setRes).catch((e) => setError(e.message)) }, [refreshKey, version])

  const ORDER = useMemo(() => [...BASE, ...(res?.data.summary.some((s) => s.mind === 'control') ? ['control'] : [])], [res])
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
  }, [res, ORDER])

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="text-sm text-neutral-500">Loading…</p>
  const { bets, legs, summary, minBets } = res.data
  const sum = (m: string) => summary.find((s) => s.mind === m)
  const legMap = new Map<number, Leg[]>()
  for (const l of legs) (legMap.get(l.betId) ?? legMap.set(l.betId, []).get(l.betId)!).push(l)
  const legsOf = (id: number) => legMap.get(id) ?? []
  // What the bets were *expected* to earn, to set beside what they did: the honest comparison.
  const expectedUnits = (m: string) => bets.filter((b) => b.mind === m && settledStatus.has(b.status)).reduce((a, b) => a + b.ev, 0)

  const visible = bets.filter((b) =>
    (!pick || b.mind === pick) && (show === 'all' || (show === 'open' ? b.status === 'open' : b.status !== 'open')))
  const byDay = new Map<string, Bet[]>()
  for (const b of visible) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b)

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        {ORDER.length} rule-based pickers, {res.data.version === res.data.current ? `up to ${c.betsPerTeamPerGame} bets per team per game` : 'an archived rule set'}. Each card is frozen when it is made and graded from box scores. No mind gets a verdict before {minBets} settled bets:
        until then, treat every number below as noise. Click a mind to see only its bets and its rules.
      </p>
      {res.data.versions.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          Rule set:
          <div className="flex overflow-hidden rounded-md bg-neutral-900">
            {res.data.versions.map((v) => (
              <button key={v.version} onClick={() => { setVersion(v.version); setPick(null) }}
                className={`px-3 py-1 ${v.version === res.data.version ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}
                title={`${v.bets} bets since ${v.since}, ${v.settled} settled`}>
                {v.version.replace('minds-', '')}{v.version === res.data.current ? ' (current)' : ' (archived)'}
              </button>
            ))}
          </div>
          <span>Versions use different rules and are never added together.</span>
        </div>
      )}


      <div className={`grid gap-2 sm:grid-cols-2 ${ORDER.length > 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
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

      <LazyMount height={560}><MindsCharts bets={bets} legs={legs} pick={pick} /></LazyMount>

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
      {[...byDay].map(([day, list]) => (
        <DaySection key={day} day={day} list={list} order={ORDER} legsOf={legsOf} />
      ))}
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

const betsSettled = (l: Bet[]) => l.filter((b) => b.status !== 'open')

/** One day's bets, a section per mind. A section renders its bets only once opened: a day can hold hundreds. */
function DaySection({ day, list, order, legsOf }: { day: string; list: Bet[]; order: string[]; legsOf: (id: number) => Leg[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const done = betsSettled(list)
  const net = done.reduce((a, b) => a + (b.profit ?? 0), 0)
  const toggle = (m: string) => setOpen((o) => { const n = new Set(o); if (n.has(m)) n.delete(m); else n.add(m); return n })
  return (
    <div className="space-y-1">
      <div className="text-xs text-neutral-500">
        {dayLabel(day)} · {list.length} bets · {done.length} settled{done.length > 0 && <> · <span className="tabular-nums text-neutral-300">{signed(net)} units</span></>}
      </div>
      {order.map((m) => {
        const mine = list.filter((b) => b.mind === m)
        if (!mine.length) return null
        const mDone = betsSettled(mine)
        const mNet = mDone.reduce((a, b) => a + (b.profit ?? 0), 0)
        const isOpen = open.has(m)
        // singles by the player's team, combos together
        const groups = new Map<string, Bet[]>()
        if (isOpen) for (const b of mine) {
          const key = b.kind === 'combo' ? 'Doubles and parlays' : legsOf(b.id)[0]?.team ?? 'Other'
          ;(groups.get(key) ?? groups.set(key, []).get(key)!).push(b)
        }
        return (
          <div key={m} className="rounded-lg bg-neutral-900">
            <button onClick={() => toggle(m)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[m] }} />
              <span className="w-32 text-neutral-200">{NAMES[m] ?? m}</span>
              <span className="tabular-nums text-neutral-400">{mine.length} bets</span>
              <span className="tabular-nums text-neutral-500">{mine.filter((b) => b.kind === 'combo').length} combos</span>
              <span className="tabular-nums text-neutral-500">{mDone.length} settled{mDone.length > 0 && ` · ${signed(mNet)} units`}</span>
              <span className="ml-auto text-neutral-500">{isOpen ? 'Hide' : 'Show'}</span>
            </button>
            {isOpen && (
              <div className="space-y-1 px-2 pb-2">
                {[...groups].map(([team, bs]) => (
                  <div key={team} className="space-y-1">
                    <div className="px-1 pt-1 text-[11px] uppercase tracking-widest text-neutral-500">{team} <span className="normal-case tracking-normal text-neutral-600">{bs.length} bets</span></div>
                    {bs.map((b) => <BetRow key={b.id} b={b} legs={legsOf(b.id)} />)}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function BetRow({ b, legs }: { b: Bet; legs: Leg[] }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-0.5 rounded-md bg-neutral-950/50 px-3 py-1.5 text-xs">
      <div className="min-w-0 flex-1 space-y-0.5">
        {legs.map((l) => <LegRow key={l.idx} l={l} />)}
      </div>
      <div className="text-right tabular-nums text-neutral-400">
        {b.kind === 'combo' ? `${legs.length}-leg ` : 'single '}{b.odds.toFixed(2)}x · says {p0(b.prob)} · EV {signed(b.ev * 100, 1)}%
        <div className="text-neutral-200">{STATUS[b.status]}{b.profit != null ? ` ${signed(b.profit)}` : ''}</div>
      </div>
    </div>
  )
}
