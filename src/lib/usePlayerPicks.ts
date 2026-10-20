import { useEffect, useState } from 'react'
import { api } from './format'
import type { Pick } from './picks'

/** Every prop line on offer for one player (from the cached odds), plus a note when there are none to show. */
export function usePlayerPicks(playerId: number | null, refreshKey: number) {
  const [state, setState] = useState<{ id: number; picks: Pick[]; note: string } | null>(null)
  useEffect(() => {
    if (playerId === null) return
    let live = true
    api<{ configured: boolean; data: Pick[] }>('/picks')
      .then((r) => live && setState({ id: playerId, picks: r.data.filter((p) => p.playerId === playerId), note: r.configured ? '' : 'Odds are not set up.' }))
      .catch((e) => live && setState({ id: playerId, picks: [], note: e.message }))
    return () => { live = false }
  }, [playerId, refreshKey])
  // A response for the previous player must not be shown under the new one.
  return state && state.id === playerId ? { picks: state.picks, note: state.note, loading: false } : { picks: [] as Pick[], note: '', loading: playerId !== null }
}
