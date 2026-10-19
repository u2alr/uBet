import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/format'
import { helperStatus, helperSync, timeAgo, type HelperState } from '../lib/helper'

interface Status { lastSync: string | null; players: number; newestGame: string | null }

/** Data freshness plus the Refresh and Sync buttons. `onRefresh` makes the current page re-fetch. */
export default function SyncBar({ onRefresh }: { onRefresh: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [helper, setHelper] = useState<HelperState | null>(null)
  const [note, setNote] = useState('')
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const wasRunning = useRef(false)

  const loadStatus = useCallback(() => {
    api<Status>('/status').then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(loadStatus, [loadStatus])

  // Poll the local helper (if it's running) so progress shows up, including syncs started elsewhere.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const h = await helperStatus()
      if (!alive) return
      setHelper(h)
      if (wasRunning.current && h && !h.running) {
        loadStatus()
        onRefresh()
        setRefreshedAt(new Date())
        setNote(h.error ? `Sync problem: ${h.error}` : '')
      }
      wasRunning.current = !!h?.running
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [loadStatus, onRefresh])

  const refresh = () => {
    onRefresh()
    loadStatus()
    setRefreshedAt(new Date())
    setNote('')
  }

  async function sync() {
    setNote('')
    const err = await helperSync()
    if (err) setNote(err)
    else setHelper((h) => (h ? { ...h, running: true, label: 'Starting', done: 0, total: 0 } : h))
  }

  const btn = 'rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50'
  const running = helper?.running

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
      <span>
        Box scores synced <span className="text-neutral-300">{timeAgo(status?.lastSync ?? null)}</span>
        {status && <> · {status.players} players{status.newestGame && <> · latest game {status.newestGame}</>}</>}
      </span>
      {refreshedAt && <span>Refreshed {refreshedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
      {note && <span className="text-neutral-400">{note}</span>}

      <span className="ml-auto flex items-center gap-2">
        {running && (
          <span className="tabular-nums text-neutral-400">
            {helper?.label}{helper && helper.total > 0 ? ` ${helper.done}/${helper.total}` : '…'}
          </span>
        )}
        <button className={btn} onClick={refresh} disabled={!!running} title="Re-fetch games, odds and picks">Refresh</button>
        <button
          className={btn}
          onClick={sync}
          disabled={!helper || !!running}
          title={helper ? 'Pull the latest box scores from NBA.com (takes several minutes)' : 'Start the local helper first: npm run dev:sync'}
        >
          {running ? 'Syncing…' : 'Sync data'}
        </button>
      </span>
    </div>
  )
}
