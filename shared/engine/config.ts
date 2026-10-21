// One validated configuration for the whole decision engine. Every threshold lives here and nowhere else.
// A configuration that does not validate throws: the engine never runs on a half-checked setting.

export interface EngineConfig {
  eligibility: {
    maxProjectionAgeHours: number
    /** Completed games of history needed for strict approval. */
    minGamesStrict: number
    /** With at least this many (but fewer than strict) a candidate is research-only. */
    minGamesResearch: number
    /** The player must be among the team's top N by recent minutes... */
    topNByMinutes: number
    /** ...and average at least this many. */
    minMinutes: number
    /** Minutes change (last 5 vs the 10 before) at or below this is a material decline. */
    minutesDeclineVeto: number
    /** Independent sportsbook feeds that must quote BOTH sides of the same market. */
    minIndependentBooks: number
    /** A quote older than this is stale. */
    maxQuoteAgeMinutes: number
    /** Model/market gap (probability points, 0 to 1) at which a candidate is rejected outright. */
    extremeGap: number
    /** From this gap a specific matchup explanation is required. */
    reviewGap: number
  }
  probability: {
    /** Weight of the market's fair probability in the decision probability. The model gets 1 minus this. Unvalidated. */
    marketWeight: number
    /** One-sided confidence of the lower bound, as a key of the calibration artifact ('80', '90' or '95'). */
    confidenceLevel: '80' | '90' | '95'
    /** 'blend' decides on the market-and-model blend; 'model' on the calibrated model alone. */
    basis: 'blend' | 'model'
  }
  market: {
    /** The price counted is capped at this multiple of the next-best independent price. */
    priceCorroboration: number
    /** A best price this far above the runner-up looks stale. */
    staleLineRatio: number
    /** The executable price may not be richer against the market's fair price than this expected return. */
    minMarketEv: number
    /** A book's fair probability this far from the median (and from 3 scaled MADs) is an outlier. */
    outlierMinDeviation: number
    outlierMadK: number
    /** Two independent books whose fair probabilities differ by more than this cannot corroborate each other. */
    maxBookDisagreement: number
    /** Books that republish one feed share a group, so they count once. Unlisted books are their own feed. */
    feedGroups: Record<string, string>
  }
  matchup: { minutesTrendEdge: number; opponentEdge: number }
  skeptic: { formMinGames: number; formContradictionSd: number }
  sam: { minProbability: number; minEvConservative: number }
  val: { minProbability: number; minEvConservative: number }
  cat: { minGap: number; maxMarketProbability: number; minEvConservative: number; minMatchupScore: number }
  lou: { minLegEv: number; minLegProbability: number; minLegs: number; maxLegs: number; minParlayEv: number; maxParlaysPerDay: number }
  lean: { minRawEv: number; minRawProbability: number; maxPerPlayer: number; maxPerDay: number; hypotheticalStake: number }
  portfolio: {
    maxStrictPerPlayerStat: number
    maxStrictPerPlayer: number
    maxStrictPerGame: number
    maxStrictPerDay: number
    maxUnderShare: number
    underShareFrom: number
    unitStake: number
  }
  volume: { topN: number; minMinutes: number; minPrice: number; maxPrice: number; linesPerStat: number; perGame: number }
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  eligibility: {
    maxProjectionAgeHours: 24, minGamesStrict: 15, minGamesResearch: 10, topNByMinutes: 6, minMinutes: 24, minutesDeclineVeto: -4,
    minIndependentBooks: 2, maxQuoteAgeMinutes: 120, extremeGap: 0.25, reviewGap: 0.15,
  },
  probability: { marketWeight: 0.7, confidenceLevel: '90', basis: 'blend' },
  market: { priceCorroboration: 1.03, staleLineRatio: 1.15, minMarketEv: -0.05, outlierMinDeviation: 0.04, outlierMadK: 3, maxBookDisagreement: 0.08, feedGroups: {} },
  matchup: { minutesTrendEdge: 2, opponentEdge: 0.04 },
  skeptic: { formMinGames: 8, formContradictionSd: 0.5 },
  sam: { minProbability: 0.6, minEvConservative: 0 },
  val: { minProbability: 0.5, minEvConservative: 0.03 },
  cat: { minGap: 0.1, maxMarketProbability: 0.5, minEvConservative: 0.02, minMatchupScore: 1 },
  lou: { minLegEv: 0.02, minLegProbability: 0.45, minLegs: 3, maxLegs: 5, minParlayEv: 0.1, maxParlaysPerDay: 3 },
  lean: { minRawEv: 0.02, minRawProbability: 0.5, maxPerPlayer: 1, maxPerDay: 8, hypotheticalStake: 0.5 },
  portfolio: { maxStrictPerPlayerStat: 1, maxStrictPerPlayer: 2, maxStrictPerGame: 4, maxStrictPerDay: 12, maxUnderShare: 0.65, underShareFrom: 6, unitStake: 1 },
  volume: { topN: 10, minMinutes: 18, minPrice: 1.5, maxPrice: 2.6, linesPerStat: 3, perGame: 40 },
}

