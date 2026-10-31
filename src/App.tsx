import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

// Heavy tabs (charts, the Minds screen) load on first visit instead of with the first page.
const GameDetail = lazy(() => import('./components/GameDetail'))
const PlayerView = lazy(() => import('./components/PlayerView'))
const Minds = lazy(() => import('./components/Minds'))
const Results = lazy(() => import('./components/Results'))
const Slip = lazy(() => import('./components/Slip'))
const Standings = lazy(() => import('./components/Standings'))
const CheatSheet = lazy(() => import('./components/CheatSheet'))
const Matchups = lazy(() => import('./components/Matchups'))
import PropsBoard from './components/PropsBoard'
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
    <div className="mx-auto max-w-screen-2xl px-3 pb-8 sm:px-5 lg:px-8">
      <header className="sticky top-0 z-20 -mx-3 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-800/80 bg-neutral-950/90 px-3 py-1.5 backdrop-blur sm:-mx-5 sm:h-12 sm:flex-nowrap sm:px-5 sm:py-0 lg:-mx-8 lg:px-8">
        <button onClick={() => go({ tab: 'Props' })} className="flex items-center gap-2 text-neutral-100" aria-label="uBet home">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-emerald-500 text-sm font-bold text-neutral-950">u</span>
          <span className="text-base font-semibold tracking-tight">uBet</span>
        </button>
        <nav aria-label="Main" className="order-last flex w-full gap-1 overflow-x-auto text-sm [scrollbar-width:none] sm:order-none sm:w-auto [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => go({ tab: t })}
              className={`whitespace-nowrap rounded-full px-3 py-1 ${tab === t ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-200'}`}
            >
              {t === 'Today' ? 'Games' : t === 'Cheatsheet' ? 'Cheat sheet' : t}{t === 'Slip' && slip.legs.length > 0 && <span className="ml-1.5 rounded-full bg-emerald-500 px-1.5 text-xs font-medium text-neutral-950">{slip.legs.length}</span>}
            </button>
          ))}
        </nav>
      </header>

      <SyncBar onRefresh={bump} />

      <main key={`${tab}${gameId ?? ''}`} className="anim-fade">
      <h1 className="sr-only">{tab === 'Today' ? 'Games' : tab === 'Cheatsheet' ? 'Cheat sheet' : tab}</h1>
      <Suspense fallback={<p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading…</p>}>
      {tab === 'Props' && <PropsBoard refreshKey={refreshKey} onOpenPlayer={openPlayer} onOpenSlip={() => go({ tab: 'Slip' })} />}
      {tab === 'Today' && (gameId
        ? <GameDetail refreshKey={refreshKey} gameId={gameId} onBack={() => go({ tab: 'Today' })} onOpenPlayer={openPlayer} />
        : <Today refreshKey={refreshKey} onOpenPlayer={openPlayer} onOpenGame={(id) => go({ tab: 'Today', gameId: id })} onOpenSlip={() => go({ tab: 'Slip' })} />)}
      {tab === 'Matchups' && <Matchups refreshKey={refreshKey} onOpenPlayer={openPlayer} />}
      {tab === 'Cheatsheet' && <CheatSheet refreshKey={refreshKey} onOpenPlayer={openPlayer} />}
      {tab === 'Standings' && <Standings refreshKey={refreshKey} />}
      {tab === 'Slip' && <Slip />}
      {tab === 'Minds' && <Minds refreshKey={refreshKey} />}
      {tab === 'Results' && <Results refreshKey={refreshKey} />}
      {tab === 'Players' && <PlayerView key={playerId ?? 'search'} initialId={playerId} refreshKey={refreshKey} onSelect={openPlayer} />}
      </Suspense>
      </main>
    </div>
  )
}
