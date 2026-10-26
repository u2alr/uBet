// The canonical candidate record: ONE place where probability, price, expected return and eligibility are calculated.
// Every specialist and the Chief read these records; none of them recomputes a probability or a payoff.
import type { Pick } from '../picks.ts'
import { binaryExpectedReturn } from './payoff.ts'
import { buildConsensus, selectExecutablePrice, LINE_MOVEMENT_STATUS, type Consensus, type ExecutablePrice, type ConsensusSettings } from './consensus.ts'
import { calibrateSide, type CalibratedProbability, type CalibrationArtifact } from './calibration.ts'
import type { EngineConfig } from './config.ts'
import { classOf, reason, type Reason } from './reasons.ts'
import { reviewMatchup, reviewSkeptic, type MatchupReview } from './review.ts'

export type CandidateStatus = 'ELIGIBLE' | 'RESEARCH_ONLY' | 'REJECTED'

export interface CandidateRecord {
  key: string
  identity: { playerId: number; player: string; team: string | null; eventId: string; game: string; gameDate: string; verified: boolean }
  market: { stat: string; line: number; side: 'over' | 'under'; wholeNumberLine: boolean; mainLine: boolean | null; settlement: 'over_under_refund_on_tie' }
  inputs: { model: string; projectionAgeHours: number | null; gamesOfHistory: number; minutesAverage: number | null; minutesTrend: number | null; minutesRank: number | null; injuryChecked: boolean }
  probability: {
    /** The model's win probability given the bet is decided. */
    raw: number
    pushProbability: number
    calibration: Omit<CalibratedProbability, 'raw'>
    marketImpliedWithMargin: number | null
    marketFair: number | null
    marketFairLower: number | null
    independentBooks: number
    corroborated: boolean
    /** Calibrated model minus market fair (probability points, signed). Null when either is unavailable. */
    disagreement: number | null
    marketWeight: number
    basis: 'blend' | 'model'
    /** What the decision rests on, and its lower bound. Null when it cannot be computed honestly. */
    decision: number | null
    conservative: number | null
    uncertainty: { method: string; confidence: string; modelLowerBound: number | null; marketLowerBound: number | null; note: string }
  }
  price: ExecutablePrice & { lineMovement: typeof LINE_MOVEMENT_STATUS }
  consensus: Consensus
  /** Expected return per unit staked, as decimals. `rawModel` follows the calibrated model alone; `raw` the decision probability; `conservative` its lower bound. */
  ev: { rawModel: number | null; raw: number | null; conservative: number | null }
  review: { matchup: MatchupReview }
  eligibility: { hard: Reason[]; research: Reason[]; flags: Reason[] }
  status: CandidateStatus
}

export interface RecordContext {
  now: number
  config: EngineConfig
  calibration: CalibrationArtifact | null
  /** `${eventId}|${team}|${playerId}` -> 1-based rank by recent minutes within the team in that game. */
  minutesRank: Map<string, number>
  /** True when the injury list was fetched successfully for this run. */
  injuryChecked: boolean
}

