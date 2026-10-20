import { useEffect, useState } from 'react'
import type { PicksMeta } from '../../shared/picks.ts'
import { api } from '../lib/format'
import { riskiestPicks, safestPicks, suggestParlays, valuePicks, type Pick } from '../lib/picks'
import Notices from './Notices'
import Parlays from './Parlays'
import PickTable from './PickTable'

interface Game {
  id: string; date: string; status: string; state: 'pre' | 'in' | 'post'
  home: { abbr: string; name: string; score: string }
  away: { abbr: string; name: string; score: string }
  odds: { spread: number | null; total: number | null; homeWinProb: number | null } | null
}
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

const VIEWS = ['Value', 'Safest', 'Riskiest'] as const
type View = (typeof VIEWS)[number]

export default function Today({ refreshKey, onOpenPlayer, onOpenGame, onOpenSlip }: {
  refreshKey: number; onOpenPlayer: (id: number) => void; onOpenGame: (id: string) => void; onOpenSlip: () => void
}) {
  const [games, setGames] = useState<Game[] | null>(null)
  const [picks, setPicks] = useState<Pick[] | null>(null)
  const [configured, setConfigured] = useState(true)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<PicksMeta | null>(null)
  const [gamesMeta, setGamesMeta] = useState<{ oddsAvailable: boolean; freshRequested: boolean; freshHonored: boolean } | null>(null)
  const [view, setView] = useState<View>('Value')

  useEffect(() => {
    api<{ data: Game[]; meta?: typeof gamesMeta }>(refreshKey ? '/games?fresh=1' : '/games')
      .then((r) => { setGames(r.data); setGamesMeta(r.meta ?? null) }).catch((e) => setError(e.message))
    api<{ configured: boolean; data: Pick[]; meta: PicksMeta }>('/picks') // props stay cached on purpose: a fresh pull costs ~24 credits
      .then((r) => { setConfigured(r.configured); setPicks(r.data); setMeta(r.meta ?? null) })
      .catch((e) => setError(e.message))
  }, [refreshKey])

  const byDay = new Map<string, Game[]>()
  for (const g of games ?? []) {
    const k = dayLabel(g.date)
    byDay.set(k, [...(byDay.get(k) ?? []), g])
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-neutral-500">{error}</p>}

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">Upcoming games</h2>
        {gamesMeta && !gamesMeta.oddsAvailable && <p className="mb-3 text-xs text-neutral-500">Team odds could not be loaded right now, so games show without spreads or totals.</p>}
        {gamesMeta?.freshRequested && !gamesMeta.freshHonored && <p className="mb-3 text-xs text-neutral-500">Refresh re-read what is stored, but odds are only re-fetched from your own machine (it spends provider credits).</p>}
        {games === null ? <Muted>Loading…</Muted> : games.length === 0 ? <Muted>No games scheduled.</Muted> : (
          <div className="space-y-3">
            {[...byDay].map(([day, list]) => (
              <div key={day}>
                <div className="mb-1 text-xs text-neutral-400">{day}</div>
                <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {list.map((g) => (
                    <li key={g.id} className="overflow-hidden rounded-md bg-neutral-900">
                     <button className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-neutral-800" onClick={() => onOpenGame(g.id)}>
                      <span className="text-sm">
                        <span className="text-neutral-100">{g.away.abbr}</span>
                        <span className="px-2 text-neutral-600">@</span>
                        <span className="text-neutral-100">{g.home.abbr}</span>
                      </span>
                      <span className="text-right text-sm tabular-nums text-neutral-400">
                        {g.state === 'pre' ? timeLabel(g.date) : `${g.away.score}–${g.home.score} · ${g.status}`}
                        {g.odds && g.odds.spread != null && (
                          <span className="block text-[11px] text-neutral-600">
                            {g.home.abbr} {g.odds.spread > 0 ? '+' : ''}{g.odds.spread} · O/U {g.odds.total ?? '–'}
                            {g.odds.homeWinProb != null && <> · {g.home.abbr} {Math.round(g.odds.homeWinProb * 100)}%</>}
                          </span>
                        )}
                      </span>
                     </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-neutral-500">Suggested bets</h2>
          <div className="flex overflow-hidden rounded-md bg-neutral-900 text-xs">
            {VIEWS.map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 ${view === v ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-3 text-xs text-neutral-600">
          {view === 'Value' && 'Best expected profit: the model and the market blended, compared with the price.'}
          {view === 'Safest' && 'Most likely to land, from players with plenty of games behind the estimate. Prices are short.'}
          {view === 'Riskiest' && 'Biggest payouts that the numbers do not rule out. Expect to lose most of these.'}
        </p>
        <Notices meta={meta} />
        {picks === null ? <Muted>Loading…</Muted> : !configured ? (
          <Muted>Add an <code className="text-neutral-300">ODDS_API_KEY</code> to <code className="text-neutral-300">.dev.vars</code> to pull live lines.</Muted>
        ) : (
          <PickTable
            picks={view === 'Value' ? valuePicks(picks) : view === 'Safest' ? safestPicks(picks) : riskiestPicks(picks)}
            onOpenPlayer={onOpenPlayer}
            empty="No picks in this category yet. Lines appear once books post props, for players you have synced."
          />
        )}
      </section>

      {configured && picks && picks.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">Suggested parlays</h2>
          <Parlays parlays={suggestParlays(picks)} onOpenSlip={onOpenSlip} />
        </section>
      )}
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{children}</p>
}
