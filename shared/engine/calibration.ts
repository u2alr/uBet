// Applies the out-of-sample calibration artifact (research/calibrate.py -> shared/calibration.json). Pure.
//
// The artifact holds, per statistic, a grid of raw P(over) values with the calibrated value and bootstrap lower/upper bounds at
// several one-sided confidence levels. Nothing here fits anything: it only looks values up. A statistic whose artifact is
// missing or failed its pre-registered gates is NOT calibrated, and callers must not treat its probability as validated.

export type CalibrationStatus = 'validated' | 'unvalidated' | 'missing'
export type Level = '80' | '90' | '95'

export interface StatCalibration {
  method: 'identity' | 'platt' | 'isotonic'
  status: 'validated' | 'unvalidated'
  failedGates: string[]
  grid: { p: number[]; cal: number[] } & Record<`lo${Level}` | `hi${Level}`, number[]>
}

export interface CalibrationArtifact {
  version: string
  hash: string
  caveat: string
  stats: Record<string, StatCalibration>
}

export interface CalibratedProbability {
  status: CalibrationStatus
  method: string
  /** The model's raw win probability for the selected side (given the bet is decided). */
  raw: number
  /** Out-of-sample calibrated probability for the selected side; null when no calibration exists. Never silently the raw value. */
  calibrated: number | null
  /** Lower bound of the calibrated probability at `confidence` one-sided confidence (bootstrap over weeks); null when unavailable. */
  lower: number | null
  upper: number | null
  confidence: Level
  artifactVersion: string | null
  artifactHash: string | null
  /** Set when the raw value fell outside the calibrated grid and was clamped to its edge. */
  clamped: boolean
  reason: 'NO_CALIBRATION_ARTIFACT' | 'STAT_NOT_CALIBRATED' | 'FAILED_VALIDATION_GATES' | null
}

const LEVELS: Level[] = ['80', '90', '95']

/** Structural check of an artifact read from disk or the network. Throws with the first problem. */
export function parseCalibration(x: unknown): CalibrationArtifact {
  const a = x as Partial<CalibrationArtifact> | null
  if (!a || typeof a !== 'object' || typeof a.version !== 'string' || typeof a.hash !== 'string' || !a.stats || typeof a.stats !== 'object') throw new TypeError('calibration artifact: missing version, hash or stats')
  for (const [stat, s] of Object.entries(a.stats)) {
    const g = s?.grid
    if (!g || !Array.isArray(g.p) || g.p.length < 2) throw new TypeError(`calibration artifact: ${stat} has no grid`)
    const n = g.p.length
    for (let i = 1; i < n; i++) if (!(g.p[i] > g.p[i - 1])) throw new TypeError(`calibration artifact: ${stat} grid is not increasing`)
    for (const key of ['cal', ...LEVELS.flatMap((l) => [`lo${l}`, `hi${l}`])] as const) {
      const col = (g as unknown as Record<string, number[]>)[key]
      if (!Array.isArray(col) || col.length !== n || col.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new TypeError(`calibration artifact: ${stat}.${key} is malformed`)
    }
    for (const l of LEVELS) for (let i = 0; i < n; i++)
      if (g[`lo${l}`][i] > g.cal[i] + 1e-9 || g[`hi${l}`][i] < g.cal[i] - 1e-9) throw new TypeError(`calibration artifact: ${stat} bounds at ${l}% do not bracket the calibrated value`)
    if (s.status !== 'validated' && s.status !== 'unvalidated') throw new TypeError(`calibration artifact: ${stat} has no status`)
  }
  return a as CalibrationArtifact
}

function interp(xs: number[], ys: number[], x: number): { y: number; clamped: boolean } {
  if (x <= xs[0]) return { y: ys[0], clamped: x < xs[0] }
  const n = xs.length
  if (x >= xs[n - 1]) return { y: ys[n - 1], clamped: x > xs[n - 1] }
  let lo = 0, hi = n - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo])
  return { y: ys[lo] + t * (ys[hi] - ys[lo]), clamped: false }
}

/**
 * Calibrated probability for the selected side. The artifact is built on P(over); the Under side is its mirror
 * (calibrated = 1 - f(1 - raw); the lower bound of the Under is one minus the upper bound of the Over).
 */
export function calibrateSide(
  artifact: CalibrationArtifact | null, stat: string, side: 'over' | 'under', rawWin: number, confidence: Level = '90',
): CalibratedProbability {
  const base = { raw: rawWin, confidence, artifactVersion: artifact?.version ?? null, artifactHash: artifact?.hash ?? null, clamped: false }
  if (!artifact) return { ...base, status: 'missing', method: 'none', calibrated: null, lower: null, upper: null, reason: 'NO_CALIBRATION_ARTIFACT' }
  const s = artifact.stats[stat]
  if (!s) return { ...base, status: 'missing', method: 'none', calibrated: null, lower: null, upper: null, reason: 'STAT_NOT_CALIBRATED' }
  if (!Number.isFinite(rawWin) || rawWin < 0 || rawWin > 1) throw new RangeError(`raw probability out of range: ${rawWin}`)
  const pOver = side === 'over' ? rawWin : 1 - rawWin
  const g = s.grid
  const cal = interp(g.p, g.cal, pOver)
  const lo = interp(g.p, g[`lo${confidence}`], pOver).y
  const hi = interp(g.p, g[`hi${confidence}`], pOver).y
  const out = side === 'over'
    ? { calibrated: cal.y, lower: Math.min(lo, cal.y), upper: Math.max(hi, cal.y) }
    : { calibrated: 1 - cal.y, lower: 1 - Math.max(hi, cal.y), upper: 1 - Math.min(lo, cal.y) }
  return {
    ...base, clamped: cal.clamped, method: s.method, status: s.status, ...out,
    reason: s.status === 'validated' ? null : 'FAILED_VALIDATION_GATES',
  }
}
