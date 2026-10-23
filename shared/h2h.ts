// Head-to-head helpers shared by the Worker endpoint and its tests. Pure.
export interface H2HRow { id: number; opp: string; date: string; minutes: number; pts: number; reb: number; ast: number; fg3m: number }

/** D1 allows 100 bound variables per statement; a chunk of at most 50 players plus at most 30 opponents stays under it. */
export const MAX_PLAYERS_PER_QUERY = 50

export function parsePairs(raw: string[]): { id: number; opp: string }[] | null {
  const out: { id: number; opp: string }[] = []
  for (const x of raw) {
    const m = /^(\d{1,12}):([A-Z]{2,4})$/.exec(x)
    if (!m) return null
    out.push({ id: Number(m[1]), opp: m[2] })
  }
  return out
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Keeps only requested player:opponent pairs, newest first (rows must arrive newest first), at most `per` meetings each. */
export function groupMeetings(rows: H2HRow[], pairs: { id: number; opp: string }[], per = 8): Record<string, H2HRow[]> {
  const want = new Set(pairs.map((p) => `${p.id}:${p.opp}`))
  const out: Record<string, H2HRow[]> = {}
  for (const r of rows) {
    const k = `${r.id}:${r.opp}`
    if (!want.has(k)) continue
    const list = (out[k] ??= [])
    if (list.length < per) list.push(r)
  }
  return out
}
