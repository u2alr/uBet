import type { PicksMeta } from '../../shared/picks.ts'
import { timeAgo } from '../lib/helper'

/**
 * How old the odds are, and everything that makes the numbers below less reliable. One quiet line; the explanations open on request.
 * Warnings are never hidden: their count stays visible in amber even when the list is collapsed.
 */
export default function Notices({ meta }: { meta: PicksMeta | null }) {
  if (!meta) return null
  const n = meta.warnings.length
  return (
    <details className="group text-xs text-neutral-500">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-1 hover:text-neutral-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 [&::-webkit-details-marker]:hidden">
        <span>Odds as of <span className="text-neutral-300">{meta.oddsAsOf ? `${timeAgo(meta.oddsAsOf)} (${new Date(meta.oddsAsOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : 'an unknown time'}</span></span>
        {n > 0 && <span className="text-amber-400">{n} warning{n === 1 ? '' : 's'}</span>}
        <span className="ml-auto text-neutral-600 group-open:hidden">Details</span><span className="ml-auto hidden text-neutral-600 group-open:inline">Hide</span>
      </summary>
      <div className="mt-1 space-y-1 rounded-lg border border-neutral-800 px-4 py-3">
        <p>Lines move before tip-off; check the book before betting.</p>
        {meta.warnings.map((w) => (
          <p key={w.code} className="flex gap-2 text-neutral-400"><span aria-hidden>•</span><span>{w.message}</span></p>
        ))}
      </div>
    </details>
  )
}
