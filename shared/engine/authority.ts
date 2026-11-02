// ONE authoritative probability and expected-return calculation for everything the app shows.
//
// The numbers come from the canonical candidate record (record.ts): calibrated model probability, no-vig market probability from the independent
// books, the executable price, expected return through the canonical payoff (payoff.ts), and a conservative lower bound. The Props board,
// Today and the player page show the same numbers for the same market snapshot and model version.
//
// What this module does NOT do: make a number more convincing. Where the engine cannot compute honestly (no fresh boosted projection, no
// calibration for the statistic, no corroborated executable price) the pick keeps its older simple-blend numbers, labelled `basis: 'legacy'`.
import type { Pick } from '../picks.ts'
import { buildCandidate, minutesRanks, type CandidateRecord, type CandidateStatus } from './record.ts'
import type { CalibrationArtifact } from './calibration.ts'
import { stableHash, type EngineConfig } from './config.ts'
import type { ReasonCode } from './reasons.ts'

export interface AuthoritativeView {
  version: 'auth-v1'
  configHash: string
  calibrationVersion: string | null
  status: CandidateStatus
  probability: {
    /** The boosted model's own win chance (given the bet is decided), before calibration. */
    raw: number
    calibrated: number | null
    calibrationStatus: 'validated' | 'unvalidated' | 'missing'
    /** The margin-free chance the independent books imply. */
    marketFair: number | null
    /** What the expected return rests on: the calibrated model blended with the market. */
    decision: number | null
    /** A lower bound on it from the calibration bootstrap and the lowest margin-free book. Covers calibration and margin error only. */
    conservative: number | null
    /** Chance of a refund (the stat lands exactly on a whole-number line). */
    push: number
  }
  price: { executable: number | null; best: number | null; corroboratedBy: string | null; rejection: string | null; asOf: string | null; ageMinutes: number | null; independentBooks: number }
  /** Expected profit per unit staked, through the canonical payoff. `raw` uses the decision probability, `conservative` its lower bound. */
  ev: { raw: number | null; conservative: number | null; rawModel: number | null }
  reasons: { hard: ReasonCode[]; research: ReasonCode[]; flags: ReasonCode[] }
  /** How much evidence stands behind the numbers: 'strict' passes every approval rule, 'research' is valid but unvalidated or thin, 'insufficient' fails a rule. */
  evidence: 'strict' | 'research' | 'insufficient'
}

export function viewOf(r: CandidateRecord, config: EngineConfig, calibration: CalibrationArtifact | null): AuthoritativeView {
  return {
    version: 'auth-v1', configHash: stableHash(config), calibrationVersion: calibration?.version ?? null, status: r.status,
    probability: {
      raw: r.probability.raw, calibrated: r.probability.calibration.calibrated, calibrationStatus: r.probability.calibration.status,
      marketFair: r.probability.marketFair, decision: r.probability.decision, conservative: r.probability.conservative, push: r.probability.pushProbability,
    },
    price: {
      executable: r.price.price, best: r.price.best, corroboratedBy: r.price.corroboratedBy, rejection: r.price.rejection ?? null,
      asOf: r.price.asOf, ageMinutes: r.price.ageMinutes, independentBooks: r.probability.independentBooks,
    },
    ev: { raw: r.ev.raw, conservative: r.ev.conservative, rawModel: r.ev.rawModel },
    reasons: { hard: r.eligibility.hard.map((x) => x.code), research: r.eligibility.research.map((x) => x.code), flags: r.eligibility.flags.map((x) => x.code) },
    evidence: r.status === 'ELIGIBLE' ? 'strict' : r.status === 'RESEARCH_ONLY' ? 'research' : 'insufficient',
  }
}

export interface AuthorityContext {
  /** Used when a pick carries no snapshot time. */
  now: number
  config: EngineConfig
  calibration: CalibrationArtifact | null
  injuryChecked: boolean
}

/**
 * Attach the engine's numbers to every pick and make them the ones in `prob`, `ev`, `modelProb` and `marketProb`.
 * Quote freshness is judged at the time the odds were retrieved (`snapshotAt`), so two screens built from the same snapshot agree.
 * Returns new objects; the input is not modified. A pick that already has a `basis` is returned unchanged (the replacement happens once).
 */
export function applyAuthority<P extends Pick>(picks: P[], ctx: AuthorityContext): P[] {
  const ranks = minutesRanks(picks)
  return picks.map((p) => {
    if (p.basis) return p
    const legacy = { prob: p.prob, ev: p.ev, modelProb: p.modelProb, marketProb: p.marketProb }
    const record = buildCandidate(p, { now: p.snapshotAt ?? ctx.now, config: ctx.config, calibration: ctx.calibration, minutesRank: ranks, injuryChecked: ctx.injuryChecked })
    const auth = viewOf(record, ctx.config, ctx.calibration)
    // The calibration was fitted on the boosted model's probabilities only; the fallback average model's numbers are not calibratable.
    const usable = p.model === 'gbm-v1' && auth.probability.decision !== null && auth.probability.calibrated !== null && auth.ev.raw !== null
    if (!usable) return { ...p, basis: 'legacy' as const, legacy, auth }
    return {
      ...p, basis: 'authoritative' as const, legacy, auth,
      prob: auth.probability.decision!, ev: auth.ev.raw!, modelProb: auth.probability.calibrated!, marketProb: auth.probability.marketFair,
    }
  })
}
