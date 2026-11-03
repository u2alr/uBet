// Removing a bookmaker's margin from a two-way price. Pure: no network, no clock.
//
// Why not just divide by the sum ("proportional")? Books load more margin onto the longshot than the favourite (the favourite-longshot bias), so
// proportional removal leaves the favourite under-priced and the longshot over-priced. The power method and Shin's method correct that;
// research/devig.py holds the same maths for the Python side. For an even market all three agree.

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Decimal odds -> implied probability, or null when the price is not usable (not a finite number above 1). */
export function implied(price: number): number | null {
  return Number.isFinite(price) && price > 1 ? 1 / price : null
}

/** Divide each implied probability by their sum. */
export function proportional(prices: number[]): number[] | null {
  const q = prices.map(implied)
  if (q.some((x) => x == null)) return null
  const s = (q as number[]).reduce((a, b) => a + b, 0)
  return s > 0 ? (q as number[]).map((x) => x / s) : null
}

/** Find k so that sum(q_i ^ k) = 1 (bisection). The margin is removed as an exponent, which takes more off longshots. */
export function power(prices: number[]): number[] | null {
  const q = prices.map(implied) as (number | null)[]
  if (q.some((x) => x == null) || q.length < 2) return null
  const qs = q as number[]
  const f = (k: number) => qs.reduce((a, x) => a + x ** k, 0) - 1
  const total = qs.reduce((a, b) => a + b, 0)
  if (total <= 1) return proportional(prices)   // no margin (or negative): nothing to remove
  let lo = 1, hi = 1
  while (f(hi) > 0 && hi < 64) hi *= 2
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) lo = mid
    else hi = mid
  }
  const k = (lo + hi) / 2
  return qs.map((x) => x ** k)
}

/** Shin's method: assumes a share z of the money comes from insiders and solves for z. Two-way markets only. */
export function shin(prices: number[]): number[] | null {
  const q = prices.map(implied) as (number | null)[]
  if (q.some((x) => x == null) || q.length < 2) return null
  const qs = q as number[]
  const total = qs.reduce((a, b) => a + b, 0)
  if (total <= 1) return proportional(prices)
  const probs = (z: number) => qs.map((x) => (Math.sqrt(z * z + 4 * (1 - z) * (x * x) / total) - z) / (2 * (1 - z)))
  const g = (z: number) => probs(z).reduce((a, b) => a + b, 0) - 1
  let lo = 0, hi = 0.4
  if (g(lo) < 0 || g(hi) > 0) return power(prices)  // does not bracket: fall back rather than invent a number
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (g(mid) > 0) lo = mid
    else hi = mid
  }
  const p = probs((lo + hi) / 2)
  const s = p.reduce((a, b) => a + b, 0)
  return p.map((x) => x / s)
}

/** The no-margin chance that side A wins, from decimal prices on both sides, by the chosen method. Null when either price is unusable. */
export function fairProb(priceA: number, priceB: number, method: 'proportional' | 'power' | 'shin' = 'power'): number | null {
  const r = method === 'proportional' ? proportional([priceA, priceB]) : method === 'shin' ? shin([priceA, priceB]) : power([priceA, priceB])
  return r ? clamp(r[0], 0, 1) : null
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Combine several books' no-margin chances for one outcome. A book far from the others (a stale or erroring quote) is dropped when at least three books
 * quote, then the median of the rest is used. With two books the mean is used (a median of two is the mean anyway); with one, that one.
 * `used` and `dropped` count the books so the caller can say how corroborated the number is.
 */
export function consensusProb(probs: number[], maxDeviation = 0.06): { prob: number; used: number; dropped: number } | null {
  const xs = probs.filter((p) => Number.isFinite(p) && p > 0 && p < 1)
  if (!xs.length) return null
  if (xs.length < 3) return { prob: xs.reduce((a, b) => a + b, 0) / xs.length, used: xs.length, dropped: 0 }
  const m = median(xs)!
  const kept = xs.filter((p) => Math.abs(p - m) <= maxDeviation)
  const used = kept.length ? kept : xs
  return { prob: median(used)!, used: used.length, dropped: xs.length - used.length }
}
