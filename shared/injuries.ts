// Player availability from ESPN's keyless injury list, and a role label from recent minutes. Pure: no network, no clock.
import { normName } from './picks.ts'

export type InjuryStatus = 'out' | 'doubtful' | 'questionable' | 'day-to-day' | 'other'
export interface Injury { status: InjuryStatus; label: string; note: string }

const SEVERITY: Record<InjuryStatus, number> = { out: 4, doubtful: 3, questionable: 2, 'day-to-day': 1, other: 0 }

const statusOf = (raw: string): InjuryStatus => {
  const s = raw.toLowerCase()
  if (s.includes('out')) return 'out'            // "Out", "Out For Season"
  if (s.includes('doubtful')) return 'doubtful'
  if (s.includes('questionable')) return 'questionable'
  if (s.includes('day')) return 'day-to-day'
  return 'other'
}

interface EspnInjuryFeed { injuries?: { injuries?: { status?: string; shortComment?: string; athlete?: { displayName?: string } }[] }[] }

/** Player (by normalised name) -> their most serious listed status. Malformed entries are skipped, never thrown on. */
export function parseInjuries(feed: unknown): Map<string, Injury> {
  const out = new Map<string, Injury>()
  const teams = (feed as EspnInjuryFeed | null)?.injuries
  if (!Array.isArray(teams)) return out
  for (const t of teams)
    for (const i of Array.isArray(t?.injuries) ? t.injuries : []) {
      const name = i?.athlete?.displayName
      if (typeof name !== 'string' || !name || typeof i.status !== 'string') continue
      const status = statusOf(i.status)
      const key = normName(name)
      const cur = out.get(key)
      if (!cur || SEVERITY[status] > SEVERITY[cur.status])
        out.set(key, { status, label: i.status, note: typeof i.shortComment === 'string' ? i.shortComment.slice(0, 240) : '' })
    }
  return out
}

/**
 * Attach availability to picks. A pick on a player listed Out cannot win, so it is removed and counted;
 * everyone else keeps their pick with the status attached.
 */
export function annotateInjuries<P extends { player: string; injury?: Injury | null }>(picks: P[], injuries: Map<string, Injury>): { picks: P[]; dropped: string[] } {
  const dropped = new Set<string>()
  const kept: P[] = []
  for (const p of picks) {
    const inj = injuries.get(normName(p.player)) ?? null
    if (inj?.status === 'out') { dropped.add(p.player); continue }
    kept.push({ ...p, injury: inj })
  }
  return { picks: kept, dropped: [...dropped] }
}

// ---------- roles ----------

export type RoleLabel = 'Starter' | 'Rotation' | 'Bench' | 'Fringe'
export interface Role { label: RoleLabel; min10: number; /** Last 5 games' minutes minus the 10 before them; null if fewer than 8 games. */ trend: number | null; games: number }

/** Minutes tiers. Start flags are not in the data we hold, so this is a minutes role, not a lineup role. */
export const ROLE_TIERS = { starter: 28, rotation: 20, bench: 10 } as const

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** `minutes` is newest first. Needs 3+ games; fewer returns null rather than a guess. */
export function roleFromMinutes(minutes: number[]): Role | null {
  const m = minutes.filter((x) => Number.isFinite(x) && x > 0 && x <= 70)
  if (m.length < 3) return null
  const min10 = mean(m.slice(0, 10))
  const label: RoleLabel = min10 >= ROLE_TIERS.starter ? 'Starter' : min10 >= ROLE_TIERS.rotation ? 'Rotation' : min10 >= ROLE_TIERS.bench ? 'Bench' : 'Fringe'
  const trend = m.length >= 8 ? mean(m.slice(0, 5)) - mean(m.slice(5, 15)) : null
  return { label, min10, trend, games: m.length }
}
