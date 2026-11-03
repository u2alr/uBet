import { useEffect, useMemo, useState } from 'react'
import { gameReasons, type GameLeanRow } from '../../shared/games.ts'
import { normName } from '../../shared/picks.ts'
import type { MoneylineBet, BookLine, TeamBet } from '../../shared/teamBets.ts'
import { commonLean, type TeamForm } from '../../shared/teamForm.ts'
import { api, pct } from '../lib/format'
import { teamByName } from '../lib/teams'
import { TIERS, tierOf } from '../lib/tiers'
import ReasonList from './ReasonList'
import TeamChip from './TeamChip'

interface Row {
  id: string; date: string; state: 'pre' | 'in' | 'post'; status: string
  home: { abbr: string; name: string; score: string }; away: { abbr: string; name: string; score: string }
  bet: TeamBet; books: BookLine[]; form: TeamForm; model: GameLeanRow | null; modelAsOf: string | null
}
interface FormStatus { commonOpponentLean: { games: number; picksWinner: number; homeTeamWon: number }; commonOpponentLeanGap2: { picksWinner: number; games: number } }
interface ModelStatus { version: string; logLoss: number; accuracy: number; testGames: number; testSeason: string; baselineLogLoss: number; baselineName?: string }
interface Res { data: { games: Row[]; best: (MoneylineBet & { gameId: string })[] }; meta: { oddsAvailable: boolean; modelGames: number; note: string; teamForm: FormStatus; model?: ModelStatus } }
interface Absence { id: number; name: string; team: string | null; status: string }

type Sort = 'tip' | 'confident' | 'value'
const SORTS: [Sort, string][] = [['tip', 'Tip-off'], ['confident', 'Most confident'], ['value', 'Best value']]

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const signed = (n: number | null, d = 1) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(d)}`)
const evText = (n: number) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`

const confidence = (p: number) => tierOf(p).label
const pickOf = (r: Row) => {
  const p = r.bet.ours?.homeProb ?? r.bet.market.homeProb
  if (p == null) return null
  const home = p >= 0.5
  return { side: home ? 'home' as const : 'away' as const, team: home ? r.home : r.away, other: home ? r.away : r.home, prob: home ? p : 1 - p }
}

function Chip({ abbr, name, size = 24 }: { abbr: string; name: string; size?: number }) {
  const t = teamByName(name)
  return <span className="flex items-center gap-2">{t && <TeamChip id={t[1]} abbr={t[0]} size={size} />}<span className="font-semibold text-neutral-50">{abbr}</span></span>
}

