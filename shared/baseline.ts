import dispersionTable from './dispersion.json' with { type: 'json' }

export const STATS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'] as const
export type Stat = (typeof STATS)[number]

export type GameType = 'regular' | 'playoffs' | 'preseason'

/** One past game. Pass samples most recent first. */
export interface Sample {
  value: number
  type: GameType
}

export interface Prediction {
  model: 'baseline-v2' | 'baseline-v3'
  predicted: number
  stdDev: number
  /** P(stat > line), strictly greater. */
  pOver: number
  /** P(stat < line). Equals 1 - pOver only on half-point lines; on a whole-number line a tie is a push. */
  pUnder: number
  /** P(stat == line): refunded by sportsbooks. Always 0 on half-point lines. */
  pPush: number
  /** Number of games used. */
  sample: number
  /**
   * Kish effective sample size of the recency-weighted games: how many equally weighted games the estimate is worth.
   * Describes the data behind the estimate. It is NOT a probability and says nothing about forecast quality
   * (research/confidence_check.py found the old 0-100 'confidence' score carried no validated information).
   */
  effectiveGames: number
}

export type Risk = 'safe' | 'balanced' | 'risky'

// How much each kind of game counts. Preseason minutes and rotations are unreliable, so it barely
// counts; playoff games count fully only when the game being predicted is itself a playoff game.
function typeWeight(type: GameType, upcoming: GameType) {
  if (type === 'regular') return upcoming === 'playoffs' ? 0.7 : 1
  if (type === 'playoffs') return upcoming === 'playoffs' ? 1.2 : 0.6
  return 0.3
}

const RECENCY = 0.93 // each game back counts 7% less

function weightedStats(samples: Sample[], upcoming: GameType) {
  let sw = 0, sm = 0
  const w = samples.map((s, i) => {
    const x = typeWeight(s.type, upcoming) * RECENCY ** i
    sw += x
    sm += x * s.value
    return x
  })
  const mean = sm / sw
  const variance = samples.reduce((a, s, i) => a + w[i] * (s.value - mean) ** 2, 0) / sw
  // Effective sample size (Kish), used to inflate the spread when the evidence is thin.
  const sw2 = w.reduce((a, x) => a + x * x, 0)
  return { mean, sd: Math.sqrt(variance), nEff: (sw * sw) / sw2 }
}

// Abramowitz-Stegun approximation of the standard normal CDF (absolute error < 1e-7).
function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

// ---------- outcome probabilities for a count ----------

/** Inputs outside these ranges are data errors, not statistics; callers get null instead of a number. */
export const LIMITS = { maxLine: 300, maxMean: 500, maxAlpha: 1000, maxSd: 500 }

export type Dist =
  | { kind: 'poisson'; mu: number }
  | { kind: 'nb'; mu: number; alpha: number } // Var = mu + alpha * mu^2
  | { kind: 'normal'; mu: number; sd: number } // a continuous curve used for counts, with a continuity correction

export interface Outcome {
  /** P(X > line) */
  over: number
  /** P(X < line) */
  under: number
  /** P(X = line): 0 on half-point lines */
  push: number
}

/** Sum of exp(logp_i) for i = 0..k where logp_{i+1} = logp_i + step(i). Stops once the tail cannot matter. */
function cdfByRecursion(k: number, logp0: number, step: (i: number) => number, stop: number) {
  let logp = logp0
  let sum = Math.exp(logp)
  const last = Math.min(k, stop)
  for (let i = 0; i < last; i++) {
    logp += step(i)
    sum += Math.exp(logp)
  }
  return Math.min(sum, 1)
}

/** P(X <= j) for integer j; 0 for j < 0. Loops at most mean + 14 sd + 60 times, whatever j is. */
function cdfAt(d: Dist, j: number): number {
  if (j < 0) return 0
  if (d.kind === 'normal') return normalCdf((j + 0.5 - d.mu) / d.sd)
  if (d.mu === 0) return 1
  const sd = d.kind === 'poisson' ? Math.sqrt(d.mu) : Math.sqrt(d.mu + d.alpha * d.mu * d.mu)
  const stop = Math.ceil(d.mu + 14 * sd + 60)
  if (d.kind === 'poisson' || d.alpha < 1e-9) {
    return cdfByRecursion(j, -d.mu, (i) => Math.log(d.mu) - Math.log(i + 1), stop)
  }
  const r = 1 / d.alpha
  const logq = Math.log(d.mu / (r + d.mu))
  return cdfByRecursion(j, r * Math.log(r / (r + d.mu)), (i) => Math.log((i + r) / (i + 1)) + logq, stop)
}

