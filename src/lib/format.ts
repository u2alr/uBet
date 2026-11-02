export const fmt = (n: number | null | undefined, d = 1) => (n == null ? '–' : n.toFixed(d))
export const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100)}%`)

export const STAT_LABEL: Record<string, string> = {
  pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', stl: 'STL', blk: 'BLK', pra: 'PRA',
}

// An optional access token for personal routes on a deployed copy. It lives in this browser only and is sent as a header; on localhost it is not needed.
const TOKEN_KEY = 'ubet-access-token'
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`/api${path}`, token ? { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), 'x-capture-token': token } } : init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body
}
