import { useEffect, useMemo, useState } from 'react'
import { gameReasons, type GameLeanRow } from '../../shared/games.ts'
import { normName } from '../../shared/picks.ts'
import type { MoneylineBet, BookLine, TeamBet } from '../../shared/teamBets.ts'
import { commonLean, type TeamForm } from '../../shared/teamForm.ts'
import { api, pct } from '../lib/format'
import { teamByName } from '../lib/teams'
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

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const signed = (n: number | null, d = 1) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(d)}`)
const evText = (n: number) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`

/** Who we think wins and how sure we are, in words. This is the likelier winner, which is a different question from which bet is good value. */
function confidence(p: number) {
  if (p >= 0.78) return 'Heavy favourite'
  if (p >= 0.65) return 'Clear favourite'
  if (p >= 0.56) return 'Slight favourite'
  return 'Toss-up'
}
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
    <div className={`rounded-xl px-3 py-3 ${picked ? 'bg-emerald-500/10 ring-1 ring-emerald-500/60' : 'bg-neutral-950/50'}`}>
      <div className="flex items-center justify-between gap-2">
        <Chip abbr={t.abbr} name={t.name} size={28} />
        <span className="flex items-center gap-1.5">
          {picked && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-neutral-950">Our pick</span>}
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
      {prob != null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800" aria-hidden><div className={picked ? 'h-full bg-emerald-500' : 'h-full bg-neutral-500'} style={{ width: `${Math.round(prob * 100)}%` }} /></div>}
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
        <h3 className="mb-1.5 text-xs font-medium text-neutral-300">Head to head</h3>
        {f.meetings.length === 0 ? <p className="text-xs text-neutral-500">No meeting between these teams in the last 13 months of stored games.</p> : (
          <>
            <p className="mb-1 text-xs text-neutral-400">{f.a} {f.aWins}–{f.bWins} {f.b} in {f.meetings.length} meeting{f.meetings.length === 1 ? '' : 's'}</p>
            <ul className="space-y-0.5 text-xs text-neutral-500">
              {f.meetings.slice(0, 4).map((m) => <li key={m.date}>{shortDate(m.date)}: <b className="font-medium text-neutral-300">{m.winner}</b> won{m.home ? ` at ${m.home}` : ''}</li>)}
            </ul>
          </>
        )}
      </div>
      <div className="rounded-xl bg-neutral-950/50 px-3 py-2.5">
        <h3 className="mb-1.5 text-xs font-medium text-neutral-300">Common opponents</h3>
        {f.common.length === 0 ? <p className="text-xs text-neutral-500">These teams have not played the same opponent recently.</p> : (
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
            <p className="mt-1.5 text-xs text-neutral-600">Context, not part of our chance. Weak on its own (one game each, rosters change).</p>
          </>
        )}
      </div>
    </div>
  )
}

function Game({ r, absent, open, onToggle, onOpenGame, status }: { r: Row; absent: Absence[]; open: boolean; onToggle: () => void; onOpenGame: (id: string) => void; status: FormStatus | undefined }) {
  const pick = pickOf(r)
  const bet = r.bet
  const lineText = bet.market.spread == null ? null : `${r.home.abbr} ${signed(bet.market.spread)}`
  const mine = absent.filter((a) => a.team && [r.home.abbr, r.away.abbr].includes(a.team))
  const counted = new Set([r.model?.absent_home, r.model?.absent_away].flatMap((s) => (s ?? '').split(';')).map((s) => normName(s.replace(/\s*\(\d+ min\)\s*$/, ''))).filter(Boolean))
  const uncertain = mine.filter((a) => a.status !== 'out' || (!!r.model && !counted.has(normName(a.name)))).map((a) => ({ team: a.team!, name: a.name, status: a.status === 'out' ? 'out, not counted' : a.status }))
  const reasons = r.model ? gameReasons(r.model, bet.market.homeProb, uncertain) : []
  return (
    <article className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Chip abbr={r.away.abbr} name={r.away.name} /><span className="text-neutral-600">@</span><Chip abbr={r.home.abbr} name={r.home.name} />
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span className="tabular-nums">{r.state === 'pre' ? `${dayLabel(r.date)} · ${timeLabel(r.date)}` : <span className="text-emerald-400">{r.away.score}–{r.home.score} · {r.status}</span>}</span>
          <button onClick={() => onOpenGame(r.id)} className="rounded-md bg-neutral-800 px-2 py-1 text-neutral-300 hover:text-neutral-50">Game page</button>
        </div>
      </header>

      {pick ? (
        <p className="mt-3 text-sm text-neutral-300">
          <b className="text-neutral-50">{confidence(pick.prob)}:</b> we think <b className="text-emerald-400">{pick.team.name}</b> win{' '}
          <span className="tabular-nums">({pct(pick.prob)})</span>
          {bet.market.homeProb != null && <span className="text-neutral-500"> · the market has {pick.team.abbr} at {pct(pick.side === 'home' ? bet.market.homeProb : 1 - bet.market.homeProb)}</span>}
        </p>
      ) : <p className="mt-3 text-sm text-neutral-500">No book has priced this game yet, so there is nothing to compare.</p>}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Side r={r} side="away" picked={pick?.side === 'away'} absent={absent} />
        <Side r={r} side="home" picked={pick?.side === 'home'} absent={absent} />
      </div>

      {(lineText || bet.market.total != null) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-neutral-400">
          {lineText && <span>Spread <b className="font-medium text-neutral-200">{lineText}</b>{bet.ours?.spread != null && <span className="text-neutral-500"> (ours {signed(bet.ours.spread)})</span>}</span>}
          {bet.market.total != null && <span>Total <b className="font-medium text-neutral-200">{bet.market.total}</b></span>}
          {bet.ours && <span>Fair moneyline <span className="text-neutral-300">{r.away.abbr} {bet.ours.fairMoneyline.away.toFixed(2)}</span> / <span className="text-neutral-300">{r.home.abbr} {bet.ours.fairMoneyline.home.toFixed(2)}</span></span>}
        </div>
      )}

      <div className="mt-3"><Form r={r} /></div>

      <button onClick={onToggle} aria-expanded={open} className="mt-3 text-xs text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
        {open ? 'Hide' : 'Show'} why and the injury report
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {reasons.length > 0 ? <ReasonList title={`Why the model favours ${r.model && r.model.model_home_prob >= 0.5 ? r.model.home : r.model?.away}`} reasons={reasons} /> : <p className="text-xs text-neutral-500">No model number for this game yet (it appears after the next sync).</p>}
          {mine.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-neutral-500">Injury report</span>
              {mine.map((a) => <span key={a.id} className={`rounded-full px-2.5 py-0.5 ${a.status === 'out' ? 'bg-red-500/15 text-red-300' : 'bg-neutral-800 text-neutral-300'}`}>{a.team} {a.name.split(' ').slice(-1)[0]} · {a.status}</span>)}
            </p>
          )}
          {status && <p className="text-xs text-neutral-600">Over {status.commonOpponentLean.games.toLocaleString()} past games the common-opponent lean picked the winner {pct(status.commonOpponentLean.picksWinner)} of the time (always picking the home team: {pct(status.commonOpponentLean.homeTeamWon)}); with a gap of two or more opponents, {pct(status.commonOpponentLeanGap2.picksWinner)}.</p>}
        </div>
      )}
    </article>
  )
}

