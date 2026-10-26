import { useEffect, useState } from 'react'
import { reasonLabel } from '../../shared/engine/reasons.ts'
import { CHIEF } from '../../shared/minds'
import { MIND_COLOR } from '../lib/colors'
import { STAT_LABEL, api, pct } from '../lib/format'
import { teamByName } from '../lib/teams'
import Headshot from './Headshot'
import { PickSpark } from './PickSpark'
import PickBars from './PickBars'

interface Bet {
  id: number; day: string; mind: string; kind: string; odds: number; prob: number; ev: number; status: string; profit: number | null
  proposedBy: string | null; pCons: number | null; evCons: number | null; rationale: string | null; research: number
  tier: string; stake: number
}
interface Rejection { id: number; day: string; proposedBy: string; playerId: number; player: string; stat: string; side: string; line: number; price: number; game: string | null; reason: string; detail: string | null; pCons: number | null; evCons: number | null; result: string | null; actual: number | null }
interface Audit { reason: string; n: number; graded: number; won: number; lost: number; units: number }
interface Calib { tier: string; stat: string; band: string; n: number; said: number; cons: number | null; got: number }
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
interface Res { data: { bets: Bet[]; legs: Leg[]; summary: Sum[]; curve: { mind: string; day: string; units: number }[]; minBets: number; minDays?: number; version: string; current: string; versions: { version: string; bets: number; settled: number; since: string | null }[]
  ranDays: string[]; audit: Audit[]; rejections: Rejection[]; calibration: Calib[] } }

