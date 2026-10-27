import { useEffect, useState } from 'react'
import type { LiveBox as Box } from '../../shared/liveBox.ts'
import { api } from '../lib/format'

/** Player lines for a live or finished game (ESPN). Live games refresh every 30 seconds while this is open. */
export default function LiveBox({ gameId, live, onOpenPlayer }: { gameId: string; live: boolean; onOpenPlayer: (id: number) => void }) {
  const [box, setBox] = useState<Box | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let on = true
    const load = () => api<{ data: Box }>(`/live/${gameId}`).then((r) => { if (on) { setBox(r.data); setError('') } }).catch((e) => on && setError(e.message))
    load()
    const t = live ? setInterval(load, 30_000) : undefined
    return () => { on = false; if (t) clearInterval(t) }
  }, [gameId, live])

  if (error && !box) return <p className="text-sm text-neutral-500">{error}</p>
  if (!box) return <p className="text-sm text-neutral-600">Loading box score…</p>
  if (!box.teams.some((t) => t.players.length)) return <p className="text-sm text-neutral-500">No player stats posted yet.</p>
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {box.teams.map((t) => (
        <table key={t.abbr} className="w-full text-sm tabular-nums">
          <caption className="pb-1 text-left text-xs uppercase tracking-widest text-neutral-500">{t.abbr}</caption>
          <thead className="text-xs text-neutral-500"><tr><th className="text-left font-normal">Player</th>{['MIN', 'PTS', 'REB', 'AST', '3PM'].map((h) => <th key={h} className="px-1.5 text-right font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {[...t.players].sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0)).map((p) => (
              <tr key={p.id} className="border-t border-neutral-900">
                <td className="py-1 pr-2"><button onClick={() => onOpenPlayer(p.id)} className="text-left text-neutral-200 hover:text-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">{p.name}</button></td>
                {[p.minutes, p.pts, p.reb, p.ast, p.fg3m].map((v, i) => <td key={i} className={`px-1.5 text-right ${i === 1 ? 'font-medium text-neutral-50' : 'text-neutral-400'}`}>{v ?? '–'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}