function Side({ r, side, picked, absent }: { r: Row; side: 'home' | 'away'; picked: boolean; absent: Absence[] }) {
  const t = side === 'home' ? r.home : r.away
  const bet = r.bet.moneyline?.[side]
  const prob = r.bet.ours ? (side === 'home' ? r.bet.ours.homeProb : 1 - r.bet.ours.homeProb) : null
  const out = absent.filter((a) => a.team === t.abbr && a.status === 'out').length
  return (
    <div className={`rounded-xl px-3 py-3 ${picked && prob != null ? tierOf(prob).tint : 'bg-neutral-950/50'}`}>
      <div className="flex items-center justify-between gap-2">
        <Chip abbr={t.abbr} name={t.name} size={28} />
        <span className="flex items-center gap-1.5">
          {picked && <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-neutral-950 ${prob != null ? tierOf(prob).badge : 'bg-neutral-400'}`}>Our pick</span>}
          {bet && bet.ev > 0 && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-emerald-400" title="Expected profit per unit staked at the best price. A rough guide: the game model is untested against sportsbook prices.">value ≈ {evText(bet.ev)}</span>}
        </span>
      </div>
      <div className="mt-0.5 truncate text-xs text-neutral-500">{t.name}{out > 0 && <span className="text-red-300"> · {out} out</span>}</div>
      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="text-2xl tabular-nums text-neutral-50">{prob == null ? '–' : pct(prob)}</div>
          <div className="text-xs text-neutral-500">our chance to win</div>
        </div>
        <div className="text-right">
          <div className="text-2xl tabular-nums text-neutral-50">{bet ? bet.price.toFixed(2) : '–'}</div>
          <div className="text-xs text-neutral-500">{bet ? `best price · ${bet.book}` : 'no price'}</div>
        </div>
      </div>
      {prob != null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800" aria-hidden><div className={picked ? `h-full ${tierOf(prob).bar}` : 'h-full bg-neutral-600'} style={{ width: `${Math.round(prob * 100)}%` }} /></div>}
      {bet && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-neutral-500">
          <span>market {pct(bet.marketProb)}</span>
          <span>model {bet.modelProb == null ? '–' : pct(bet.modelProb)}</span>
          {r.books.filter((b) => b.moneyline).map((b) => <span key={b.key}>{b.title} {b.moneyline![side].toFixed(2)}</span>)}
        </div>
      )}
    </div>
  )
}

function Form({ r }: { r: Row }) {
  const f = r.form
  const lean = commonLean(f)
  const lname = lean === 'a' ? f.a : lean === 'b' ? f.b : null
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <div className="rounded-xl bg-neutral-950/50 px-3 py-2.5">
        <h3 className="mb-1.5 text-xs font-medium text-neutral-300">Head to head <span className="font-normal text-neutral-600">· this season</span></h3>
        {f.meetings.length === 0 ? <p className="text-xs text-neutral-500">These teams have not met yet this season.</p> : (
          <>
            <p className="mb-1 text-xs text-neutral-400">{f.a} {f.aWins}–{f.bWins} {f.b} in {f.meetings.length} meeting{f.meetings.length === 1 ? '' : 's'}</p>
            <ul className="space-y-0.5 text-xs text-neutral-500">
              {f.meetings.slice(0, 4).map((m) => <li key={m.date}>{shortDate(m.date)}: <b className="font-medium text-neutral-300">{m.winner}</b> won{m.home ? ` at ${m.home}` : ''}</li>)}
            </ul>
          </>
        )}
      </div>
      <div className="rounded-xl bg-neutral-950/50 px-3 py-2.5">
        <h3 className="mb-1.5 text-xs font-medium text-neutral-300">Common opponents <span className="font-normal text-neutral-600">· this season</span></h3>
        {f.common.length === 0 ? <p className="text-xs text-neutral-500">These teams have not played a common opponent yet this season.</p> : (
          <>
            <p className="mb-1 text-xs text-neutral-400">
              {lname ? <>Favours <b className="font-medium text-emerald-400">{lname}</b>: better results against {Math.max(f.tally.a, f.tally.b)} of {f.common.length} shared opponents</> : <>Level: {f.tally.a} each way across {f.common.length} shared opponents</>}
            </p>
            <ul className="space-y-0.5 text-xs text-neutral-500">
              {f.common.slice(0, 5).map((c) => {
                const x = (list: typeof c.a) => list[0] ? `${list[0].won ? 'won' : 'lost'} ${list[0].home ? 'home' : 'away'} ${shortDate(list[0].date)}` : '–'
                return <li key={c.opp}><b className={`font-medium ${c.verdict === 'even' ? 'text-neutral-400' : 'text-neutral-300'}`}>{c.opp}</b>: {f.a} {x(c.a)}, {f.b} {x(c.b)}{c.verdict !== 'even' && <span className="text-emerald-400"> → {c.verdict === 'a' ? f.a : f.b}</span>}</li>
              })}
            </ul>
            <p className="mt-1.5 text-xs text-neutral-600">Context, not part of our chance. Weak on its own (one game each, and early in the season there are few).</p>
          </>
        )}
      </div>
    </div>
  )
}

/** The expanded game: both teams side by side with every book's price, the lines, head-to-head, common opponents, the model's reasons and the injury report. */
function GameDetail({ r, absent, onOpenGame, status }: { r: Row; absent: Absence[]; onOpenGame: (id: string) => void; status: FormStatus | undefined }) {
  const pick = pickOf(r)
  const bet = r.bet
  const lineText = bet.market.spread == null ? null : `${r.home.abbr} ${signed(bet.market.spread)}`
  const mine = absent.filter((a) => a.team && [r.home.abbr, r.away.abbr].includes(a.team))
  const counted = new Set([r.model?.absent_home, r.model?.absent_away].flatMap((s) => (s ?? '').split(';')).map((s) => normName(s.replace(/\s*\(\d+ min\)\s*$/, ''))).filter(Boolean))
  const uncertain = mine.filter((a) => a.status !== 'out' || (!!r.model && !counted.has(normName(a.name)))).map((a) => ({ team: a.team!, name: a.name, status: a.status === 'out' ? 'out, not counted' : a.status }))
  const reasons = r.model ? gameReasons(r.model, bet.market.homeProb, uncertain) : []
  return (
    <div className="space-y-3 border-t border-neutral-800 px-3 pb-4 pt-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {pick ? (
          <p className="text-sm text-neutral-300">
            <b className="text-neutral-50">{confidence(pick.prob)}:</b> we think <b className={tierOf(pick.prob).text}>{pick.team.name}</b> win <span className="tabular-nums">({pct(pick.prob)})</span>
            {bet.market.homeProb != null && <span className="text-neutral-500"> · the market has {pick.team.abbr} at {pct(pick.side === 'home' ? bet.market.homeProb : 1 - bet.market.homeProb)}</span>}
          </p>
        ) : <p className="text-sm text-neutral-500">No book has priced this game yet and the model has not scored it, so there is nothing to compare.</p>}
        <button onClick={() => onOpenGame(r.id)} className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:text-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Game page</button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Side r={r} side="away" picked={pick?.side === 'away'} absent={absent} />
        <Side r={r} side="home" picked={pick?.side === 'home'} absent={absent} />
      </div>

      {(lineText || bet.market.total != null) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-neutral-400">
          {lineText && <span>Spread <b className="font-medium text-neutral-200">{lineText}</b>{bet.ours?.spread != null && <span className="text-neutral-500"> (ours {signed(bet.ours.spread)})</span>}</span>}
          {bet.market.total != null && <span>Total <b className="font-medium text-neutral-200">{bet.market.total}</b></span>}
          {bet.ours && <span>Fair moneyline <span className="text-neutral-300">{r.away.abbr} {bet.ours.fairMoneyline.away.toFixed(2)}</span> / <span className="text-neutral-300">{r.home.abbr} {bet.ours.fairMoneyline.home.toFixed(2)}</span></span>}
        </div>
      )}

      <Form r={r} />

      {reasons.length > 0 ? <ReasonList title={`Why the model favours ${r.model && r.model.model_home_prob >= 0.5 ? r.model.home : r.model?.away}`} reasons={reasons} /> : <p className="text-xs text-neutral-500">No model number for this game yet (it appears after the next sync).</p>}
      {mine.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-neutral-500">Injury report</span>
          {mine.map((a) => <span key={a.id} className={`rounded-full px-2.5 py-0.5 ${a.status === 'out' ? 'bg-red-500/15 text-red-300' : 'bg-neutral-800 text-neutral-300'}`}>{a.team} {a.name.split(' ').slice(-1)[0]} · {a.status}</span>)}
        </p>
      )}
      {status && <p className="text-xs text-neutral-600">Over {status.commonOpponentLean.games.toLocaleString()} past games (judged with only that season's earlier games) the common-opponent lean picked the winner {pct(status.commonOpponentLean.picksWinner)} of the time (always picking the home team: {pct(status.commonOpponentLean.homeTeamWon)}); with a gap of two or more opponents, {pct(status.commonOpponentLeanGap2.picksWinner)}.</p>}
    </div>
  )
}

const COLS = 'md:grid-cols-[minmax(9.5rem,1fr)_4.75rem_minmax(11rem,1.5fr)_6.5rem_6.5rem_1rem]'

/** One game on one line: who we pick and how sure, the best price on that side, and the value tag. Click to open everything. */
function GameRow({ r, absent, open, onToggle, onOpenGame, status }: { r: Row; absent: Absence[]; open: boolean; onToggle: () => void; onOpenGame: (id: string) => void; status: FormStatus | undefined }) {
  const pick = pickOf(r)
  const bet = r.bet
  const price = pick ? bet.moneyline?.[pick.side] : undefined
  const detailId = `team-game-detail-${r.id}`
  return (
    <article id={`team-game-${r.id}`} className="scroll-mt-32 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <button onClick={onToggle} aria-expanded={open} aria-controls={open ? detailId : undefined}
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2.5 text-left hover:bg-neutral-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${COLS}`}>
        <span className="flex items-center gap-2"><Chip abbr={r.away.abbr} name={r.away.name} size={22} /><span className="text-neutral-600">@</span><Chip abbr={r.home.abbr} name={r.home.name} size={22} /></span>
        <span className="text-right text-xs tabular-nums text-neutral-400 md:text-left">
          {r.state === 'pre' ? timeLabel(r.date) : <span className="text-emerald-400">{r.away.score}–{r.home.score} · {r.status}</span>}
        </span>
        <span className="col-span-2 flex items-center gap-2.5 md:col-span-1">
          {pick ? (
            <>
              <span className={`w-12 shrink-0 text-sm font-semibold ${tierOf(pick.prob).text}`}>{pick.team.abbr}</span>
              <span className="w-10 shrink-0 text-sm tabular-nums text-neutral-50">{pct(pick.prob)}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-800" aria-hidden><span className={`block h-full ${tierOf(pick.prob).bar}`} style={{ width: `${Math.round(pick.prob * 100)}%` }} /></span>
              <span className={`hidden w-14 shrink-0 text-xs lg:block ${tierOf(pick.prob).text}`}>{tierOf(pick.prob).short}</span>
            </>
          ) : <span className="text-xs text-neutral-600">not scored yet</span>}
        </span>
        <span className="text-sm tabular-nums text-neutral-200">
          {price ? <>{price.price.toFixed(2)} <span className="text-xs text-neutral-600">{price.book}</span></> : <span className="text-xs text-neutral-600">no price</span>}
        </span>
        <span className="text-right text-xs tabular-nums md:text-left">
          {bet.best ? <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-emerald-400" title={`${bet.best.team} moneyline at ${bet.best.price.toFixed(2)} (${bet.best.book}). Expected profit per unit staked: a rough guide.`}>{bet.best.team} ≈ {evText(bet.best.ev)}</span> : bet.moneyline ? <span className="text-neutral-600">no value</span> : null}
        </span>
        <span aria-hidden className={`hidden text-neutral-500 transition-transform md:block ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div id={detailId}><GameDetail r={r} absent={absent} onOpenGame={onOpenGame} status={status} /></div>}
    </article>
  )
}

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA')
function dayName(key: string) {
  const today = new Date().toLocaleDateString('en-CA')
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')
  if (key === today) return 'Today'
  if (key === tomorrow) return 'Tomorrow'
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The slate at a glance: the strongest picks and the best value, whatever day is open. Clicking one opens its game. */
function TopStrip({ games, best, onJump }: { games: Row[]; best: Res['data']['best']; onJump: (id: string) => void }) {
  const strongest = games.filter((g) => g.state === 'pre').map((g) => ({ g, p: pickOf(g) })).filter((x) => x.p).sort((a, b) => b.p!.prob - a.p!.prob).slice(0, 3)
  const value = best.slice(0, 2).map((b) => ({ b, g: games.find((x) => x.id === b.gameId) })).filter((x) => x.g)
  if (!strongest.length && !value.length) return null
  const chip = 'flex items-center gap-2 rounded-full bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500'
  return (
    <section aria-label="Top of the slate" className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {strongest.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-neutral-500">Strongest</span>
          {strongest.map(({ g, p }) => (
            <button key={g.id} onClick={() => onJump(g.id)} className={chip}>
              <span className={`font-semibold ${tierOf(p!.prob).text}`}>{p!.team.abbr}</span><span className="tabular-nums text-neutral-100">{pct(p!.prob)}</span>
              <span className="text-xs text-neutral-500">vs {p!.other.abbr}</span>
            </button>
          ))}
        </div>
      )}
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-neutral-500">Best value</span>
          {value.map(({ b, g }) => (
            <button key={`${b.gameId}${b.side}`} onClick={() => onJump(b.gameId)} className={chip} title="Expected profit per unit staked at the best price: a rough guide, untested against sportsbook prices.">
              <span className="font-semibold text-neutral-50">{b.team}</span><span className="tabular-nums text-emerald-400">≈ {evText(b.ev)}</span>
              <span className="text-xs tabular-nums text-neutral-500">{b.price.toFixed(2)} · {g!.away.abbr}@{g!.home.abbr}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export default function TeamBets({ refreshKey, onOpenGame }: { refreshKey: number; onOpenGame: (id: string) => void }) {
  const [res, setRes] = useState<Res | null>(null)
  const [absent, setAbsent] = useState<Absence[]>([])
  const [error, setError] = useState('')
  const [sort, setSort] = useState<Sort>('tip')
  const [day, setDay] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let live = true
    api<Res>('/team-bets').then((r) => live && setRes(r)).catch((e) => live && setError(e.message))
    api<{ data: Absence[] }>('/absences').then((r) => live && setAbsent(r.data)).catch(() => live && setAbsent([]))
    return () => { live = false }
  }, [refreshKey])

  const all = res?.data.games
  const days = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const g of all ?? []) { const k = dayKey(g.date); m.set(k, [...(m.get(k) ?? []), g]) }
    return [...m].sort(([a], [b]) => a.localeCompare(b))
  }, [all])
  const current = days.find(([k]) => k === day) ?? days[0]
  const rows = useMemo(() => {
    const g = [...(current?.[1] ?? [])]
    if (sort === 'confident') g.sort((a, b) => (pickOf(b)?.prob ?? 0) - (pickOf(a)?.prob ?? 0))
    else if (sort === 'value') g.sort((a, b) => (b.bet.best?.ev ?? -1) - (a.bet.best?.ev ?? -1))
    return g
  }, [current, sort])

  const jump = (id: string) => {
    const g = (all ?? []).find((x) => x.id === id)
    if (!g) return
    setDay(dayKey(g.date))
    setOpenMap((o) => ({ ...o, [id]: true }))
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`team-game-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })))
  }

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading…</p>
  const m = res.meta.model

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-lg font-semibold text-neutral-50">Who wins</h2>
          <p className="text-xs text-neutral-500">
            {m ? <>Model picked {pct(m.accuracy)} of winners on {m.testGames.toLocaleString()} games it never saw · </> : null}{res.meta.modelGames} of {all?.length ?? 0} games scored
          </p>
        </div>
        <button onClick={() => setHelp(!help)} aria-expanded={help} className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
          {help ? 'Hide' : 'How to read this'}
        </button>
      </div>

      {help && (
        <div className="space-y-1.5 rounded-xl bg-neutral-900 px-4 py-3 text-xs leading-relaxed text-neutral-400">
          <p><b className="font-medium text-neutral-200">Our chance</b> is the game model blended with the market when a price exists, and the model alone when there is none. {res.meta.note}</p>
          {m && <p><b className="font-medium text-neutral-200">Track record.</b> Model {m.version}, on {m.testGames.toLocaleString()} games of {m.testSeason} it never saw: {pct(m.accuracy)} of winners picked, log loss {m.logLoss.toFixed(3)} (a coin flip scores 0.693; the previous model scored {m.baselineLogLoss.toFixed(3)}).</p>}
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <b className="font-medium text-neutral-200">Confidence colors</b>
            {TIERS.map((x) => <span key={x.short} className="flex items-center gap-1.5"><span aria-hidden className={`inline-block h-2 w-5 rounded-full ${x.bar}`} /><span className={x.text}>{x.short}</span><span className="text-neutral-600">{x.range}</span></span>)}
          </p>
          <p><b className="font-medium text-neutral-200">Pick</b> is who we think wins. <b className="font-medium text-neutral-200">Value</b> is a different question: whether a price pays more than our chance says it should. The pick and the value side can be different teams.</p>
          <p><b className="font-medium text-neutral-200">≈ %</b> is expected profit per unit staked, a rough guide.</p>
        </div>
      )}

      {!res.meta.oddsAvailable && <p className="text-xs text-amber-400">No team odds are stored yet. Run <code className="text-neutral-300">npm run sync:odds</code> (or <code className="text-neutral-300">npm run dev:sync</code>, which does it every 10 minutes).</p>}

      <TopStrip games={all ?? []} best={res.data.best} onJump={jump} />

      <div className="sticky top-12 z-10 -mx-3 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 bg-neutral-950/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div role="tablist" aria-label="Day" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.map(([k, list]) => (
            <button key={k} role="tab" aria-selected={current?.[0] === k} onClick={() => setDay(k)}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${current?.[0] === k ? 'bg-emerald-500 font-medium text-neutral-950' : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'}`}>
              {dayName(k)} <span className={current?.[0] === k ? 'text-neutral-800' : 'text-neutral-600'}>{list.length}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
            {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      </div>

      {rows.length === 0 ? <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">No games scheduled.</p> : (
        <div className="space-y-2" role="tabpanel">
          <div className={`hidden px-3 text-xs text-neutral-600 md:grid md:gap-x-4 ${COLS}`} aria-hidden>
            <span>Game</span><span>Tip</span><span>Our pick</span><span>Best price</span><span>Value</span><span />
          </div>
          {rows.map((g) => <GameRow key={g.id} r={g} absent={absent} open={!!openMap[g.id]} onToggle={() => setOpenMap((o) => ({ ...o, [g.id]: !o[g.id] }))} onOpenGame={onOpenGame} status={res.meta.teamForm} />)}
        </div>
      )}
    </div>
  )
}