/** One market: event, player, stat, line and side. The event is part of the key so the same line in two different games is never merged. */
export const legKey = (p: Pick) => `${p.eventId}|${p.playerId}|${p.stat}|${p.line}|${p.side}`
const rankKey = (p: Pick) => `${p.eventId}|${p.team}|${p.playerId}`
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`

/** Rank every player with a minutes role within their team in each game (1 = most minutes). */
export function minutesRanks(picks: Pick[]): Map<string, number> {
  const groups = new Map<string, Map<number, number>>()
  for (const p of picks) {
    if (p.team == null || !p.role) continue
    const g = groups.get(`${p.eventId}|${p.team}`) ?? groups.set(`${p.eventId}|${p.team}`, new Map()).get(`${p.eventId}|${p.team}`)!
    g.set(p.playerId, p.role.min10)
  }
  const out = new Map<string, number>()
  for (const [g, m] of groups) [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0]).forEach(([id], i) => out.set(`${g}|${id}`, i + 1))
  return out
}

export function consensusSettings(ctx: { now: number; config: EngineConfig }): ConsensusSettings & { priceCorroboration: number; staleLineRatio: number } {
  const c = ctx.config
  return {
    now: ctx.now, maxQuoteAgeMinutes: c.eligibility.maxQuoteAgeMinutes, feedGroups: c.market.feedGroups, outlierMinDeviation: c.market.outlierMinDeviation,
    outlierMadK: c.market.outlierMadK, maxBookDisagreement: c.market.maxBookDisagreement, priceCorroboration: c.market.priceCorroboration, staleLineRatio: c.market.staleLineRatio,
  }
}

export function buildCandidate(p: Pick, ctx: RecordContext): CandidateRecord {
  const cfg = ctx.config
  const e = cfg.eligibility
  const hard: Reason[] = [], research: Reason[] = [], flags: Reason[] = []
  const add = (r: Reason) => { const k = classOf(r.code); (k === 'research' ? research : k === 'flag' ? flags : hard).push(r) }
  const settings = consensusSettings(ctx)

  // ---- numbers: nothing below is computed from a value that is not a finite number
  const numbersOk = [p.modelProb, p.price, p.push].every((x) => Number.isFinite(x)) && p.price > 1 && p.modelProb >= 0 && p.modelProb <= 1 && p.push >= 0 && p.push <= 1
  if (!numbersOk) add(reason('INVALID_NUMBERS', 'a probability or price is missing or out of range'))

  // ---- evidence
  const cal = numbersOk ? calibrateSide(ctx.calibration, p.stat, p.side, p.modelProb, cfg.probability.confidenceLevel) : calibrateSide(null, p.stat, p.side, 0.5, cfg.probability.confidenceLevel)
  const consensus = buildConsensus(p.bookQuotes ?? [], p.side, settings)
  const price = selectExecutablePrice(p.sideQuotes ?? [], settings)
  const matchup = reviewMatchup(p, cfg)
  const skeptic = reviewSkeptic(p, cfg)

  // ---- decision probability and its lower bound (blend of the two components' lower bounds; no manufactured standard error)
  const w = cfg.probability.marketWeight
  let decision: number | null = null, conservative: number | null = null
  if (numbersOk && cal.calibrated !== null && cal.lower !== null) {
    if (cfg.probability.basis === 'model') { decision = cal.calibrated; conservative = cal.lower }
    else if (consensus.fair !== null && consensus.fairLower !== null) {
      decision = w * consensus.fair + (1 - w) * cal.calibrated
      conservative = w * consensus.fairLower + (1 - w) * cal.lower
    }
  }
  const ev = (prob: number | null) => (prob !== null && price.price !== null && numbersOk ? binaryExpectedReturn(prob, p.push, price.price) : null)
  const gap = cal.calibrated !== null && consensus.fair !== null ? cal.calibrated - consensus.fair : null

  // ---- eligibility policy: the one list of mandatory conditions
  if (p.team == null) add(reason('NO_TEAM', 'the player has no current team'))
  if (p.model !== 'gbm-v1') add(reason('NO_FRESH_PROJECTION', `the probability came from ${p.model}, not a fresh boosted projection`))
  else if (p.projectionAgeHours == null || p.projectionAgeHours > e.maxProjectionAgeHours) add(reason('STALE_PROJECTION', `projection ${p.projectionAgeHours == null ? 'age unknown' : `${p.projectionAgeHours.toFixed(1)}h old`}; limit ${e.maxProjectionAgeHours}h`))
  if (!p.role) add(reason('NO_MINUTES_DATA', 'no recent minutes'))
  else {
    if (p.role.min10 < e.minMinutes) add(reason('LOW_MINUTES', `${p.role.min10.toFixed(1)} minutes; needs ${e.minMinutes}`))
    const rank = ctx.minutesRank.get(rankKey(p)) ?? null
    if (rank === null || rank > e.topNByMinutes) add(reason('NOT_TOP_BY_MINUTES', `rank ${rank ?? 'unknown'} by minutes; needs the top ${e.topNByMinutes}`))
  }
  for (const v of skeptic.vetoes) add(v)
  for (const f of skeptic.flags) add(f)
  if (!ctx.injuryChecked) add(reason('INJURY_STATUS_UNVERIFIED', 'the injury list could not be fetched, so availability is unknown'))
  if (p.identity !== 'verified') add(reason('IDENTITY_UNVERIFIED', 'the provider gave no NBA player id to check the name against'))
  if (p.sample < e.minGamesResearch) add(reason('THIN_HISTORY', `${p.sample} games; needs ${e.minGamesStrict}`))
  else if (p.sample < e.minGamesStrict) add(reason('RESEARCH_THIN_HISTORY', `${p.sample} games: enough to record, not to approve (needs ${e.minGamesStrict})`))
  if (consensus.independentFeeds < e.minIndependentBooks) add(reason(consensus.independentFeeds === 0 ? 'NO_USABLE_QUOTES' : 'TOO_FEW_INDEPENDENT_BOOKS', `${consensus.independentFeeds} independent fresh two-sided feeds; needs ${e.minIndependentBooks}`))
  if (consensus.flags.includes('BOOKS_DISAGREE')) add(reason('BOOKS_DISAGREE', 'the independent books disagree too much to corroborate each other'))
  if (price.rejection) add(reason(price.rejection, price.rejection === 'UNVERIFIED_PRICE' ? 'only one independent fresh quote supports the price' : price.rejection === 'STALE_LINE_SUSPECT' ? 'the best price is far above every other independent quote' : 'no quote is fresh enough'))
  if (price.price !== null && consensus.fair !== null && numbersOk) {
    const marketEv = binaryExpectedReturn(consensus.fair, p.push, price.price)
    if (marketEv < cfg.market.minMarketEv) add(reason('RICH_PRICE', `the price is worth ${pct(marketEv, 1)} against the market's own fair value`))
  }
  if (gap !== null) {
    if (Math.abs(gap) >= e.extremeGap) add(reason('EXTREME_GAP', `calibrated model and market ${pct(Math.abs(gap), 1)} apart`))
    else if (Math.abs(gap) >= e.reviewGap) {
      add(reason('GAP_NEEDS_MATCHUP', `calibrated model and market ${pct(Math.abs(gap), 1)} apart`))
      if (!matchup.explanation) add(reason('UNEXPLAINED_GAP', `a ${pct(Math.abs(gap), 1)} gap with no specific matchup reason`))
    }
  }
  if (matchup.score < 0) add(reason('MATCHUP_CONTRADICTED', matchup.notes.join('; ')))
  if (cal.status === 'missing') add(reason('CALIBRATION_MISSING', cal.reason ?? 'no calibration'))
  else if (cal.status === 'unvalidated') add(reason('CALIBRATION_UNVALIDATED', `${p.stat} failed its calibration gates`))
  if (cal.clamped) add(reason('CALIBRATION_CLAMPED', 'the raw probability is outside the calibrated range'))
  if (consensus.contributors.some((c) => c.timestampSource !== 'quote')) add(reason('TIMESTAMP_FROM_FEED_ONLY', 'some quotes are dated only by the feed they arrived in'))
  add(reason('LINE_MOVEMENT_UNAVAILABLE', 'no timestamped odds history exists'))

  const { raw: _raw, ...calibration } = cal
  void _raw
  const rawModelEv = ev(cal.calibrated)
  return {
    key: legKey(p),
    identity: { playerId: p.playerId, player: p.player, team: p.team, eventId: p.eventId, game: p.game, gameDate: p.gameDate, verified: p.identity === 'verified' },
    market: { stat: p.stat, line: p.line, side: p.side, wholeNumberLine: Number.isInteger(p.line), mainLine: p.mainKnown ? !!p.main : null, settlement: 'over_under_refund_on_tie' },
    inputs: {
      model: p.model, projectionAgeHours: p.projectionAgeHours, gamesOfHistory: p.sample, minutesAverage: p.role?.min10 ?? null,
      minutesTrend: p.role?.trend ?? null, minutesRank: ctx.minutesRank.get(rankKey(p)) ?? null, injuryChecked: ctx.injuryChecked,
    },
    probability: {
      raw: p.modelProb, pushProbability: p.push, calibration, marketImpliedWithMargin: consensus.impliedWithMargin, marketFair: consensus.fair,
      marketFairLower: consensus.fairLower, independentBooks: consensus.independentFeeds, corroborated: consensus.corroborated, disagreement: gap,
      marketWeight: w, basis: cfg.probability.basis, decision, conservative,
      uncertainty: {
        method: 'lower bound of the bootstrap-calibrated model probability (weeks resampled) blended with the lower envelope of the independent books\' fair probabilities',
        confidence: `${cfg.probability.confidenceLevel}% one-sided`, modelLowerBound: cal.lower, marketLowerBound: consensus.fairLower,
        note: 'covers calibration and margin-removal uncertainty only; there is no per-player standard error',
      },
    },
    price: { ...price, lineMovement: LINE_MOVEMENT_STATUS },
    consensus,
    ev: { rawModel: rawModelEv, raw: ev(decision), conservative: ev(conservative) },
    review: { matchup },
    eligibility: { hard, research, flags },
    status: hard.length ? 'REJECTED' : research.length ? 'RESEARCH_ONLY' : 'ELIGIBLE',
  }
}

/** A threshold is met only by a value at or above it. No rounding: a value that merely displays as the threshold does not qualify. */
export const atLeast = (value: number | null, threshold: number): value is number => value !== null && Number.isFinite(value) && value >= threshold