function validDist(d: Dist) {
  if (!Number.isFinite(d.mu) || d.mu < 0 || d.mu > LIMITS.maxMean) return false
  if (d.kind === 'nb') return Number.isFinite(d.alpha) && d.alpha >= 0 && d.alpha <= LIMITS.maxAlpha
  if (d.kind === 'normal') return Number.isFinite(d.sd) && d.sd > 0 && d.sd <= LIMITS.maxSd
  return true
}

/**
 * Over / under / push probabilities for a count against a betting line.
 * Half-point line (24.5): push is 0 and under = 1 - over.
 * Whole-number line (24): a tie is refunded, so P(under) = P(X <= 23) and P(push) = P(X = 24).
 * Returns null for invalid input (non-finite or out-of-range line, mean, dispersion or spread).
 */
export function outcomeProbs(line: number, d: Dist): Outcome | null {
  if (!Number.isFinite(line) || line < 0 || line > LIMITS.maxLine || !validDist(d)) return null
  const whole = Number.isInteger(line)
  const k = Math.floor(line)
  const over = Math.min(Math.max(1 - cdfAt(d, k), 0), 1)
  const under = Math.min(Math.max(whole ? cdfAt(d, k - 1) : 1 - over, 0), 1)
  const push = whole ? Math.max(0, 1 - over - under) : 0
  return { over, under, push }
}

/**
 * P(X > line) for a negative binomial with mean mu and dispersion alpha (Var = mu + alpha * mu^2).
 * Used with the boosted model's projections (research/project.py), scored the same way in research/evaluate.py.
 * NaN for invalid input. Checked against scipy in shared/baseline.test.ts and research/tests/test_nb.py.
 */
export function nbPOver(line: number, mu: number, alpha: number) {
  return outcomeProbs(line, { kind: 'nb', mu, alpha })?.over ?? NaN
}

/**
 * Share of the last n games that beat the line on the chosen side. A tie is a refund, so it counts as
 * neither a win nor a loss. null when no game was decided. values: most recent game first.
 */
export function hitRate(values: number[], line: number, n: number, side: 'over' | 'under' = 'over') {
  let wins = 0
  let decided = 0
  for (const v of values.slice(0, n)) {
    if (v === line) continue
    decided++
    if (side === 'over' ? v > line : v < line) wins++
  }
  return decided ? wins / decided : null
}

/**
 * Weighted projection and over/under/push probabilities.
 * Low-count stats (mean < 6) use a Poisson tail; bigger stats use a normal curve with a continuity correction.
 * (research/PREREG_AUDIT.md tests whether this rule is appropriate; see AUDIT.md for the finding.)
 * Returns null with fewer than 5 games, invalid history, or an invalid line.
 */
export function predict(samples: Sample[], line: number, upcoming: GameType = 'regular'): Prediction | null {
  if (samples.length < 5 || samples.some((s) => !Number.isFinite(s.value) || s.value < 0)) return null
  const { mean, sd, nEff } = weightedStats(samples, upcoming)
  const spread = Math.max(sd * (1 + 1 / Math.max(nEff, 1)), 0.5)

  const dist: Dist = mean < 6 ? { kind: 'poisson', mu: Math.max(mean, 0.05) } : { kind: 'normal', mu: mean, sd: spread }
  const out = outcomeProbs(line, dist)
  if (!out) return null

  return {
    model: 'baseline-v2', predicted: mean, stdDev: spread,
    pOver: out.over, pUnder: out.under, pPush: out.push, sample: samples.length, effectiveGames: nEff,
  }
}

// ---------- baseline-v3: negative-binomial tails, chosen per statistic by out-of-sample testing ----------
// research/PREREG_AUDIT.md fixed the rule and research/dist_study.py applied it on the development folds. Not the default:
// shared/picks.ts and the Worker use it only when asked (FALLBACK_MODEL=v3) until it is confirmed on forward data.

