import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHIEF } from '../../shared/minds'
import { INK, MIND_COLOR } from '../lib/colors'
import { STAT_LABEL, api, pct } from '../lib/format'
import { teamByName } from '../lib/teams'
import Headshot from './Headshot'
import LazyMount from './LazyMount'
import { PickBars, PickSpark } from './PickSpark'
import MindsCharts from './MindsCharts'

interface Bet {
  id: number; day: string; mind: string; kind: string; odds: number; prob: number; ev: number; status: string; profit: number | null
  proposedBy: string | null; pCons: number | null; evCons: number | null; rationale: string | null; research: number
  tier: string; stake: number
}
interface Rejection { id: number; day: string; proposedBy: string; playerId: number; player: string; stat: string; side: string; line: number; price: number; game: string | null; reason: string; detail: string | null; pCons: number | null; evCons: number | null; result: string | null; actual: number | null }
interface Audit { reason: string; n: number; graded: number; won: number; lost: number; units: number }
interface Calib { stat: string; band: string; n: number; said: number; cons: number | null; got: number }
interface Leg {
  betId: number; idx: number; playerId: number; player: string; stat: string; side: string; line: number; price: number
  book: string | null; gameDate: string; prob: number; modelProb: number | null; marketProb: number | null; actual: number | null; result: string | null
  /** The player's last 10 regular-season games before this bet, oldest first. */
  recent: number[]
  eventId: string | null
  team: string | null
  tipOff: string | null
  homeTeam: string | null
  awayTeam: string | null
  pCons: number | null
  matchupScore: number | null
  skepticFlags: string | null
}
interface Sum {
  mind: string; bets: number; settled: number; won: number; lost: number; open: number; units: number
  statedProb: number | null; consProb: number | null; actualRate: number | null; statedEv: number | null; avgEvCons: number | null
  staked: number | null; avgOdds: number | null; avgEv: number | null; combos: number; singles: number; days: number
  bestWin: number | null; worstLoss: number | null
}
interface Res { data: { bets: Bet[]; legs: Leg[]; summary: Sum[]; curve: { mind: string; day: string; units: number }[]; minBets: number; version: string; current: string; versions: { version: string; bets: number; settled: number; since: string | null }[]
  ranDays: string[]; audit: Audit[]; rejections: Rejection[]; calibration: Calib[] } }

