import type { Pick } from '../lib/picks'
import { evidenceInfo, type EvidenceKind } from '../lib/evidence'

const TONE: Record<EvidenceKind, string> = {
  strict: 'border-emerald-500/50 text-emerald-300',
  research: 'border-neutral-600 text-neutral-300',
  insufficient: 'border-neutral-700 text-neutral-500',
  legacy: 'border-dashed border-neutral-600 text-neutral-500',
}

/** How much evidence stands behind a pick's numbers. It says nothing about safety: see src/lib/evidence.ts. */
export default function EvidenceBadge({ p }: { p: Pick }) {
  const e = evidenceInfo(p)
  return (
    <span className={`inline-block cursor-help rounded border px-1.5 py-0.5 text-[11px] tracking-wide ${TONE[e.kind]}`} tabIndex={0} title={`${e.label}. ${e.detail.join('; ')}`}>
      {e.label}
    </span>
  )
}
