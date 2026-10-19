import { useEffect, useState } from 'react'
import { STAT_LABEL, api } from '../lib/format'

interface Row {
  player: string; stat: string; side: 'over' | 'under'; line: number; price: number
  book: string; actual: number; hit: 0 | 1 | 2; gameDate: string
}
interface Res { data: Row[]; summary: { won: number | null; lost: number | null; pushed: number | null; units: number | null } | null }

const OUTCOME = { 1: 'Won', 0: 'Lost', 2: 'Push' } as const

export default function Results({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Res>('/results').then(setRes).catch((e) => setError(e.message))
  }, [refreshKey])

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="text-sm text-neutral-500">Loading…</p>

  const s = res.summary
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-neutral-800 text-center">
        {([['Won', s?.won], ['Lost', s?.lost], ['Push', s?.pushed], ['Units', s?.units == null ? 0 : Number(s.units.toFixed(1))]] as const).map(([label, n]) => (
          <div key={label} className="bg-neutral-900 py-4">
            <div className="text-2xl tabular-nums text-neutral-100">{n ?? 0}</div>
            <div className="text-xs uppercase tracking-widest text-neutral-500">{label}</div>
          </div>
        ))}
      </div>

      {res.data.length === 0 ? (
        <p className="rounded-lg bg-neutral-900 px-4 py-6 text-sm text-neutral-500">
          Nothing graded yet. Suggested bets are logged when you open Today, then graded after the game once you
          re-run <code className="text-neutral-300">ingest/sync.py</code> to pull the box scores.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-900">
          {res.data.map((r, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="text-neutral-100">{r.player}</div>
                <div className="text-xs text-neutral-500">
                  {r.side === 'over' ? 'Over' : 'Under'} {r.line} {STAT_LABEL[r.stat]} · {r.price.toFixed(2)} {r.book} · {r.gameDate}
                </div>
              </div>
              <div className="text-right">
                <div className={r.hit === 1 ? 'text-neutral-100' : 'text-neutral-500'}>{OUTCOME[r.hit]}</div>
                <div className="text-xs tabular-nums text-neutral-500">got {r.actual}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
