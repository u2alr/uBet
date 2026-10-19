export const fmt = (n: number | null | undefined, d = 1) => (n == null ? '–' : n.toFixed(d))
export const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100)}%`)

export const STAT_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'STL', blk: 'BLK',
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body
}
