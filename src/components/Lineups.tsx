import { useEffect, useMemo, useState } from 'react'
import { STATUS_LABEL, historyLine, type LineupPlayer, type LineupStatus, type PlayRates, type ReportState, type TeamLineup } from '../../shared/lineups.ts'
import playRatesJson from '../../shared/statusPlayRates.json'
import { api } from '../lib/format'
import { teamByName } from '../lib/teams'
import TeamChip from './TeamChip'

const HISTORY = playRatesJson as unknown as PlayRates
interface Side extends TeamLineup { abbr: string; name: string }
interface Game { id: string; date: string; state: 'pre' | 'in' | 'post'; status: string; home: Side; away: Side }
interface Res { data: { games: Game[] }; meta: { officialReportAt: string | null; note: string } }

/** Colors for each status: red is out, orange doubtful, amber questionable, green probable. Text always names the status, never color alone. */
const PILL: Record<LineupStatus, string> = {
  out: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
  doubtful: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
  questionable: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  probable: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
}
const SHORT: Record<LineupStatus, string> = { out: 'OUT', doubtful: 'DOUBT', questionable: 'QUES', probable: 'PROB' }

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA')
function dayName(key: string) {
  const today = new Date().toLocaleDateString('en-CA')
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')
  if (key === today) return 'Today'
  if (key === tomorrow) return 'Tomorrow'
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
/** 'YYYY-MM-DD HH:MM' Eastern, as the league prints it, to "Nov 5, 2:15 AM ET". */
const etStamp = (t: string) => {
  const m = t.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/)
  if (!m) return t
  const h = Number(m[2])
  return `${shortDay(m[1])}, ${h % 12 || 12}:${m[3]} ${h < 12 ? 'AM' : 'PM'} ET`
}
/** "(12 min ago)" for a report time printed in Eastern, so a stale list is visible at a glance. */
function ageText(t: string | null): string {
  const m = t?.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
  if (!m) return ''
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const min = Math.round((nowEt.getTime() - new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime()) / 60_000)
  if (min < 0) return ''
  return min < 90 ? ` (${min} min ago)` : min < 36 * 60 ? ` (${Math.round(min / 60)} h ago)` : ' (old)'
}
/** How long a player has been out, from his box scores: "Played last game", "Missed last 3 (last played Nov 2)", or just when he last played. */
function sinceText(lastPlayed: string | null | undefined, missed: number | null | undefined): string | null {
  if (!lastPlayed) return null
  if (missed == null) return `Last played ${shortDay(lastPlayed)}`
  if (missed === 0) return `Played last game (${shortDay(lastPlayed)})`
  return `Missed last ${missed} · last played ${shortDay(lastPlayed)}`
}
/** What to say under a team about where its flags come from: only the league's report is ever used. */
function sourceText(state: ReportState, asOf: string | null): string {
  const when = asOf ? ` · updated ${etStamp(asOf)}${ageText(asOf)}` : ''
  switch (state) {
    case 'listed': return `NBA injury report${when}`
    case 'clear': return `NBA injury report${when} · no one listed for this team`
    case 'not_submitted': return `Not yet submitted to the NBA${when} · default lineup`
    default: return 'No NBA report for this game yet · default lineup'
  }
}

function Pill({ status, reason }: { status: LineupStatus; reason: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${PILL[status]}`} title={`${STATUS_LABEL[status]}${reason ? `: ${reason}` : ''} (NBA injury report). ${historyLine(status, HISTORY)}.`}>
      {SHORT[status]}
    </span>
  )
}

function Detail({ listing, lastPlayed, missed }: { listing: NonNullable<LineupPlayer['listing']>; lastPlayed?: string | null; missed?: number | null }) {
  const bits = [listing.reason, sinceText(lastPlayed, missed)].filter(Boolean)
  const past = listing.status === 'out' ? null : `plays ${Math.round(HISTORY.rates[listing.status].played * 100)}% of the time when listed ${STATUS_LABEL[listing.status]}`
  return bits.length || past ? <div className="pb-1.5 pl-8 pr-3 text-xs leading-snug text-neutral-500">{bits.join(' · ')}{past && <span className="text-neutral-600">{bits.length ? ' · ' : ''}historically {past}</span>}</div> : null
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
          <li key={p.id}>
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="w-3 shrink-0 text-xs tabular-nums text-neutral-600">{i + 1}</span>
              <span className={`min-w-0 flex-1 truncate ${p.listing?.status === 'out' ? 'text-neutral-500 line-through' : 'text-neutral-100'}`}>{p.name}</span>
              {p.listing && <Pill status={p.listing.status} reason={p.listing.reason} />}
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-neutral-600" title="Minutes per game over the last 10 team games">{p.avgMin.toFixed(0)} min</span>
            </div>
            {p.listing && <Detail listing={p.listing} lastPlayed={p.lastPlayed} missed={p.missed} />}
          </li>
        ))}
      </ol>
      {t.nextUp.length > 0 && (
        <p className="mt-1.5 text-xs text-neutral-500" title="Next by minutes, not listed Out or Doubtful">
          <span className="text-neutral-600">Next up </span>
          {t.nextUp.map((p, i) => <span key={p.id}>{i > 0 && ', '}<span className="text-neutral-400">{p.name}</span><span className="text-neutral-600"> {p.avgMin.toFixed(0)}m</span>{p.listing && <span className="ml-1"><Pill status={p.listing.status} reason={p.listing.reason} /></span>}</span>)}
        </p>
      )}
      {t.alsoListed.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {t.alsoListed.map((a) => (
            <li key={a.name} className="flex items-center gap-2 text-neutral-500">
              <Pill status={a.listing.status} reason={a.listing.reason} />
              <span className="min-w-0 truncate"><span className="text-neutral-400">{a.name}</span>{a.listing.reason && <span> · {a.listing.reason}</span>}{a.lastPlayed && <span className="text-neutral-600"> · last played {shortDay(a.lastPlayed)}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] uppercase tracking-wide text-neutral-600">{sourceText(t.state, t.asOf)}</p>
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
          Projected starters for upcoming games, flagged from the NBA's official injury report only.{' '}
          {res.meta.officialReportAt ? <>Newest report: {etStamp(res.meta.officialReportAt)}{ageText(res.meta.officialReportAt)}.</> : <>No recent NBA report is stored, so the default lineups are shown without flags.</>}{' '}
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
      <p className="text-xs text-neutral-600">
        What the flags have meant in past seasons ({HISTORY.seasons}, the NBA's pre-game reports against who then played):{' '}
        {(['out', 'doubtful', 'questionable', 'probable'] as const).map((s, i) => <span key={s}>{i > 0 && ' · '}{STATUS_LABEL[s]} {HISTORY.rates[s].played < 0.005 ? '~0' : Math.round(HISTORY.rates[s].played * 100)}% played ({HISTORY.rates[s].n.toLocaleString('en-US')})</span>)}.
        {' '}That is history, not a forecast for any one player.
      </p>
      <p className="text-xs text-neutral-600">{res.meta.note}</p>
    </div>
  )
}
