// Our own prop lines: a line and fair prices for any player we project, with no sportsbook and no provider involved.
// A line is priced from the projection's negative-binomial distribution (shared/baseline.ts), so every figure comes from our own data.
// These are FAIR prices (no margin): what the model thinks a bet is worth, never an offer anyone will take. Pure: no network, no database, no clock.
import { outcomeProbs } from './baseline.ts'

export interface Projection { stat: string; mean: number; alpha: number }

export interface PricedLine {
  line: number
  /** Chance of Over, Under and a refund (whole-number lines only). */
  over: number
  under: number
  push: number
  /** Fair decimal odds, 1 / probability (a refund counts as neither side winning). Null when the side cannot win. */
  fairOver: number | null
  fairUnder: number | null
}

export interface OwnLine {
  stat: string
  mean: number
  /** The half-point line closest to a coin flip: where our model would open the market. */
  line: number
  over: number
  under: number
  fairOver: number | null
  fairUnder: number | null
  /** The same market two half-points either side, for alternate lines. */
  ladder: PricedLine[]
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d
const fair = (p: number) => (p > 0.001 ? round(1 / p, 2) : null)

/** Over/under/push and fair odds for one line, or null when the projection is not usable. */
export function priceLine(p: Projection, line: number): PricedLine | null {
  const o = outcomeProbs(line, { kind: 'nb', mu: p.mean, alpha: p.alpha })
  if (!o) return null
  const decided = 1 - o.push
  return {
    line, over: round(o.over), under: round(o.under), push: round(o.push),
    fairOver: decided > 0 ? fair(o.over) : null, fairUnder: decided > 0 ? fair(o.under) : null,
  }
}

/** The line a market would open at: the half-point whose Over is closest to 50%. */
export function openingLine(p: Projection): number | null {
  const start = Math.max(0.5, Math.floor(p.mean) - 4 + 0.5)
  let best: { line: number; gap: number } | null = null
  for (let i = 0; i < 20; i++) {
    const line = start + i
    const o = outcomeProbs(line, { kind: 'nb', mu: p.mean, alpha: p.alpha })
    if (!o) return null
    const gap = Math.abs(o.over - 0.5)
    if (!best || gap < best.gap) best = { line, gap }
  }
  return best ? best.line : null
}

export function ownLine(p: Projection): OwnLine | null {
  if (!(p.mean > 0) || !Number.isFinite(p.alpha) || p.alpha < 0) return null
  const line = openingLine(p)
  if (line === null) return null
  const ladder = [-2, -1, 0, 1, 2].map((d) => line + d).filter((l) => l > 0).map((l) => priceLine(p, l)).filter((x): x is PricedLine => x !== null)
  const mid = ladder.find((x) => x.line === line)
  if (!mid) return null
  return { stat: p.stat, mean: round(p.mean, 2), line, over: mid.over, under: mid.under, fairOver: mid.fairOver, fairUnder: mid.fairUnder, ladder }
}