const isProb = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1
const isPosInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Throws with every problem listed. Returns the config unchanged when it is valid. */
export function validateConfig(c: EngineConfig): EngineConfig {
  const bad: string[] = []
  const need = (ok: boolean, msg: string) => { if (!ok) bad.push(msg) }
  const e = c.eligibility, p = c.probability, m = c.market, po = c.portfolio, l = c.lean, lo = c.lou

  need(isNum(e.maxProjectionAgeHours) && e.maxProjectionAgeHours > 0 && e.maxProjectionAgeHours <= 72, 'eligibility.maxProjectionAgeHours must be in (0, 72]')
  need(isPosInt(e.minGamesStrict) && isPosInt(e.minGamesResearch) && e.minGamesResearch <= e.minGamesStrict, 'minGamesResearch must be a positive integer no larger than minGamesStrict')
  need(isPosInt(e.topNByMinutes) && e.topNByMinutes <= 15, 'eligibility.topNByMinutes must be an integer in [1, 15]')
  need(isNum(e.minMinutes) && e.minMinutes >= 0 && e.minMinutes <= 48, 'eligibility.minMinutes must be in [0, 48]')
  need(isNum(e.minutesDeclineVeto) && e.minutesDeclineVeto < 0, 'eligibility.minutesDeclineVeto must be negative')
  need(isPosInt(e.minIndependentBooks) && e.minIndependentBooks >= 2, 'eligibility.minIndependentBooks must be an integer of at least 2')
  need(isNum(e.maxQuoteAgeMinutes) && e.maxQuoteAgeMinutes > 0, 'eligibility.maxQuoteAgeMinutes must be positive')
  need(isProb(e.extremeGap) && isProb(e.reviewGap) && e.reviewGap < e.extremeGap, 'reviewGap must be a probability below extremeGap')

  need(isProb(p.marketWeight), 'probability.marketWeight must be in [0, 1]')
  need(['80', '90', '95'].includes(p.confidenceLevel), "probability.confidenceLevel must be '80', '90' or '95'")
  need(p.basis === 'blend' || p.basis === 'model', "probability.basis must be 'blend' or 'model'")

  need(isNum(m.priceCorroboration) && m.priceCorroboration >= 1 && m.priceCorroboration <= 1.1, 'market.priceCorroboration must be in [1, 1.1]')
  need(isNum(m.staleLineRatio) && m.staleLineRatio > m.priceCorroboration, 'market.staleLineRatio must exceed priceCorroboration')
  need(isNum(m.minMarketEv) && m.minMarketEv <= 0, 'market.minMarketEv must be zero or negative')
  need(isProb(m.outlierMinDeviation) && isNum(m.outlierMadK) && m.outlierMadK > 0 && isProb(m.maxBookDisagreement), 'market outlier settings out of range')

  need(isPosInt(lo.minLegs) && isPosInt(lo.maxLegs) && lo.minLegs >= 2 && lo.minLegs <= lo.maxLegs, 'lou legs must satisfy 2 <= minLegs <= maxLegs')
  need(isPosInt(lo.maxParlaysPerDay), 'lou.maxParlaysPerDay must be a positive integer')
  need(isProb(c.sam.minProbability) && isProb(c.val.minProbability) && isProb(c.cat.maxMarketProbability) && isProb(c.cat.minGap) && isProb(lo.minLegProbability) && isProb(l.minRawProbability), 'a probability threshold is outside [0, 1]')
  need(c.cat.minGap < e.extremeGap, 'cat.minGap must be below eligibility.extremeGap')

  need(isPosInt(po.maxStrictPerPlayerStat) && isPosInt(po.maxStrictPerPlayer) && isPosInt(po.maxStrictPerGame) && isPosInt(po.maxStrictPerDay), 'portfolio caps must be positive integers')
  need(po.maxStrictPerPlayerStat <= po.maxStrictPerPlayer, 'maxStrictPerPlayerStat must not exceed maxStrictPerPlayer (the stricter rule wins)')
  need(isProb(po.maxUnderShare) && po.maxUnderShare > 0 && isPosInt(po.underShareFrom), 'portfolio under-share settings out of range')
  need(isNum(po.unitStake) && po.unitStake > 0, 'portfolio.unitStake must be positive')
  need(isPosInt(l.maxPerPlayer) && isPosInt(l.maxPerDay) && isNum(l.hypotheticalStake) && l.hypotheticalStake > 0, 'lean settings out of range')
  need(isPosInt(c.volume.topN) && isPosInt(c.volume.linesPerStat) && isPosInt(c.volume.perGame) && c.volume.minPrice > 1 && c.volume.maxPrice > c.volume.minPrice, 'volume settings out of range')

  if (bad.length) throw new RangeError(`invalid engine configuration:\n - ${bad.join('\n - ')}`)
  return c
}

/** Merge overrides over the defaults, validate, and return a frozen configuration. */
export function makeConfig(overrides: DeepPartial<EngineConfig> = {}): EngineConfig {
  const merged = mergeDeep(structuredClone(DEFAULT_ENGINE_CONFIG) as unknown as Record<string, unknown>, overrides as Record<string, unknown>) as unknown as EngineConfig
  return deepFreeze(validateConfig(merged))
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K] }

function mergeDeep(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(b ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') mergeDeep(a[k] as Record<string, unknown>, v as Record<string, unknown>)
    else if (v !== undefined) a[k] = v
  }
  return a
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') { Object.values(o as Record<string, unknown>).forEach(deepFreeze); Object.freeze(o) }
  return o
}

/** A short stable fingerprint (FNV-1a, two passes) of any JSON-able value, for recording which settings made a decision. Not a security hash. */
export function stableHash(value: unknown): string {
  const text = JSON.stringify(sortKeys(value))
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]))
  return v
}