export default function TeamBets({ refreshKey, onOpenGame }: { refreshKey: number; onOpenGame: (id: string) => void }) {
  const [res, setRes] = useState<Res | null>(null)
  const [absent, setAbsent] = useState<Absence[]>([])
  const [error, setError] = useState('')
  const [sort, setSort] = useState<Sort>('tip')
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let live = true
    api<Res>('/team-bets').then((r) => live && setRes(r)).catch((e) => live && setError(e.message))
    api<{ data: Absence[] }>('/absences').then((r) => live && setAbsent(r.data)).catch(() => live && setAbsent([]))
    return () => { live = false }
  }, [refreshKey])

  const games = useMemo(() => {
    const g = [...(res?.data.games ?? [])]
    if (sort === 'confident') g.sort((a, b) => (pickOf(b)?.prob ?? 0) - (pickOf(a)?.prob ?? 0))
    else if (sort === 'value') g.sort((a, b) => (b.bet.best?.ev ?? -1) - (a.bet.best?.ev ?? -1))
    return g
  }, [res, sort])

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading…</p>
  const byDay = new Map<string, Row[]>()
  for (const g of games) { const k = sort === 'tip' ? dayLabel(g.date) : 'All games'; byDay.set(k, [...(byDay.get(k) ?? []), g]) }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-neutral-50">Who wins</h2>
          <p className="text-xs text-neutral-500">{res.meta.note} {res.meta.modelGames} of {games.length} games have a model number.</p>
          {res.meta.model && <p className="text-xs text-neutral-600">Model {res.meta.model.version}: on {res.meta.model.testGames.toLocaleString()} games of {res.meta.model.testSeason} it never saw, it picked {pct(res.meta.model.accuracy)} of winners, with a log loss of {res.meta.model.logLoss.toFixed(3)} (a coin flip scores 0.693; the previous model scored {res.meta.model.baselineLogLoss.toFixed(3)}).</p>}
        </div>
        <div role="group" aria-label="Sort games" className="flex rounded-lg bg-neutral-900 p-0.5 text-sm">
          {SORTS.map(([k, label]) => (
            <button key={k} onClick={() => setSort(k)} aria-pressed={sort === k}
              className={`rounded-md px-3 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${sort === k ? 'bg-neutral-700 text-neutral-50' : 'text-neutral-400 hover:text-neutral-200'}`}>{label}</button>
          ))}
        </div>
      </div>
      {!res.meta.oddsAvailable && <p className="text-xs text-amber-400">No team odds are stored yet. Run <code className="text-neutral-300">npm run sync:odds</code> (or <code className="text-neutral-300">npm run dev:sync</code>, which does it every 10 minutes).</p>}

      {[...byDay].map(([day, list]) => (
        <section key={day} className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">{day}</h2>
          <div className="grid gap-3 xl:grid-cols-2">
            {list.map((g) => <Game key={g.id} r={g} absent={absent} open={!!openMap[g.id]} onToggle={() => setOpenMap((m) => ({ ...m, [g.id]: !m[g.id] }))} onOpenGame={onOpenGame} status={res.meta.teamForm} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