const NAMES: Record<string, string> = { chief: 'Strict bets (the Chief)', lean: 'Leans (SHADOW_ONLY)', volume: 'Volume board (paper)', sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat', research: 'Lou: research parlays', control: 'Control (random)' }
const STYLE: Record<string, string> = {
  chief: 'full-stake bets that cleared every check',
  lean: 'SHADOW_ONLY: a raw edge that fails the conservative test; hypothetical half stake, never a recommendation',
  volume: 'paper only: many lines per game, graded for evidence, never bet',
  research: 'RESEARCH_ONLY: parlays and thin-history or unvalidated singles; graded, never staked',
  sam: 'proposes likely outcomes that still have non-negative conservative value. A name, not a safety rating: likely is not safe',
  val: 'proposes the biggest conservative expected value',
  lou: 'builds parlays from qualified legs',
  cat: 'proposes where the model beats a market that rates the side under 50%',
  control: 'random picks from the same pool: the benchmark to beat',
}
const c = CHIEF
const p0 = (x: number) => `${Math.round(x * 100)}%`
// Read from the frozen config, so this text can never drift from what the Chief actually does.
const RULES: Record<string, string[]> = {
  sam: [`Proposes singles whose conservative win chance is ${p0(c.sam.minProbability)} or more and whose conservative expected value is not negative. No minimum number.`],
  val: [`Proposes singles with a conservative expected return of +${p0(c.val.minEvConservative)} or more and a conservative win chance of ${p0(c.val.minProbability)} or more, ranked by that conservative value.`],
  cat: [`Proposes where the market rates the side below ${p0(c.cat.maxMarketProbability)} but the calibrated model is higher by ${p0(c.cat.minGap)} or more, with +${p0(c.cat.minEvConservative)} conservative value, and only if the matchup gives a specific reason.`],
  lou: [`RESEARCH_ONLY. Builds parlays of ${c.lou.minLegs} to ${c.lou.maxLegs} legs from different games, each leg individually clearing +${p0(c.lou.minLegEv)} value and a ${p0(c.lou.minLegProbability)} chance. The whole parlay needs +${p0(c.lou.minParlayEv)} on the product of the legs. At most ${c.lou.maxParlaysPerDay} a day, never topped up. The independence assumption is an unvalidated baseline.`],
}
const PIPELINE = [
  `1. Eligibility (one shared policy): fresh projection (under ${c.eligibility.maxProjectionAgeHours}h), ${c.eligibility.minGamesStrict}+ games (${c.eligibility.minGamesResearch}-${c.eligibility.minGamesStrict - 1} is research-only), top ${c.eligibility.topNByMinutes} on the team by minutes and ${c.eligibility.minMinutes}+ minutes, ${c.eligibility.minIndependentBooks}+ independent books quoting both sides with fresh timestamps, verified injury status and player identity. Anything missing is rejected with a reason code.`,
  `2. Probability: the model is calibrated on out-of-sample data, blended with the market's vig-free fair probability, then lowered to a bounded lower estimate (${c.probability.confidenceLevel}% one-sided) from the calibration's own measured error. Statistics whose calibration failed validation cannot be approved as strict bets.`,
  `3. Market consensus: the executable price is the best fresh price, capped at ${Math.round((c.market.priceCorroboration - 1) * 100)}% above the next independent book. Stale-looking or inconsistent prices and disagreeing books are rejected. Line movement is not available yet.`,
  `4. Matchup and skeptic: minutes trend and the opponent's tendency corroborate or contradict. A model/market gap of ${p0(c.eligibility.reviewGap)}+ needs a documented matchup reason and ${p0(c.eligibility.extremeGap)}+ is rejected outright.`,
  `5. Specialists propose; the Chief recomputes every threshold from the engine's own numbers and ignores anything else a proposal says.`,
  `6. Portfolio: one bet per player and stat, at most ${c.portfolio.maxStrictPerPlayer} per player and ${c.portfolio.maxStrictPerGame} per game, ${c.portfolio.maxStrictPerDay} a day, and no more than ${p0(c.portfolio.maxUnderShare)} Unders. These caps only remove bets.`,
  `7. SHADOW_ONLY leans: raw edge of +${p0(c.lean.minRawEv)} or more at ${p0(c.lean.minRawProbability)}+ win chance that fail strict approval only on the conservative threshold. One per player, at most ${c.lean.maxPerDay} a day, graded at a hypothetical ${c.lean.hypotheticalStake} unit and never counted as strict bets.`,
  'The Chief may reject everything. There is no quota, and nothing is topped up. Every candidate is stored as an immutable snapshot with its reason codes and graded afterwards, so the filters can be audited.',
  'Flat 1 unit per strict bet. Grading uses the executable price. Probabilities are unproven against historical sportsbook lines: nothing here promises profit.',
]
const BASE = ['sam', 'val', 'lou', 'cat']
const V4_ORDER = ['chief', 'lean', 'sam', 'val', 'cat', 'volume', 'research']
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
  const [board, setBoard] = useState<'bets' | 'volume'>('bets')
  const [dayPick, setDayPick] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => { api<Res>(`/minds${version ? `?version=${version}` : ''}`).then((r) => { setRes(r); if (r.data.bets.length && r.data.bets.every((b) => b.tier === 'volume')) setBoard('volume') }).catch((e) => setError(e.message)) }, [refreshKey, version])

  const ORDER = orderFor(res)

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="text-sm text-neutral-500">Loading…</p>
  const { bets, legs, summary, minBets } = res.data
  const minDays = res.data.minDays ?? 20
  const sum = (m: string) => summary.find((s) => s.mind === m)
  const inGroupAll = (b: Bet, m: string) => (m === 'chief' ? b.tier === 'strict' : m === 'lean' ? b.tier === 'lean' : m === 'volume' ? b.tier === 'volume' : m === 'research' ? b.tier === 'research' : (b.proposedBy ?? b.mind).split(',').includes(m) && b.tier === 'strict')
  const legMap = new Map<number, Leg[]>()
  for (const l of legs) (legMap.get(l.betId) ?? legMap.set(l.betId, []).get(l.betId)!).push(l)
  const legsOf = (id: number) => legMap.get(id) ?? []
  // What the bets were *expected* to earn, to set beside what they did: the honest comparison.
  const expectedUnits = (m: string) => bets.filter((b) => inGroupAll(b, m) && settledStatus.has(b.status)).reduce((a, b) => a + b.ev, 0)

  const proposers = (b: Bet) => (b.proposedBy ?? b.mind).split(',')
  const inGroup = (b: Bet, m: string) => (m === 'chief' ? b.tier === 'strict' : m === 'lean' ? b.tier === 'lean' : m === 'volume' ? b.tier === 'volume' : m === 'research' ? b.tier === 'research' : proposers(b).includes(m) && b.tier === 'strict')
  const visible = bets.filter((b) =>
    (board === 'volume' ? b.tier === 'volume' : b.tier !== 'volume') && (!pick || inGroup(b, pick)) && (show === 'all' || (show === 'open' ? b.status === 'open' : b.status !== 'open')))
  const days = [...new Set([...bets.map((b) => b.day), ...res.data.ranDays])].sort().reverse()
  const selDay = dayPick && days.includes(dayPick) ? dayPick : days[0]
  const byDay = new Map<string, Bet[]>()
  for (const b of visible) (byDay.get(b.day) ?? byDay.set(b.day, []).get(b.day)!).push(b)

  return (
    <div className="space-y-3 [overflow-wrap:anywhere]">
      <p className="rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
        {res.data.version === res.data.current
          ? 'Four specialists propose; one strict Chief decides. Strict bets are full stake and may be none at all; leans are a smaller stake on weaker edges. No quotas.'
          : 'An archived rule set.'}{' '}Each decision is frozen when it is made and graded from box scores. No verdict before {minBets} settled bets across at least {minDays} different days (one day of bets is one correlated sample):
        until then, treat every number below as noise. Click a card to see only its bets.
      </p>
      {res.data.versions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          Rule set:
          <div className="flex max-w-full overflow-x-auto rounded-md bg-neutral-900">
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


      <div className={`grid gap-2 sm:grid-cols-2 ${ORDER.length > 6 ? 'xl:grid-cols-7' : ORDER.length > 5 ? 'xl:grid-cols-6' : ORDER.length > 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
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
                <div className="h-full transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, Math.min(settled / minBets, (s?.days ?? 0) / minDays) * 100)}%`, background: MIND_COLOR[m] }} />
              </div>
              <p className="mt-0.5 text-[11px] text-neutral-500">{settled} of {minBets} settled bets · {s?.days ?? 0} of {minDays} days</p>
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

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm text-neutral-300">Bets{pick ? `: ${NAMES[pick]}` : ''} <span className="text-xs text-neutral-600">{visible.length}</span></h2>
        {bets.some((b) => b.tier === 'volume') && (
          <div className="flex max-w-full overflow-x-auto rounded-md bg-neutral-900 text-xs">
            {([['bets', 'Bets'], ['volume', 'Volume board (paper)']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setBoard(v)} className={`px-3 py-1 ${board === v ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{label}</button>
            ))}
          </div>
        )}
        <div className="flex max-w-full overflow-x-auto rounded-md bg-neutral-900 text-xs">
          {([['game', 'By game'], ['mind', 'By mind']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 ${view === v ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{label}</button>
          ))}
        </div>
        {view === 'game' && days.length > 1 && (
          <div className="flex max-w-full overflow-x-auto rounded-md bg-neutral-900 text-xs">
            {days.slice(0, 7).map((d) => (
              <button key={d} onClick={() => setDayPick(d)} className={`px-3 py-1 ${d === selDay ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{dayLabel(d)}</button>
            ))}
          </div>
        )}
        <div className="ml-auto flex max-w-full overflow-x-auto rounded-md bg-neutral-900 text-xs">
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
      {board === 'volume' && <VolumeNote bets={visible.filter((b) => b.day === selDay)} legsOf={legsOf} />}
      {board === 'bets' && view === 'game' && visible.every((b) => b.day !== selDay) && res.data.ranDays.includes(selDay) && (
        <NoBets day={selDay} rejections={res.data.rejections.filter((r) => r.day === selDay)} />
      )}
      {view === 'game' && visible.some((b) => b.day === selDay && b.tier !== 'strict' && b.tier !== 'research') && !visible.some((b) => b.day === selDay && b.tier === 'strict') && (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300">
          <b className="font-medium text-neutral-100">No strict bets for {dayLabel(selDay)}.</b> The cards below are <b className="font-medium text-neutral-100">SHADOW_ONLY leans</b>: the raw numbers show an edge, but it fails the conservative test that strict bets must pass. They are graded at a hypothetical half stake and tracked apart from the strict record. They are not recommendations.
        </p>
      )}
      {view === 'game'
        ? <ScheduleView bets={visible.filter((b) => b.day === selDay)} legsOf={legsOf} />
        : [...byDay].map(([day, list]) => <DaySection key={day} day={day} list={list} order={ORDER.filter((m) => m !== 'chief' && m !== 'research')} legsOf={legsOf} />)}

      {res.data.rejections.length > 0 && <Rejections audit={res.data.audit} rejections={res.data.rejections} day={view === 'game' ? selDay : null} />}
      {res.data.calibration.length > 0 && <CalibrationTable rows={res.data.calibration} />}
      <ReportPanel version={res.data.version} />
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
  // A game can hold 40 paper lines: show the 12 with the most value first, the rest on request.
  const [all, setAll] = useState(false)
  const TOP = 12
  const shown = all || g.bets.length <= TOP ? g.bets : [...g.bets].sort((a, b) => b.ev - a.ev).slice(0, TOP)
  const byTeam = new Map<string, Bet[]>()
  for (const b of shown) { const t = legsOf(b.id)[0]?.team ?? '?'; (byTeam.get(t) ?? byTeam.set(t, []).get(t)!).push(b) }
  const awayAbbr = abbr(g.away)
  const teams = [...byTeam].sort((a, b) => (a[0] === awayAbbr ? -1 : b[0] === awayAbbr ? 1 : 0))
  return (
    <div className="min-w-0 rounded-lg bg-neutral-900">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-neutral-800 px-3 py-1.5">
        <span className="text-sm text-neutral-100">{g.away ? `${abbr(g.away)} @ ${abbr(g.home)}` : 'Game unknown'}</span>
        <span className="text-xs text-neutral-500">{tipLabel(g.tip)}</span>
        <span className="ml-auto text-[11px] tabular-nums text-neutral-500">{g.bets.length} bets{done.length > 0 && ` · ${done.length} settled · ${signed(net)}`}</span>
      </div>
      <div className="px-1 py-1">
        {teams.map(([team, bs]) => (
          <div key={team}>
            <div className="px-2 pt-1 text-[11px] uppercase tracking-widest text-neutral-600">{team}</div>
            {mergeSame(bs, legsOf).map((m) => <MiniBet key={m.bets[0].id} bets={m.bets} l={m.leg} />)}
          </div>
        ))}
        {g.bets.length > TOP && (
          <button onClick={() => setAll(!all)} className="w-full px-2 py-1.5 text-center text-[11px] text-neutral-500 hover:text-neutral-300">
            {all ? `Show the top ${TOP} only` : `Show all ${g.bets.length}`}
          </button>
        )}
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
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-800/60">
        <span className="flex w-8 shrink-0 gap-0.5" title={who.map((m) => NAMES[m] ?? m).join(', ')}>
          {who.map((m) => <span key={m} className="h-2 w-2 rounded-full" style={{ background: MIND_COLOR[m] }} />)}
        </span>
        <span className="min-w-0 flex-1 truncate text-neutral-100">{l.player}{b.tier === 'lean' && <span className="ml-1.5 rounded border border-[#86b6ef] px-1 text-[11px] tracking-wide text-[#86b6ef]" title="A lean: half stake, lower confidence">LEAN {b.stake}u</span>}</span>
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


function NoBets({ day, rejections }: { day: string; rejections: Rejection[] }) {
  const rejected = rejections.filter((r) => r.reason !== 'watchlist')
  const watch = rejections.filter((r) => r.reason === 'watchlist').sort((a, b) => (b.evCons ?? -1) - (a.evCons ?? -1)).slice(0, 6)
  const top = Object.entries(rejected.reduce<Record<string, number>>((a, r) => ((a[r.reason] = (a[r.reason] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 4)
  return (
    <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
      <div>
        <b className="font-medium text-neutral-100">No bets for {dayLabel(day)}.</b> The Chief reviewed the slate and nothing cleared the thresholds. That is the intended default, not a failure.
        {top.length > 0 && <span className="text-neutral-500"> Candidates it turned down: {top.map(([r, n]) => `${n} ${reasonLabel(r)}`).join('; ')}.</span>}
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
                  <td className="py-1 text-neutral-300">{reasonLabel(a.reason)}</td>
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
                <span className="min-w-0 flex-1 truncate text-neutral-500">{reasonLabel(r.reason)}{r.detail ? `: ${r.detail}` : ''}</span>
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
        <thead className="text-neutral-500"><tr><th className="py-1 font-normal">Tier</th><th className="font-normal">Stat</th><th className="font-normal">Price</th><th className="font-normal">Bets</th><th className="font-normal">Said</th><th className="font-normal">Conservative</th><th className="font-normal">Got</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.tier}${r.stat}${r.band}`} className="border-t border-neutral-800 text-neutral-300">
              <td className="py-1">{r.tier === 'volume' ? 'volume (paper)' : r.tier}</td><td>{STAT_LABEL[r.stat] ?? r.stat}</td><td>{r.band}</td><td className="tabular-nums">{r.n}</td>
              <td className="tabular-nums">{pct(r.said)}</td><td className="tabular-nums">{r.cons == null ? '–' : pct(r.cons)}</td><td className="tabular-nums">{pct(r.got)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-neutral-600">Small groups say nothing: wait for dozens of bets in a row of this table before reading it.</p>
    </div>
  )
}

/** What the volume board is, how far it reaches per game, and what the average line on it is worth. */
function VolumeNote({ bets, legsOf }: { bets: Bet[]; legsOf: (id: number) => Leg[] }) {
  const perGame = new Map<string, number>()
  for (const b of bets) { const g = legsOf(b.id)[0]?.eventId ?? '?'; perGame.set(g, (perGame.get(g) ?? 0) + 1) }
  const reach = [...perGame.values()].filter((n) => n >= 30).length
  const avgEv = bets.length ? bets.reduce((a, b) => a + b.ev, 0) / bets.length : null
  const positive = bets.filter((b) => b.ev > 0).length
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300">
      <b className="font-medium text-neutral-100">Paper only: {bets.length} lines.</b> Every rotation player's best main line of each statistic, per game, graded afterwards so calibration
      can be read at scale. It is not a list to bet. The values here blend the model with the books' fair price where two sides are quoted (average <b className="font-medium text-neutral-100">{avgEv == null ? '–' : `${avgEv >= 0 ? '+' : ''}${(avgEv * 100).toFixed(1)}%`}</b>, {positive} of {bets.length} above zero) with
      and they still overstate: choosing the better side of every line picks up the model's errors, and a book's margin makes the average line lose.
      {perGame.size > 0 && <> {reach} of {perGame.size} games reach 30 lines; the rest have fewer because books post props for only some players and the model covers only some of those.</>}
    </div>
  )
}

interface Summ { n: number; settled: number; wins: number; losses: number; pushes: number; units: number; staked: number; yield: number | null; hitRate: number | null; hitRateCI: [number, number] | null; yieldCI: [number, number] | null; brier: number | null; logLoss: number | null }
interface Report { version: string; settled: number; days: number; byTier: Record<string, Summ>; byStat: Record<string, Summ>; byOdds: Record<string, Summ>; byProbability: Record<string, Summ>; notes: string[] }

/** Evaluation tables with sample sizes and intervals. Collapsed by default: it is exploratory and says so. */
function ReportPanel({ version }: { version: string }) {
  const [open, setOpen] = useState(false)
  const [rep, setRep] = useState<Report | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!open) return
    let live = true
    api<{ data: Report }>(`/minds/report?version=${version}`).then((r) => live && setRep(r.data)).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [open, version])
  const rng = (x: [number, number] | null, d = 0) => (x ? `${(x[0] * 100).toFixed(d)}% to ${(x[1] * 100).toFixed(d)}%` : '–')
  const table = (title: string, data: Record<string, Summ>) => (
    <div className="overflow-x-auto">
      <div className="mb-1 text-xs uppercase tracking-widest text-neutral-500">{title}</div>
      <table className="w-full whitespace-nowrap text-xs tabular-nums">
        <thead className="text-left text-neutral-500"><tr><th className="py-1 font-normal" /><th className="text-right font-normal">Settled</th><th className="text-right font-normal">Units</th><th className="text-right font-normal">Yield (95% range)</th><th className="text-right font-normal">Hit rate (95% range)</th><th className="text-right font-normal">Brier</th><th className="text-right font-normal">Log loss</th></tr></thead>
        <tbody>
          {Object.entries(data).map(([k, v]) => (
            <tr key={k} className="border-t border-neutral-800 text-neutral-300">
              <td className="py-1 pr-3 text-neutral-200">{k}</td><td className="text-right">{v.settled}</td><td className="text-right">{signed(v.units)}</td>
              <td className="pl-3 text-right">{v.yield == null ? '–' : `${(v.yield * 100).toFixed(1)}%`} <span className="text-neutral-600">({rng(v.yieldCI)})</span></td>
              <td className="pl-3 text-right">{v.hitRate == null ? '–' : `${(v.hitRate * 100).toFixed(0)}%`} <span className="text-neutral-600">({rng(v.hitRateCI)})</span></td>
              <td className="pl-3 text-right">{v.brier == null ? '–' : v.brier.toFixed(3)}</td><td className="pl-3 text-right">{v.logLoss == null ? '–' : v.logLoss.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  return (
    <section className="rounded-lg bg-neutral-900">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-neutral-300">
        Evaluation report <span className="text-xs text-neutral-600">units, yield, Brier, log loss, with ranges</span><span className="ml-auto text-xs text-neutral-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-neutral-800 px-4 py-3">
          {err && <p className="text-xs text-neutral-500">{err}</p>}
          {!rep && !err && <p className="text-xs text-neutral-500">Loading…</p>}
          {rep && (rep.settled === 0 ? <p className="text-sm text-neutral-500">Nothing has settled yet for this rule set.</p> : (
            <>
              {table('By tier', rep.byTier)}
              {table('By statistic (singles)', rep.byStat)}
              {table('By odds (singles)', rep.byOdds)}
              {table('By stated win chance (singles)', rep.byProbability)}
              <ul className="list-disc space-y-1 pl-4 text-xs text-neutral-500">{rep.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </>
          ))}
        </div>
      )}
    </section>
  )
}
