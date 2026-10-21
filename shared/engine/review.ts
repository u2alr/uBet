// The Matchup and Skeptic reviews: deterministic checks that can corroborate or contradict a candidate. Pure.
//
// Honest limits: the boosted model already sees the opponent's defence, pace and rest, and recent minutes. So the Matchup review
// is a SIMPLER VIEW OF INFORMATION THE MODEL ALREADY HOLDS: a check that the model is not walking against the obvious, not an
// independent second source of probability. It never adds probability. The Skeptic re-reads the same inputs for contradictions.
import type { Pick } from '../picks.ts'
import type { EngineConfig } from './config.ts'
import { reason, type Reason } from './reasons.ts'

export interface MatchupReview {
  /** Sum of +1 (supports the bet) and -1 (works against it) from minutes trend and the opponent's tendency. */
  score: number
  notes: string[]
  /** A specific, evidence-backed reason the bet could beat the market, or null. Supporting evidence, never a probability input. */
  explanation: string | null
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) }

export function reviewMatchup(p: Pick, cfg: EngineConfig): MatchupReview {
  const dir = p.side === 'over' ? 1 : -1
  let score = 0
  const notes: string[] = []
  const reasons: string[] = []
  const t = p.role?.trend ?? null
  if (t != null && Math.abs(t) >= cfg.matchup.minutesTrendEdge) {
    const s = Math.sign(t) * dir
    score += s
    const text = `minutes ${t > 0 ? 'up' : 'down'} ${Math.abs(t).toFixed(1)} over the last 5 games versus the 10 before`
    notes.push(`${text}, which ${s > 0 ? 'supports' : 'works against'} the ${p.side}`)
    if (s > 0) reasons.push(text)
  } else notes.push('minutes steady')
  const f = p.oppFactor ?? null
  if (f != null && Math.abs(f - 1) >= cfg.matchup.opponentEdge) {
    const s = Math.sign(f - 1) * dir
    score += s
    const text = `the opponent has allowed ${pct(Math.abs(f - 1))} ${f > 1 ? 'more' : 'less'} ${p.stat} than the league over its last 20 games`
    notes.push(`${text}, which ${s > 0 ? 'supports' : 'works against'} the ${p.side}`)
    if (s > 0) reasons.push(text)
  } else if (f != null) notes.push('opponent about average for this stat')
  else notes.push('opponent tendency unavailable')
  return { score, notes, explanation: score >= 1 && reasons.length ? reasons.join('; ') : null }
}

export interface SkepticReview { vetoes: Reason[]; flags: Reason[] }

/** Checks that need no calibration or price: injuries, minutes, history depth and recent form. */
export function reviewSkeptic(p: Pick, cfg: EngineConfig): SkepticReview {
  const vetoes: Reason[] = [], flags: Reason[] = []
  if (p.injury) vetoes.push(reason('INJURY_LISTED', `listed ${p.injury.label}${p.injury.note ? `: ${p.injury.note}` : ''}`))
  if (p.role?.trend != null && p.role.trend <= cfg.eligibility.minutesDeclineVeto) vetoes.push(reason('MINUTES_DECLINE', `minutes down ${Math.abs(p.role.trend).toFixed(1)} lately`))
  if (p.recent.length >= cfg.skeptic.formMinGames) {
    const m = mean(p.recent), s = Math.max(sd(p.recent), 0.5)
    const against = p.side === 'under' ? m > p.line + cfg.skeptic.formContradictionSd * s : m < p.line - cfg.skeptic.formContradictionSd * s
    if (against) vetoes.push(reason('FORM_CONTRADICTION', `the last ${p.recent.length} games average ${m.toFixed(1)} against a ${p.side} ${p.line}`))
  }
  if (p.push > 0.08) flags.push(reason('PUSH_RISK', `a ${pct(p.push)} chance of a refund`))
  return { vetoes, flags }
}
