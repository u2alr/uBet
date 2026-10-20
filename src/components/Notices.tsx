import type { PicksMeta } from '../../shared/picks.ts'
import { timeAgo } from '../lib/helper'

/** How old the odds are, and everything that makes the numbers below less reliable. Shown, never hidden. */
export default function Notices({ meta }: { meta: PicksMeta | null }) {
  if (!meta) return null
  return (
    <div className="mb-3 space-y-1 rounded-lg bg-neutral-900/60 px-4 py-3 text-xs text-neutral-500">
      <div>
        Odds as of <span className="text-neutral-300">{meta.oddsAsOf ? timeAgo(meta.oddsAsOf) : 'an unknown time'}</span>
        {meta.oddsAsOf && <> ({new Date(meta.oddsAsOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})</>}. Lines move before tip-off.
      </div>
      {meta.warnings.map((w) => (
        <div key={w.code} className="flex gap-2">
          <span aria-hidden>•</span>
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  )
}
