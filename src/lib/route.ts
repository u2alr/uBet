import { PLAYER_PROPS } from './features.ts'
// The address bar is the source of truth for where you are, so the browser's back and forward buttons just work.
// Hash routes keep this a static site: #/Teams (home, team bets), #/Today, #/Props, #/Today/game/<id>, #/Players, #/Players/<playerId>, #/Results ...
const ALL_TABS = ['Teams', 'Lineups', 'Today', 'Review', 'Props', 'Matchups', 'Cheatsheet', 'Standings', 'Results', 'Players'] as const
export type Tab = (typeof ALL_TABS)[number]
/** What the header shows. The player-props tabs are hidden while PLAYER_PROPS is off; their addresses still open, so old links keep working. */
const PROPS_TABS: readonly Tab[] = ['Props', 'Matchups', 'Cheatsheet', 'Results', 'Players']
export const TABS: readonly Tab[] = ALL_TABS.filter((t) => PLAYER_PROPS || !PROPS_TABS.includes(t))
export interface Route { tab: Tab; gameId: string | null; playerId: number | null }

export const HOME: Route = { tab: 'Teams', gameId: null, playerId: null }

/** Anything malformed falls back to the home page rather than throwing: the hash is user-editable. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const tab = ALL_TABS.find((t) => t.toLowerCase() === (parts[0] ?? '').toLowerCase())
  if (!tab) return HOME
  if (tab === 'Today' && parts[1] === 'game' && /^[\w-]{1,40}$/.test(parts[2] ?? '')) return { tab, gameId: parts[2], playerId: null }
  if (tab === 'Players' && /^\d{1,12}$/.test(parts[1] ?? '')) return { tab, gameId: null, playerId: Number(parts[1]) }
  return { tab, gameId: null, playerId: null }
}

export function formatRoute(r: Partial<Route> & { tab: Tab }): string {
  if (r.tab === 'Today' && r.gameId) return `#/Today/game/${encodeURIComponent(r.gameId)}`
  if (r.tab === 'Players' && r.playerId != null) return `#/Players/${r.playerId}`
  return `#/${r.tab}`
}
