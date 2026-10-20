import type { Injury, Role } from '../../shared/injuries'

// Status colours are fixed, never reused for a statistic, and always come with a label so colour is never the only cue.
const TONE: Record<Injury['status'], string> = {
  out: 'text-[#d03b3b]', doubtful: 'text-[#ec835a]', questionable: 'text-[#fab219]', 'day-to-day': 'text-neutral-400', other: 'text-neutral-500',
}
const SHORT: Record<Injury['status'], string> = { out: 'OUT', doubtful: 'DOUBTFUL', questionable: 'QUESTIONABLE', 'day-to-day': 'DAY-TO-DAY', other: 'LISTED' }

export function InjuryTag({ injury }: { injury?: Injury | null }) {
  if (!injury) return null
  return (
    <span className={`rounded border border-current px-1 text-[9px] leading-4 tracking-wide ${TONE[injury.status]}`} title={`${injury.label}${injury.note ? `: ${injury.note}` : ''} (ESPN, can lag)`}>
      ⚠ {SHORT[injury.status]}
    </span>
  )
}

export function RoleTag({ role }: { role?: Role | null }) {
  if (!role) return null
  const t = role.trend
  const arrow = t == null || Math.abs(t) < 2 ? '' : t > 0 ? ` ↑${t.toFixed(0)}` : ` ↓${Math.abs(t).toFixed(0)}`
  return (
    <span className="text-[10px] text-neutral-500" title={`Averaging ${role.min10.toFixed(1)} minutes over the last ${Math.min(10, role.games)} games${t == null ? '' : `; ${t >= 0 ? '+' : ''}${t.toFixed(1)} min vs the 10 before`}. A minutes role: starts are not tracked.`}>
      {role.label} · {role.min10.toFixed(0)}m{arrow}
    </span>
  )
}
