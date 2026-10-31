import { useState } from 'react'
import { teamByName } from '../lib/teams'
import TeamChip from './TeamChip'

export interface RailGame { game: string; time: string | null; state: 'pre' | 'in' | 'post' | null; props: number }

const abbr = (n: string) => teamByName(n)?.[0] ?? n.split(' ').pop()

/** The slate as a side list: jump to a game's section, with the games that have no sportsbook lines folded into one row. */
export default function GamesRail({ games, active, onPick }: { games: RailGame[]; active: string | null; onPick: (game: string) => void }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const lined = games.filter((g) => g.props > 0)
  const empty = games.filter((g) => g.props === 0)
  const row = (g: RailGame) => {
    const [away, home] = g.game.split(' @ ')
    const selected = active === g.game
    return (
      <li key={g.game}>
        <button onClick={() => onPick(g.game)} aria-current={selected ? 'true' : undefined}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${selected ? 'bg-neutral-800 text-neutral-50' : 'text-neutral-300 hover:bg-neutral-900'}`}>
          <span className="flex shrink-0 -space-x-1">{[away, home].map((n) => { const t = teamByName(n); return t ? <TeamChip key={n} id={t[1]} abbr={t[0]} size={20} /> : null })}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{abbr(away)} @ {abbr(home)}</span>
            <span className="block truncate text-neutral-500">{g.state === 'in' ? 'Live' : g.state === 'post' ? 'Final' : g.time ?? ''}{g.props ? ` · ${g.props}` : ''}</span>
          </span>
          {g.state === 'in' && <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />}
        </button>
      </li>
    )
  }
  return (
    <nav aria-label="Games" className="space-y-1">
      <h2 className="px-2 text-xs uppercase tracking-widest text-neutral-500">Slate</h2>
      <ul className="space-y-0.5">{lined.map(row)}</ul>
      {empty.length > 0 && (
        <>
          <button onClick={() => setShowEmpty(!showEmpty)} aria-expanded={showEmpty} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-neutral-500 hover:text-neutral-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
            {showEmpty ? '−' : '+'} {empty.length} without lines
          </button>
          {showEmpty && <ul className="space-y-0.5">{empty.map(row)}</ul>}
        </>
      )}
    </nav>
  )
}
