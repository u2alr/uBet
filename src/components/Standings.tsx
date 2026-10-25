import { useEffect, useState } from 'react'
import { seedZone, type Conference, type StandingRow } from '../../shared/standings.ts'
import { api } from '../lib/format'
import { logoUrl, teamId } from '../lib/teams'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; data: Conference[] }

const ZONE_BAR: Record<ReturnType<typeof seedZone>, string> = { playoffs: 'border-l-emerald-500', 'play-in': 'border-l-amber-500', out: 'border-l-neutral-800' }

export default function Standings({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    let live = true
    api<{ data: Conference[] }>('/standings')
      .then((r) => live && setState({ status: 'ok', data: r.data }))
      .catch((e) => live && setState({ status: 'error', message: e.message }))
    return () => { live = false }
  }, [refreshKey])

  if (state.status === 'loading') return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading…</p>
  if (state.status === 'error') return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{state.message}</p>
  const played = state.data.flatMap((c) => c.rows).reduce((a, r) => a + r.wins + r.losses, 0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-neutral-500">
        <span className="flex items-center gap-2"><span className="h-3 w-1 rounded bg-emerald-500" />Playoffs (seeds 1 to 6)</span>
        <span className="flex items-center gap-2"><span className="h-3 w-1 rounded bg-amber-500" />Play-in (7 to 10)</span>
        {played < 60 && <span className="text-neutral-600">Early in the season: records are only a few games deep and say little yet.</span>}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {state.data.map((c) => <ConferenceTable key={c.name} c={c} />)}
      </div>
    </div>
  )
}

function ConferenceTable({ c }: { c: Conference }) {
  return (
    <section className="overflow-x-auto rounded-2xl border border-neutral-800 bg-neutral-900">
      <h2 className="px-4 pt-4 text-xl font-semibold text-neutral-100">{c.name} Conference</h2>
      <table className="mt-2 w-full whitespace-nowrap text-sm tabular-nums">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="py-2 pl-4 font-normal">#</th><th className="font-normal">Team</th>
            <th className="text-right font-normal">W</th><th className="text-right font-normal">L</th><th className="text-right font-normal">PCT</th>
            <th className="text-right font-normal">GB</th><th className="text-right font-normal">L10</th><th className="text-right font-normal">Strk</th>
            <th className="text-right font-normal">Home</th><th className="text-right font-normal">Road</th><th className="pr-4 text-right font-normal">Diff</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => <Row key={r.abbr} r={r} />)}
        </tbody>
      </table>
    </section>
  )
}

function Row({ r }: { r: StandingRow }) {
  const id = teamId(r.abbr)
  const zone = seedZone(r.seed)
  return (
    <tr className={`border-l-4 border-t border-t-neutral-800 text-neutral-300 ${ZONE_BAR[zone]} ${r.seed === 6 || r.seed === 10 ? 'border-b border-b-neutral-700' : ''}`}>
      <td className="py-2.5 pl-3 text-neutral-500">{r.seed === 99 ? '–' : r.seed}</td>
      <td>
        <span className="flex items-center gap-2.5">
          {id && <img src={logoUrl(id)} alt="" width={26} height={26} loading="lazy" className="shrink-0" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
          <span className="text-neutral-100">{r.team}</span>
        </span>
      </td>
      <td className="text-right text-neutral-100">{r.wins}</td><td className="text-right text-neutral-100">{r.losses}</td>
      <td className="text-right">{r.winPct.toFixed(3).replace(/^0/, '')}</td>
      <td className="text-right text-neutral-500">{r.gamesBehind === 0 ? '–' : r.gamesBehind}</td>
      <td className="text-right">{r.last10}</td>
      <td className={`text-right ${r.streak.startsWith('W') ? 'text-emerald-400' : r.streak.startsWith('L') ? 'text-red-400' : ''}`}>{r.streak}</td>
      <td className="text-right text-neutral-500">{r.home}</td><td className="text-right text-neutral-500">{r.road}</td>
      <td className={`pr-4 text-right ${r.diff > 0 ? 'text-emerald-400' : r.diff < 0 ? 'text-red-400' : 'text-neutral-500'}`}>{r.diff > 0 ? '+' : ''}{r.diff}</td>
    </tr>
  )
}