const NAMES: Record<string, string> = { chief: 'Strict bets (the Chief)', lean: 'Leans (half stake)', sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat', research: 'Lou: research parlays', control: 'Control (random)' }
const STYLE: Record<string, string> = {
  chief: 'full-stake bets that cleared every check',
  lean: 'a real model edge that is too uncertain for a full bet',
  research: 'parlays: tracked and graded, never staked (independence unvalidated)',
  sam: 'proposes the likeliest outcomes, if they still pay',
  val: 'proposes the biggest conservative expected value',
  lou: 'builds parlays from qualified legs',
  cat: 'proposes where the model beats a market that rates the side under 50%',
  control: 'random picks from the same pool: the benchmark to beat',
}
const c = CHIEF
const p0 = (x: number) => `${Math.round(x * 100)}%`
// Read from the frozen config, so this text can never drift from what the Chief actually does.
const RULES: Record<string, string[]> = {
  sam: [`Proposes singles whose estimated win chance is ${p0(c.sam.minProb)} or more and whose conservative expected value is not negative. No minimum number.`],
  val: [`Proposes singles with a conservative expected return of +${p0(c.val.minEvCons)} or more and an estimated win chance of ${p0(c.val.minProb)} or more, ranked by that conservative value.`],
  cat: [`Proposes where the market rates the side below ${p0(c.cat.maxMarketProb)} but the model is higher by ${p0(c.cat.minGap)} or more, with +${p0(c.cat.minEvCons)} conservative value, and only if the matchup explains why.`],
  lou: [`Builds parlays of ${c.lou.minLegs} to ${c.lou.maxLegs} legs from different games, each leg individually clearing +${p0(c.lou.minLegEvCons)} conservative value and a ${p0(c.lou.minLegPCons)} conservative chance. The whole parlay needs +${p0(c.lou.minEvCons)} on the product of conservative chances. At most ${c.lou.maxParlays} a day, never topped up, and research-only.`],
}
const PIPELINE = [
  `1. Eligibility: fresh projection (under ${c.maxProjectionAgeHours}h), ${c.minSample}+ games, ${c.minMarketBooks}+ books quoting both sides, a team's top ${c.starterTopN} by minutes and ${c.minRoleMinutes}+ minutes.`,
  `2. Quant: the model's chance is corrected for its measured overconfidence, blended with the market, then cut by ${c.haircutZ} standard errors for how little history supports it. Every threshold uses that conservative number.`,
  `3. Market: the price counted is the best, capped at ${Math.round((c.priceCorroboration - 1) * 100)}% above the next book, so one stale quote cannot create an edge. A lone price, a stale-looking line, or a price rich against the market's own fair price is rejected. Line movement is not available yet.`,
  `4. Matchup: minutes trend and the opponent's tendency can corroborate or contradict. They never add probability, because the model already sees the opponent.`,
  `5. Skeptic: vetoes injuries, under ${c.minSampleStrict} games, falling minutes, a model/market gap of ${p0(c.maxGap)}+, and recent games that contradict the bet. A gap of ${p0(c.reviewGap)}+ needs the matchup to explain it.`,
  `6. Portfolio: one bet per player and stat, at most ${c.maxBetsPerPlayer} per player and ${c.maxBetsPerGame} per game, ${c.maxDailyBets} a day, and no more than ${p0(c.maxUnderShare)} Unders. These caps only remove bets.`,
  `7. Leans: what step 2's haircut removed. A pick that clears every veto and has a raw edge of +${p0(c.lean.minEvHat)} or more at ${p0(c.lean.minProb)}+ win chance becomes a lean: ${c.lean.stake} unit, one per player, at most ${c.lean.maxPerDay} a day, with its own record. They are the bets the strict tier turns down, so they are weaker evidence.`,
  'The Chief may reject everything. There is no quota, and nothing is topped up. Every rejected candidate is recorded with its reason and graded afterwards, so the filters can be audited.',
  'Flat 1 unit per bet. Grading uses the executable price. Parlays assume independence between games, which is unvalidated, so they are research-only.',
]
const BASE = ['sam', 'val', 'lou', 'cat']
const V4_ORDER = ['chief', 'lean', 'sam', 'val', 'cat', 'research']
const orderFor = (res: Res | null) => (!res ? BASE : res.data.version === res.data.current ? V4_ORDER : [...BASE, ...(res.data.summary.some((s) => s.mind === 'control') ? ['control'] : [])])
const STATUS: Record<string, string> = { open: 'Open', won: 'Won', lost: 'Lost', push: 'Push', void: 'Void' }
const settledStatus = new Set(['won', 'lost', 'push'])
const signed = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export default function Minds({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'open' | 'settled'>('all')
  const [view, setView] = useState<'game' | 'mind'>('game')
  const [dayPick, setDayPick] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => { api<Res>(`/minds${version ? `?version=${version}` : ''}`).then(setRes).catch((e) => setError(e.message)) }, [refreshKey, version])

  const ORDER = orderFor(res)
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
  }, [res]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="text-sm text-neutral-500">Loading…</p>
  const { bets, legs, summary, minBets } = res.data
  const sum = (m: string) => summary.find((s) => s.mind === m)
  const inGroupAll = (b: Bet, m: string) => (m === 'chief' ? b.tier === 'strict' : m === 'lean' ? b.tier === 'lean' : m === 'research' ? b.tier === 'research' : (b.proposedBy ?? b.mind).split(',').includes(m) && b.tier === 'strict')
  const legMap = new Map<number, Leg[]>()
  for (const l of legs) (legMap.get(l.betId) ?? legMap.set(l.betId, []).get(l.betId)!).push(l)
  const legsOf = (id: number) => legMap.get(id) ?? []
  // What the bets were *expected* to earn, to set beside what they did: the honest comparison.
  const expectedUnits = (m: string) => bets.filter((b) => inGroupAll(b, m) && settledStatus.has(b.status)).reduce((a, b) => a + b.ev, 0)

  const proposers = (b: Bet) => (b.proposedBy ?? b.mind).split(',')
  const inGroup = (b: Bet, m: string) => (m === 'chief' ? b.tier === 'strict' : m === 'lean' ? b.tier === 'lean' : m === 'research' ? b.tier === 'research' : proposers(b).includes(m) && b.tier === 'strict')
  const visible = bets.filter((b) =>
    (!pick || inGroup(b, pick)) && (show === 'all' || (show === 'open' ? b.status === 'open' : b.status !== 'open')))
  const days = [...new Set([...bets.map((b) => b.day), ...res.data.ranDays])].sort().reverse()
  const selDay = dayPick && days.includes(dayPick) ? dayPick : days[0]
  const byDay = new Map<string, Bet[]>()
  for (const b of visible) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b)

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        {res.data.version === res.data.current
          ? 'Four specialists propose; one strict Chief decides. Strict bets are full stake and may be none at all; leans are a smaller stake on weaker edges. No quotas.'
          : 'An archived rule set.'}{' '}Each decision is frozen when it is made and graded from box scores. No verdict before {minBets} settled bets:
        until then, treat every number below as noise. Click a card to see only its bets.
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


      <div className={`grid gap-2 sm:grid-cols-2 ${ORDER.length > 5 ? 'xl:grid-cols-6' : ORDER.length > 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
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
        <summary className="cursor-pointer text-neutral-300">How it decides{pick && RULES[pick] ? `: ${NAMES[pick]}` : ''}</summary>
        {res.data.version !== res.data.current ? (
          <p className="mt-2 text-neutral-500">This is an archived rule set ({res.data.version.replace('minds-', 'v')}). Its rules are in research/PREREG_MINDS*.md. It is shown for comparison and never added to the current record.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {(pick && RULES[pick] ? [pick] : Object.keys(RULES)).map((m) => (
              <div key={m}>
                <div className="flex items-center gap-2 text-neutral-200"><span className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[m] }} />{NAMES[m]}</div>
                <ul className="ml-4 list-disc text-neutral-400">{RULES[m].map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            ))}
            <ul className="space-y-1 border-t border-neutral-800 pt-2 text-neutral-500">{PIPELINE.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
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

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm text-neutral-300">Bets{pick ? `: ${NAMES[pick]}` : ''} <span className="text-xs text-neutral-600">{visible.length}</span></h2>
        <div className="flex overflow-hidden rounded-md bg-neutral-900 text-xs">
          {([['game', 'By game'], ['mind', 'By mind']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 ${view === v ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{label}</button>
          ))}
        </div>
        {view === 'game' && days.length > 1 && (
          <div className="flex overflow-hidden rounded-md bg-neutral-900 text-xs">
            {days.slice(0, 7).map((d) => (
              <button key={d} onClick={() => setDayPick(d)} className={`px-3 py-1 ${d === selDay ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{dayLabel(d)}</button>
            ))}
          </div>
        )}
        <div className="ml-auto flex overflow-hidden rounded-md bg-neutral-900 text-xs">
          {(['all', 'open', 'settled'] as const).map((v) => (
            <button key={v} onClick={() => setShow(v)} className={`px-3 py-1 capitalize ${show === v ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{v}</button>
          ))}
        </div>
      </div>

      {visible.length === 0 && !(view === 'game' && res.data.ranDays.includes(selDay)) && (
        <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">
          {bets.length === 0 ? <>No cards yet. Run <code className="text-neutral-300">node minds/run.mjs</code> to generate today's bets.</> : 'No bets match this filter.'}
        </p>
      )}
      {view === 'game' && visible.every((b) => b.day !== selDay) && res.data.ranDays.includes(selDay) && (
        <NoBets day={selDay} rejections={res.data.rejections.filter((r) => r.day === selDay)} />
      )}
      {view === 'game' && visible.some((b) => b.day === selDay && b.tier !== 'strict' && b.tier !== 'research') && !visible.some((b) => b.day === selDay && b.tier === 'strict') && (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300">
          <b className="font-medium text-neutral-100">No strict bets for {dayLabel(selDay)}.</b> The cards below are <b className="font-medium text-neutral-100">leans</b>: the model sees a real edge, but it does not survive the uncertainty haircut. Half stake, lower confidence, and tracked apart from the strict record.
        </p>
      )}
      {view === 'game'
        ? <ScheduleView bets={visible.filter((b) => b.day === selDay)} legsOf={legsOf} />
        : [...byDay].map(([day, list]) => <DaySection key={day} day={day} list={list} order={ORDER.filter((m) => m !== 'chief' && m !== 'research')} legsOf={legsOf} />)}

      {res.data.rejections.length > 0 && <Rejections audit={res.data.audit} rejections={res.data.rejections} day={view === 'game' ? selDay : null} />}
      {res.data.calibration.length > 0 && <CalibrationTable rows={res.data.calibration} />}
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

// ---------- by schedule ----------

const tipLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'time unknown')
const abbr = (name: string | null) => (name ? teamByName(name)?.[0] ?? name : '?')
const STATE_COLOR: Record<string, string> = { won: '#0ca30c', lost: '#d03b3b' }
const statusText = (b: Bet) => (b.status === 'open' ? 'open' : `${STATUS[b.status]}${b.profit != null ? ` ${signed(b.profit)}` : ''}`)

interface GameGroup { key: string; tip: string | null; home: string | null; away: string | null; bets: Bet[] }

/** The day's bets as a grid of game cards in tip-off order, so a night's slate reads like a schedule instead of a long list. */
function ScheduleView({ bets, legsOf }: { bets: Bet[]; legsOf: (id: number) => Leg[] }) {
  const singles = bets.filter((b) => b.kind === 'single')
  const combos = bets.filter((b) => b.kind === 'combo')
  const groups = new Map<string, GameGroup>()
  for (const b of singles) {
    const l = legsOf(b.id)[0]
    if (!l) continue
    const key = l.eventId ?? `${l.gameDate}|${l.team ?? '?'}`
    const g = groups.get(key) ?? groups.set(key, { key, tip: l.tipOff, home: l.homeTeam, away: l.awayTeam, bets: [] }).get(key)!
    g.bets.push(b)
  }
  const games = [...groups.values()].sort((a, b) => (a.tip ?? '9').localeCompare(b.tip ?? '9') || a.key.localeCompare(b.key))
  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {games.map((g) => <GameCard key={g.key} g={g} legsOf={legsOf} />)}
      </div>
      {combos.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-widest text-neutral-500">
            {combos.every((b) => b.research) ? 'Research only: parlays (tracked, not staked)' : 'Doubles and parlays'} <span className="normal-case tracking-normal text-neutral-600">{combos.length}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {combos.map((b) => <ComboCard key={b.id} b={b} legs={legsOf(b.id)} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function GameCard({ g, legsOf }: { g: GameGroup; legsOf: (id: number) => Leg[] }) {
  const done = g.bets.filter((b) => b.status !== 'open')
  const net = done.reduce((a, b) => a + (b.profit ?? 0), 0)
  // away team's bets first, then the home team's
  const byTeam = new Map<string, Bet[]>()
  for (const b of g.bets) { const t = legsOf(b.id)[0]?.team ?? '?'; (byTeam.get(t) ?? byTeam.set(t, []).get(t)!).push(b) }
  const awayAbbr = abbr(g.away)
  const teams = [...byTeam].sort((a, b) => (a[0] === awayAbbr ? -1 : b[0] === awayAbbr ? 1 : 0))
  return (
    <div className="rounded-lg bg-neutral-900">
      <div className="flex items-baseline gap-2 border-b border-neutral-800 px-3 py-1.5">
        <span className="text-sm text-neutral-100">{g.away ? `${abbr(g.away)} @ ${abbr(g.home)}` : 'Game unknown'}</span>
        <span className="text-xs text-neutral-500">{tipLabel(g.tip)}</span>
        <span className="ml-auto text-[11px] tabular-nums text-neutral-500">{g.bets.length} bets{done.length > 0 && ` · ${done.length} settled · ${signed(net)}`}</span>
      </div>
      <div className="px-1 py-1">
        {teams.map(([team, bs]) => (
          <div key={team}>
            <div className="px-2 pt-1 text-[10px] uppercase tracking-widest text-neutral-600">{team}</div>
            {mergeSame(bs, legsOf).map((m) => <MiniBet key={m.bets[0].id} bets={m.bets} l={m.leg} />)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** When several minds make the same bet (same player, line and side) it is one row with a dot per mind, not three copies. */
function mergeSame(bs: Bet[], legsOf: (id: number) => Leg[]): { bets: Bet[]; leg: Leg }[] {
  const by = new Map<string, { bets: Bet[]; leg: Leg }>()
  for (const b of [...bs].sort((x, y) => y.ev - x.ev)) {
    const l = legsOf(b.id)[0]
    const k = `${l.playerId}|${l.stat}|${l.line}|${l.side}`
    const e = by.get(k)
    if (e) e.bets.push(b); else by.set(k, { bets: [b], leg: l })
  }
  return [...by.values()]
}

/** One single on one line; click it for the full numbers and the player's recent games. */
function MiniBet({ bets, l }: { bets: Bet[]; l: Leg }) {
  const [open, setOpen] = useState(false)
  const b = bets[0]
  const who = [...new Set(bets.flatMap((x) => (x.proposedBy ?? x.mind).split(',')))]
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left text-xs hover:bg-neutral-800/60">
        <span className="flex w-8 shrink-0 gap-0.5" title={who.map((m) => NAMES[m] ?? m).join(', ')}>
          {who.map((m) => <span key={m} className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[m] }} />)}
        </span>
        <span className="min-w-0 flex-1 truncate text-neutral-100">{l.player}{b.tier === 'lean' && <span className="ml-1.5 rounded border border-[#86b6ef] px-1 text-[9px] tracking-wide text-[#86b6ef]" title="A lean: half stake, lower confidence">LEAN {b.stake}u</span>}</span>
        <span className="shrink-0 text-neutral-400">{l.side === 'over' ? 'O' : 'U'} {l.line} {STAT_LABEL[l.stat] ?? l.stat}</span>
        <span className="w-10 shrink-0 text-right tabular-nums text-neutral-300">{l.price.toFixed(2)}</span>
        <span className="w-12 shrink-0 text-right tabular-nums text-neutral-500">{signed(b.ev * 100, 1)}%</span>
        <span className="w-14 shrink-0 text-right tabular-nums" style={{ color: STATE_COLOR[b.status] ?? '#737373' }}>{statusText(b)}</span>
      </button>
      {open && (
        <div className="mx-2 mb-1 space-y-1 rounded bg-neutral-950/60 px-2 py-1.5">
          <LegRow l={l} />
          <Why b={b} l={l} />
        </div>
      )}
    </div>
  )
}

function ComboCard({ b, legs }: { b: Bet; legs: Leg[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg bg-neutral-900 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[b.mind] }} />
        <span className="text-neutral-200">{NAMES[b.mind]}</span>
        <span className="text-neutral-500">{legs.length}-leg</span>
        <span className="ml-auto tabular-nums text-neutral-400">{b.odds.toFixed(2)}x · says {p0(b.prob)} · EV {signed(b.ev * 100, 1)}%</span>
        <span className="w-16 text-right tabular-nums" style={{ color: STATE_COLOR[b.status] ?? '#737373' }}>{statusText(b)}</span>
        {b.rationale && <button className="text-neutral-500 hover:text-neutral-300" onClick={() => setOpen(!open)} aria-expanded={open}>why</button>}
      </div>
      {open && <Why b={b} />}
      <div className="mt-1 space-y-0.5">
        {legs.map((l) => (
          <div key={l.idx} className="flex items-center gap-2 text-neutral-300">
            <span className="min-w-0 flex-1 truncate text-neutral-100">{l.player}</span>
            <span className="shrink-0 text-neutral-400">{l.side === 'over' ? 'O' : 'U'} {l.line} {STAT_LABEL[l.stat] ?? l.stat}</span>
            <span className="w-10 shrink-0 text-right tabular-nums">{l.price.toFixed(2)}</span>
            <span className="w-24 shrink-0 text-right text-[11px] text-neutral-600">{l.awayTeam ? `${abbr(l.awayTeam)} @ ${abbr(l.homeTeam)} ${tipLabel(l.tipOff)}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The reasoning behind a bet: what the Quant, Market, Matchup and Skeptic each said. Older versions have none. */
function Why({ b, l }: { b: Bet; l?: Leg }) {
  let lines: string[] = []
  try { lines = b.rationale ? (JSON.parse(b.rationale) as string[]) : [] } catch { lines = [] }
  if (!lines.length) return null
  return (
    <div className="space-y-0.5 border-t border-neutral-800 pt-1 text-[11px] text-neutral-400">
      {lines.map((x) => <p key={x}>{x}</p>)}
      {b.evCons != null && (
        <p className="text-neutral-500">
          Says {pct(b.prob)}, conservative {pct(b.pCons)}; value {signed(b.ev * 100, 1)}% expected, {signed(b.evCons * 100, 1)}% conservative.
          {l?.skepticFlags ? ` Flags: ${l.skepticFlags}.` : ''}
        </p>
      )}
    </div>
  )
}

const REASON: Record<string, string> = {
  watchlist: 'closest to qualifying (not a bet)',
  uncertainty_haircut: 'a raw edge that did not survive the uncertainty haircut',
  injury_listed: 'listed on the injury report',
  thin_history: 'too few games behind the estimate',
  minutes_dropping: 'minutes falling',
  extreme_gap: 'model and market too far apart',
  form_contradiction: 'recent games contradict the bet',
  unresolved_review: 'a big disagreement the matchup did not explain',
  cat_uncorroborated: 'the market disagrees and nothing explains why',
  matchup_contradicted: 'the opponent works against it',
  single_price: 'only one book offers this price',
  stale_line: 'the best price looks stale',
  rich_price: 'the price is rich against the market',
  duplicate_exposure: 'a better line on the same player and stat was chosen',
  player_cap: 'too many bets on one player',
  game_cap: 'too many bets in one game',
  daily_cap: "the day's limit was reached",
  under_share_cap: 'too many Unders on one card',
}

function NoBets({ day, rejections }: { day: string; rejections: Rejection[] }) {
  const rejected = rejections.filter((r) => r.reason !== 'watchlist')
  const watch = rejections.filter((r) => r.reason === 'watchlist').sort((a, b) => (b.evCons ?? -1) - (a.evCons ?? -1)).slice(0, 6)
  const top = Object.entries(rejected.reduce<Record<string, number>>((a, r) => ((a[r.reason] = (a[r.reason] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 4)
  return (
    <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <div>
        <b className="font-medium text-neutral-100">No bets for {dayLabel(day)}.</b> The Chief reviewed the slate and nothing cleared the thresholds. That is the intended default, not a failure.
        {top.length > 0 && <span className="text-neutral-500"> Candidates it turned down: {top.map(([r, n]) => `${n} ${REASON[r] ?? r}`).join('; ')}.</span>}
      </div>
      {watch.length > 0 && (
        <div className="text-xs">
          <div className="mb-1 uppercase tracking-widest text-neutral-500">Closest to qualifying <span className="normal-case tracking-normal text-neutral-600">watchlist: tracked and graded, never bet</span></div>
          {watch.map((r) => (
            <div key={r.id} className="flex items-baseline gap-2 text-neutral-400" title={r.detail ?? ''}>
              <span className="w-40 truncate text-neutral-200">{r.player}</span>
              <span className="w-24">{r.side === 'over' ? 'O' : 'U'} {r.line} {STAT_LABEL[r.stat] ?? r.stat}</span>
              <span className="w-10 tabular-nums">{r.price.toFixed(2)}</span>
              <span className="tabular-nums text-neutral-500">conservative value {r.evCons == null ? '–' : `${signed(r.evCons * 100, 1)}%`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Everything the Chief turned down, and what those would have done, so each filter can be judged by its results. */
function Rejections({ audit, rejections, day }: { audit: Audit[]; rejections: Rejection[]; day: string | null }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const shown = rejections.filter((r) => (!day || r.day === day) && (!reason || r.reason === reason))
  return (
    <div className="rounded-lg bg-neutral-900 px-3 py-2 text-xs">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-neutral-300">
        Rejected candidates <span className="text-neutral-600">{audit.reduce((a, r) => a + r.n, 0)} in all</span>
        <span className="ml-auto text-neutral-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <table className="w-full text-left">
            <thead className="text-neutral-500"><tr><th className="py-1 font-normal">Reason</th><th className="font-normal">Count</th><th className="font-normal">Graded</th><th className="font-normal" title="Of the graded ones, how many would have won">Would have won</th><th className="font-normal" title="Units if every graded one had been bet at the price shown. Not a result: it is what the filter saved or cost.">If bet</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.reason} className={`cursor-pointer border-t border-neutral-800 hover:bg-neutral-800/60 ${reason === a.reason ? 'bg-neutral-800/60' : ''}`} onClick={() => setReason(reason === a.reason ? null : a.reason)}>
                  <td className="py-1 text-neutral-300">{REASON[a.reason] ?? a.reason}</td>
                  <td className="tabular-nums text-neutral-400">{a.n}</td>
                  <td className="tabular-nums text-neutral-400">{a.graded}</td>
                  <td className="tabular-nums text-neutral-400">{a.graded ? `${a.won}/${a.won + a.lost}` : '–'}</td>
                  <td className="tabular-nums text-neutral-400">{a.graded ? signed(a.units) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-neutral-600">Click a reason to list its candidates{day ? ` for ${dayLabel(day)}` : ''}. {shown.length} shown.</p>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {shown.slice(0, 150).map((r) => (
              <div key={r.id} className="flex items-baseline gap-2 text-neutral-400" title={r.detail ?? ''}>
                <span className="w-40 truncate text-neutral-200">{r.player}</span>
                <span className="w-24">{r.side === 'over' ? 'O' : 'U'} {r.line} {STAT_LABEL[r.stat] ?? r.stat}</span>
                <span className="w-10 tabular-nums">{r.price.toFixed(2)}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-500">{REASON[r.reason] ?? r.reason}{r.detail ? `: ${r.detail}` : ''}</span>
                {r.result && <span className="w-12 text-right" style={{ color: STATE_COLOR[r.result] ?? '#737373' }}>{r.result}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Does "60%" win 60% of the time? By statistic and price band, over settled staked singles. */
function CalibrationTable({ rows }: { rows: Calib[] }) {
  return (
    <div className="rounded-lg bg-neutral-900 px-3 py-2 text-xs">
      <h3 className="mb-1 text-neutral-300">Calibration by statistic and price</h3>
      <table className="w-full text-left">
        <thead className="text-neutral-500"><tr><th className="py-1 font-normal">Stat</th><th className="font-normal">Price</th><th className="font-normal">Bets</th><th className="font-normal">Said</th><th className="font-normal">Conservative</th><th className="font-normal">Got</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.stat}${r.band}`} className="border-t border-neutral-800 text-neutral-300">
              <td className="py-1">{STAT_LABEL[r.stat] ?? r.stat}</td><td>{r.band}</td><td className="tabular-nums">{r.n}</td>
              <td className="tabular-nums">{pct(r.said)}</td><td className="tabular-nums">{r.cons == null ? '–' : pct(r.cons)}</td><td className="tabular-nums">{pct(r.got)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-neutral-600">Small groups say nothing: wait for dozens of bets in a row of this table before reading it.</p>
    </div>
  )
}
