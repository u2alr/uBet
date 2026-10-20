import { useCallback, useEffect, useState } from 'react'
import GameDetail from './components/GameDetail'
import PlayerView from './components/PlayerView'
import Minds from './components/Minds'
import Results from './components/Results'
import Slip from './components/Slip'
import SyncBar from './components/SyncBar'
import Today from './components/Today'
import { SlipProvider } from './lib/slip'
import { TABS, formatRoute, parseRoute, type Route } from './lib/route'
import { useSlip } from './lib/slipContext'

export default function App() {
  return (
    <SlipProvider>
      <Shell />
    </SlipProvider>
  )
}

function Shell() {
  const slip = useSlip()
  // Where you are lives in the address bar (#/Players/123), so the browser's back and forward buttons work.
  const [{ tab, gameId, playerId }, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  // Setting the hash adds a history entry and fires 'hashchange', which updates the state above.
  const go = (r: Partial<Route> & { tab: Route['tab'] }) => { window.location.assign(formatRoute(r)) }
  // Bumped by Refresh and when a sync finishes; views re-fetch whenever it changes.
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])
  const openPlayer = (id: number) => go({ tab: 'Players', playerId: id })

  return (
    <div className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-5 lg:px-8">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-medium tracking-tight text-neutral-100">uBet</h1>
        <nav className="flex gap-1 text-sm">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => go({ tab: t })}
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
        ? <GameDetail refreshKey={refreshKey} gameId={gameId} onBack={() => go({ tab: 'Today' })} onOpenPlayer={openPlayer} />
        : <Today refreshKey={refreshKey} onOpenPlayer={openPlayer} onOpenGame={(id) => go({ tab: 'Today', gameId: id })} onOpenSlip={() => go({ tab: 'Slip' })} />)}
      {tab === 'Slip' && <Slip />}
      {tab === 'Minds' && <Minds refreshKey={refreshKey} />}
      {tab === 'Results' && <Results refreshKey={refreshKey} />}
      {tab === 'Players' && <PlayerView key={playerId ?? 'search'} initialId={playerId} refreshKey={refreshKey} onSelect={openPlayer} />}
      </div>
    </div>
  )
}
