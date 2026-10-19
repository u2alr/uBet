// Talks to the local sync helper (npm run dev:sync), which runs ingest/sync.py on this machine.
// It only exists when you run the app locally, so every call must tolerate it being absent.

export interface HelperState {
  running: boolean
  label: string
  done: number
  total: number
  error: string
  finishedAt: string | null
}

/** null when the helper isn't running. */
export async function helperStatus(): Promise<HelperState | null> {
  try {
    const res = await fetch('/local-sync/status')
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Sync everyone, or just one player by name. */
export async function helperSync(player?: string): Promise<string | null> {
  const qs = player ? `?player=${encodeURIComponent(player)}` : ''
  const res = await fetch(`/local-sync/sync${qs}`, { method: 'POST' })
  if (res.ok) return null
  return (await res.json().catch(() => ({}))).error ?? `Sync failed (${res.status})`
}

export function timeAgo(iso: string | null) {
  if (!iso) return 'never'
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
