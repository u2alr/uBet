export const STATS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'] as const
export type Stat = (typeof STATS)[number]

export type GameType = 'regular' | 'playoffs' | 'preseason'

/** One past game. Pass samples most recent first. */
export interface Sample {
  value: number
  type: GameType
}

export interface Prediction {
  model: 'baseline-v2'
  predicted: number
  stdDev: number
  pOver: number
  /** Number of games used. */
  sample: number
  /** 0-100: more games and steadier output score higher. */
  confidence: number
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

// Abramowitz-Stegun approximation of the standard normal CDF.
function normalCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

/** P(X <= k) for a Poisson distribution. */
function poissonCdf(k: number, lambda: number) {
  let term = Math.exp(-lambda)
  let sum = term
  for (let i = 1; i <= k; i++) {
    term *= lambda / i
    sum += term
  }
  return Math.min(sum, 1)
}

/**
 * P(X > line) for a negative binomial with mean mu and dispersion alpha (Var = mu + alpha * mu^2).
 * Used with the boosted model's projections (research/project.py), which are scored the same way in
 * research/evaluate.py. Verified against scipy in research/tests/test_nb.py.
 */
export function nbPOver(line: number, mu: number, alpha: number) {
  const m = Math.max(mu, 1e-3)
  const r = 1 / Math.max(alpha, 1e-6)
  const p = r / (r + m)
  const k = Math.floor(line)
  let pmf = Math.pow(p, r)
  let cdf = pmf
  for (let i = 0; i < k; i++) {
    pmf *= ((i + r) / (i + 1)) * (1 - p)
    cdf += pmf
  }
  return Math.max(0, Math.min(1, 1 - cdf))
}

/** values: most recent game first. */
export function hitRate(values: number[], line: number, n: number) {
  const recent = values.slice(0, n)
  if (!recent.length) return null
  return recent.filter((v) => v > line).length / recent.length
}

/**
 * Weighted projection and P(over line).
 * Low-count stats (steals, blocks, threes) use a Poisson tail, which fits small whole numbers far
 * better than a bell curve; bigger stats use a normal curve.
 */
export function predict(samples: Sample[], line: number, upcoming: GameType = 'regular'): Prediction | null {
  if (samples.length < 5) return null
  const { mean, sd, nEff } = weightedStats(samples, upcoming)
  const spread = Math.max(sd * (1 + 1 / Math.max(nEff, 1)), 0.5)

  const pOver =
    mean < 6
      ? 1 - poissonCdf(Math.floor(line), Math.max(mean, 0.05))
      : 1 - normalCdf((line - mean) / spread)

  const cv = mean > 0 ? spread / mean : 1
  const confidence = Math.round(100 * (0.5 * Math.min(nEff / 25, 1) + 0.5 * (1 - Math.min(cv, 1))))
  return { model: 'baseline-v2', predicted: mean, stdDev: spread, pOver, sample: samples.length, confidence }
}

/** When the model and the market disagree by more than this, assume the model is missing something. */
export const BIG_GAP = 0.25

/**
 * The book's price already contains its own opinion (injuries, role, matchup), which is usually better
 * than a simple model's. Blend the two with the market weighted higher. The model's share shrinks
 * when it has little data behind it, and again when it disagrees wildly with the market.
 */
export function blendProb(modelProb: number, marketProb: number | null, confidence = 50) {
  if (marketProb == null) return modelProb * 0.4 + 0.5 * 0.6
  let wModel = 0.4 * (0.5 + confidence / 200)
  if (Math.abs(modelProb - marketProb) > BIG_GAP) wModel *= 0.5
  return marketProb * (1 - wModel) + modelProb * wModel
}

export function riskTier(prob: number): Risk {
  if (prob >= 0.62) return 'safe'
  if (prob < 0.42) return 'risky'
  return 'balanced'
}
