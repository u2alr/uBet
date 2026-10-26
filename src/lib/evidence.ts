// What stands behind a pick's numbers, in words that make no claim about safety. Replaces the old Safe / Even / Risky label, which was a
// win-probability bucket: a 70% pick at 1.30 is likely to win and still loses money on average.
import { reasonLabel } from '../../shared/engine/reasons.ts'
import type { Pick } from './picks.ts'

export type EvidenceKind = 'strict' | 'research' | 'insufficient' | 'legacy'
export interface EvidenceInfo { kind: EvidenceKind; label: string; detail: string[] }

const MAX_REASONS = 3

export function evidenceInfo(p: Pick): EvidenceInfo {
  if (p.basis !== 'authoritative' || !p.auth) {
    return { kind: 'legacy', label: 'Unvalidated blend', detail: ['The engine could not compute this line (no fresh boosted projection, no calibration for the statistic, or no corroborated price), so the older simple blend is shown. It has not been validated.'] }
  }
  const a = p.auth
  if (a.evidence === 'strict') return { kind: 'strict', label: 'Strict rules met', detail: ['Passed every approval rule. A probability and an average return, not a guarantee.'] }
  const codes = [...a.reasons.hard, ...a.reasons.research]
  const detail = codes.slice(0, MAX_REASONS).map(reasonLabel)
  if (codes.length > MAX_REASONS) detail.push(`${codes.length - MAX_REASONS} more`)
  if (a.evidence === 'research') return { kind: 'research', label: 'Research only', detail }
  return { kind: 'insufficient', label: 'Not enough evidence', detail }
}

export interface PickSummary { winChance: number; ev: number; price: number; evAtPrice: number | null; conservativeEv: number | null; evidence: EvidenceInfo; authoritative: boolean }

/** The numbers a reader needs side by side. Win chance and EV are different questions: both are always returned. */
export function summarize(p: Pick): PickSummary {
  return {
    winChance: p.prob, ev: p.ev, price: p.price, evAtPrice: p.basis === 'authoritative' ? p.auth?.price.executable ?? null : null,
    conservativeEv: p.basis === 'authoritative' ? p.auth?.ev.conservative ?? null : null, evidence: evidenceInfo(p), authoritative: p.basis === 'authoritative',
  }
}
