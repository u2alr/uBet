import { useEffect, useMemo, useState } from 'react'
import { STATUS_LABEL, type LineupStatus, type TeamLineup } from '../../shared/lineups.ts'
import { api } from '../lib/format'
import { teamByName } from '../lib/teams'
import TeamChip from './TeamChip'

interface Side extends TeamLineup { abbr: string; name: string }
interface Game { id: string; date: string; state: 'pre' | 'in' | 'post'; status: string; home: Side; away: Side }
interface Res { data: { games: Game[] }; meta: { officialReportAt: string | null; espnAvailable: boolean; note: string } }

/** Colors for each status: red is out, orange doubtful, amber questionable or game-time, green probable. Text always names the status, never color alone. */
const PILL: Record<LineupStatus, string> = {
  out: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
  doubtful: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
  questionable: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  gtd: 'bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/20',
  probable: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
}
const SHORT: Record<LineupStatus, string> = { out: 'OUT', doubtful: 'DOUBT', questionable: 'QUES', gtd: 'GTD', probable: 'PROB' }

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA')
function dayName(key: string) {
  const today = new Date().toLocaleDateString('en-CA')
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')
  if (key === today) return 'Today'
  if (key === tomorrow) return 'Tomorrow'
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function Pill({ status, reason, source, note }: { status: LineupStatus; reason: string; source: 'official' | 'espn'; note?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${PILL[status]}`}
      title={`${STATUS_LABEL[status]}${reason || note ? `: ${reason || note}` : ''} (${source === 'official' ? 'NBA injury report' : 'ESPN'})`}>
      {SHORT[status]}
    </span>
  )
}

function TeamColumn({ t, align }: { t: Side; align: 'left' | 'right' }) {
  const team = teamByName(t.name)
  const out = t.starters.filter((p) => p.listing?.status === 'out').length
  return (
    <div className="min-w-0 flex-1">
      <div className={`mb-2 flex items-center gap-2 ${align === 'right' ? 'sm:flex-row-reverse' : ''}`}>
        {team && <TeamChip id={team[1]} abbr={team[0]} size={28} />}
        <div className={`min-w-0 ${align === 'right' ? 'sm:text-right' : ''}`}>
          <div className="truncate text-sm font-semibold text-neutral-50">{t.name}</div>
          <div className="text-xs text-neutral-500">{out > 0 ? <span className="text-red-300">{out} starter{out > 1 ? 's' : ''} out</span> : 'Projected starters'}</div>
        </div>
      </div>
      <ol className="divide-y divide-neutral-800/70 rounded-lg bg-neutral-950/50">
        {t.starters.length === 0 && <li className="px-3 py-3 text-sm text-neutral-500">No recent box scores for this team yet.</li>}
        {t.starters.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <span className="w-3 shrink-0 text-xs tabular-nums text-neutral-600">{i + 1}</span>
            <span className={`min-w-0 flex-1 truncate ${p.listing?.status === 'out' ? 'text-neutral-500 line-through' : 'text-neutral-100'}`}>{p.name}</span>
            {p.listing && <Pill status={p.listing.status} reason={p.listing.reason} source={p.listing.source} note={p.listing.note} />}
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-neutral-600" title="Minutes per game over the last 10 team games">{p.avgMin.toFixed(0)} min</span>
          </li>
        ))}
      </ol>
      {t.nextUp.length > 0 && (
        <p className="mt-1.5 truncate text-xs text-neutral-500" title="Next by minutes, not listed Out or Doubtful">
          <span className="text-neutral-600">Next up </span>
          {t.nextUp.map((p, i) => <span key={p.id}>{i > 0 && ', '}<span className="text-neutral-400">{p.name}</span>{p.listing && <span className="ml-1"><Pill status={p.listing.status} reason={p.listing.reason} source={p.listing.source} note={p.listing.note} /></span>}</span>)}
        </p>
      )}
      {t.alsoListed.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {t.alsoListed.map((a) => (
            <li key={a.name} className="flex items-center gap-2 text-neutral-500">
              <Pill status={a.listing.status} reason={a.listing.reason} source={a.listing.source} note={a.listing.note} />
              <span className="min-w-0 truncate"><span className="text-neutral-400">{a.name}</span>{a.listing.reason && <span> · {a.listing.reason}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] uppercase tracking-wide text-neutral-700">
        {t.source === 'official' ? 'NBA injury report' : t.source === 'espn' ? 'ESPN (not on the NBA report yet)' : 'No injury list for this team yet'}
      </p>
    </div>
  )
}

export default function Lineups({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api<Res>('/lineups').then((r) => { if (live) { setRes(r); setError(null) } }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load lineups') })
    return () => { live = false }
  }, [refreshKey])

  const days = useMemo(() => {
    const m = new Map<string, Game[]>()
    for (const g of res?.data.games ?? []) (m.get(dayKey(g.date)) ?? m.set(dayKey(g.date), []).get(dayKey(g.date))!).push(g)
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [res])
  const current = days.find(([k]) => k === day) ?? days[0]

  if (error) return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-red-300">{error}</p>
  if (!res) return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading lineups…</p>
  if (!days.length) return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">No upcoming games on the schedule.</p>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-neutral-50">Lineups</h2>
        <p className="text-xs text-neutral-500">
          Projected starters, with who is out or in doubt.{' '}
          {res.meta.officialReportAt ? <>NBA injury report of {res.meta.officialReportAt} ET.</> : <>The NBA injury report is not stored yet; ESPN's list is used.</>}{' '}
          Starters are projected from recent minutes, not confirmed: real lineups are posted about 30 minutes before tip.
        </p>
      </div>
      <div role="tablist" aria-label="Day" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map(([k, list]) => (
          <button key={k} role="tab" aria-selected={current?.[0] === k} onClick={() => setDay(k)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${current?.[0] === k ? 'bg-emerald-500 font-medium text-neutral-950' : 'text-neutral-400 hover:bg-neutral-900'}`}>
            {dayName(k)} <span className={current?.[0] === k ? 'text-neutral-800' : 'text-neutral-600'}>{list.length}</span>
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {current?.[1].map((g) => (
          <section key={g.id} className="rounded-xl bg-neutral-900 p-3 sm:p-4" aria-label={`${g.away.name} at ${g.home.name}`}>
            <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
              <span>{g.away.abbr} @ {g.home.abbr}</span>
              <span>{g.state === 'pre' ? timeLabel(g.date) : g.status}</span>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
              <TeamColumn t={g.away} align="left" />
              <TeamColumn t={g.home} align="right" />
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-neutral-600">{res.meta.note}</p>
    </div>
  )
}
