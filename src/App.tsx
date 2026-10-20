import { useCallback, useState } from 'react'
import GameDetail from './components/GameDetail'
import PlayerView from './components/PlayerView'
import Minds from './components/Minds'
import Results from './components/Results'
import Slip from './components/Slip'
import SyncBar from './components/SyncBar'
import Today from './components/Today'
import { SlipProvider } from './lib/slip'
import { useSlip } from './lib/slipContext'

const TABS = ['Today', 'Slip', 'Minds', 'Results', 'Players'] as const
type Tab = (typeof TABS)[number]

export default function App() {
  return (
    <SlipProvider>
      <Shell />
    </SlipProvider>
  )
}

function Shell() {
  const slip = useSlip()
  const [tab, setTab] = useState<Tab>('Today')
  const [playerId, setPlayerId] = useState<number | null>(null)
  const [gameId, setGameId] = useState<string | null>(null)
  // Bumped by Refresh and when a sync finishes; views re-fetch whenever it changes.
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])
  const openPlayer = (id: number) => { setPlayerId(id); setTab('Players') }

  return (
    <div className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-5 lg:px-8">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight text-neutral-100">uBet</h1>
        <nav className="flex gap-1 text-sm">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setGameId(null) }}
              className={`rounded-md px-3 py-1.5 ${tab === t ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              {t}{t === 'Slip' && slip.legs.length > 0 && <span className="ml-1.5 rounded bg-neutral-700 px-1.5 text-xs text-neutral-100">{slip.legs.length}</span>}
            </button>
          ))}
        </nav>
      </header>

      <SyncBar onRefresh={bump} />

      <div key={`${tab}${gameId ?? ''}`} className="anim-fade">
      {tab === 'Today' && (gameId
        ? <GameDetail refreshKey={refreshKey} gameId={gameId} onBack={() => setGameId(null)} onOpenPlayer={openPlayer} />
        : <Today refreshKey={refreshKey} onOpenPlayer={openPlayer} onOpenGame={setGameId} onOpenSlip={() => setTab('Slip')} />)}
      {tab === 'Slip' && <Slip />}
      {tab === 'Minds' && <Minds refreshKey={refreshKey} />}
      {tab === 'Results' && <Results refreshKey={refreshKey} />}
      {tab === 'Players' && <PlayerView initialId={playerId} refreshKey={refreshKey} />}
      </div>
    </div>
  )
}