type DistKind = 'native' | 'nb' | 'nbc'
type Bucket = 'lt2' | 'mid' | 'hi'
const POLICY = dispersionTable.policy as Record<Stat, Record<Bucket, DistKind>>
const DISPERSION = dispersionTable.dispersion as Record<Stat, { centers: number[]; alphas: number[]; constant: number }>

/** Dispersion for a given mean: linear interpolation between fitted points, held flat beyond the ends (like numpy.interp). */
export function alphaAt(stat: Stat, mu: number) {
  const { centers, alphas } = DISPERSION[stat]
  if (mu <= centers[0]) return alphas[0]
  const last = centers.length - 1
  if (mu >= centers[last]) return alphas[last]
  let i = 1
  while (centers[i] < mu) i++
  const t = (mu - centers[i - 1]) / (centers[i] - centers[i - 1])
  return alphas[i - 1] + t * (alphas[i] - alphas[i - 1])
}

/** Which distribution the v3 rule uses for this statistic and mean. */
export function distributionFor(stat: Stat, mean: number, spread: number): Dist {
  const bucket: Bucket = mean < 2 ? 'lt2' : mean < 6 ? 'mid' : 'hi'
  const kind = POLICY[stat][bucket]
  if (kind === 'nb') return { kind: 'nb', mu: Math.max(mean, 1e-3), alpha: alphaAt(stat, mean) }
  if (kind === 'nbc') return { kind: 'nb', mu: Math.max(mean, 1e-3), alpha: DISPERSION[stat].constant }
  return mean < 6 ? { kind: 'poisson', mu: Math.max(mean, 0.05) } : { kind: 'normal', mu: mean, sd: spread }
}

/** Same projection as predict(), with the over/under/push probabilities taken from distributionFor(). */
export function predictV3(stat: Stat, samples: Sample[], line: number, upcoming: GameType = 'regular'): Prediction | null {
  if (samples.length < 5 || samples.some((s) => !Number.isFinite(s.value) || s.value < 0)) return null
  const { mean, sd, nEff } = weightedStats(samples, upcoming)
  const spread = Math.max(sd * (1 + 1 / Math.max(nEff, 1)), 0.5)
  const out = outcomeProbs(line, distributionFor(stat, mean, spread))
  if (!out) return null
  return {
    model: 'baseline-v3', predicted: mean, stdDev: spread,
    pOver: out.over, pUnder: out.under, pPush: out.push, sample: samples.length, effectiveGames: nEff,
  }
}

/** When the model and the market disagree by more than this, assume the model is missing something. */
export const BIG_GAP = 0.25

/**
 * Share of the blend given to the model. A PLACEHOLDER, not a fitted value: it replaces a weight that varied from
 * 0.2 to 0.4 with an unvalidated confidence score (about 0.32 on average). Fit it from historical closing lines
 * (research/market_eval.py, research/PREREG_MARKET.md) when that data exists.
 */
export const MODEL_WEIGHT = 0.3

/**
 * The book's price already contains its own opinion (injuries, role, matchup), which is usually better
 * than a simple model's, so the market gets the larger share. When the model and market disagree by more than
 * BIG_GAP the model is trusted half as much, since a gap that large usually means news the model cannot see.
 * Both probabilities are the chance of winning given the bet is not refunded.
 */
export function blendProb(modelProb: number, marketProb: number | null, modelWeight = MODEL_WEIGHT) {
  const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)
  const model = clamp01(modelProb)
  const w0 = clamp01(modelWeight)
  // With no two-sided market to compare against, lean slightly more on the model but keep a pull toward 50%.
  if (marketProb == null) return clamp01(model * Math.min(w0 + 0.1, 1) + 0.5 * (1 - Math.min(w0 + 0.1, 1)))
  const w = Math.abs(model - marketProb) > BIG_GAP ? w0 / 2 : w0
  return clamp01(clamp01(marketProb) * (1 - w) + model * w)
}

/**
 * Expected profit per 1 staked at decimal odds `price`. `winProb` is the chance of winning GIVEN the bet is
 * not refunded; `push` is the chance of a refund (a tie on a whole-number line).
 *   EV = (1 - push) * (winProb * price - 1)
 */
export function expectedValue(winProb: number, push: number, price: number) {
  return (1 - push) * (winProb * price - 1)
}

export function riskTier(prob: number): Risk {
  if (prob >= 0.62) return 'safe'
  if (prob < 0.42) return 'risky'
  return 'balanced'
}
