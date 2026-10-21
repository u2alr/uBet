// Evaluation metrics for graded bets. Pure functions; every interval is reported with its sample size.
export interface Graded {
  odds: number
  /** Probability the system stated for the win (decision probability). */
  prob: number
  result: 'won' | 'lost' | 'push' | 'void'
  stake: number
  /** Closing decimal odds for the same selection, when captured. Null otherwise: CLV is then not computed. */
  closingOdds?: number | null
}

export interface Summary {
  n: number; settled: number; wins: number; losses: number; pushes: number
  units: number; staked: number; yield: number | null
  hitRate: number | null; hitRateCI: [number, number] | null
  yieldCI: [number, number] | null
  brier: number | null; logLoss: number | null
  clv: number | null; clvN: number
}

const profit = (g: Graded) => (g.result === 'won' ? g.stake * (g.odds - 1) : g.result === 'lost' ? -g.stake : 0)

/** Wilson score interval for a proportion (z = 1.96 for 95%). */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null
  const p = k / n, d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

/** Deterministic xorshift so a report is reproducible. */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 } }

/** Percentile bootstrap of the yield (profit / staked) over bets. */
export function bootstrapYield(gs: Graded[], resamples = 1000, seed = 7): [number, number] | null {
  const s = gs.filter((g) => g.result === 'won' || g.result === 'lost' || g.result === 'push')
  if (s.length < 2) return null
  const r = rng(seed), ys: number[] = []
  for (let b = 0; b < resamples; b++) {
    let pr = 0, st = 0
    for (let i = 0; i < s.length; i++) { const g = s[Math.floor(r() * s.length)]; pr += profit(g); st += g.stake }
    ys.push(st ? pr / st : 0)
  }
  ys.sort((a, b) => a - b)
  return [ys[Math.floor(0.025 * resamples)], ys[Math.min(resamples - 1, Math.floor(0.975 * resamples))]]
}

export function summarize(gs: Graded[]): Summary {
  const settled = gs.filter((g) => g.result !== 'void')
  const decided = settled.filter((g) => g.result === 'won' || g.result === 'lost')
  const wins = decided.filter((g) => g.result === 'won').length
  const staked = settled.reduce((a, g) => a + g.stake, 0)
  const units = settled.reduce((a, g) => a + profit(g), 0)
  const eps = 1e-12
  const brier = decided.length ? decided.reduce((a, g) => a + (g.prob - (g.result === 'won' ? 1 : 0)) ** 2, 0) / decided.length : null
  const logLoss = decided.length ? decided.reduce((a, g) => { const p = Math.min(1 - eps, Math.max(eps, g.prob)); return a - Math.log(g.result === 'won' ? p : 1 - p) }, 0) / decided.length : null
  const withClose = settled.filter((g) => g.closingOdds != null && g.closingOdds > 1)
  const clv = withClose.length ? withClose.reduce((a, g) => a + (g.odds / g.closingOdds! - 1), 0) / withClose.length : null
  return {
    n: gs.length, settled: settled.length, wins, losses: decided.length - wins, pushes: settled.filter((g) => g.result === 'push').length,
    units, staked, yield: staked ? units / staked : null,
    hitRate: decided.length ? wins / decided.length : null, hitRateCI: wilson(wins, decided.length),
    yieldCI: bootstrapYield(settled), brier, logLoss, clv, clvN: withClose.length,
  }
}

export interface Bin { lo: number; hi: number; n: number; meanStated: number | null; observed: number | null }
/** Calibration table: stated win chance against the realised rate, in bins. */
export function calibrationBins(gs: Graded[], edges = [0, 0.4, 0.5, 0.6, 0.7, 1.0001]): Bin[] {
  const d = gs.filter((g) => g.result === 'won' || g.result === 'lost')
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1], xs = d.filter((g) => g.prob >= lo && g.prob < hi)
    return { lo, hi, n: xs.length, meanStated: xs.length ? xs.reduce((a, g) => a + g.prob, 0) / xs.length : null, observed: xs.length ? xs.filter((g) => g.result === 'won').length / xs.length : null }
  })
}

export function breakdown<T extends Graded>(gs: T[], key: (g: T) => string): Record<string, Summary> {
  const groups = new Map<string, T[]>()
  for (const g of gs) { const k = key(g); (groups.get(k) ?? groups.set(k, []).get(k)!).push(g) }
  return Object.fromEntries([...groups].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, summarize(v)]))
}

/** Splits into the part before `cutoff` (where rules were developed) and the untouched part from `cutoff` on. */
export function holdoutSplit<T extends { day: string }>(gs: T[], cutoff: string): { development: T[]; holdout: T[] } {
  return { development: gs.filter((g) => g.day < cutoff), holdout: gs.filter((g) => g.day >= cutoff) }
}

/** Bonferroni-adjusted level for `m` comparisons at `alpha`. */
export const adjustedAlpha = (alpha: number, m: number) => (m > 0 ? alpha / m : alpha)
export const MULTIPLE_TESTING_NOTE = 'Subgroup tables are exploratory. With many slices, some will look good by chance; only the pre-registered strict tier on the forward holdout is a test.'
