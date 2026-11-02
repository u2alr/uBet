// How the suggested props have actually done, from the graded `predictions` table. Pure: rows in, numbers out.
// Every figure carries its sample size; nothing here changes a probability or a pick.
import { breakdown, calibrationBins, summarize, type Bin, type Graded, type Summary } from './metrics.ts'

export interface GradedPrediction {
  stat: string
  side: 'over' | 'under'
  /** Decimal odds taken. */
  price: number
  /** 1 won, 0 lost, 2 push (refunded). */
  hit: 0 | 1 | 2
  /** The system's stated chance that this side wins. */
  prob: number
  modelProb: number | null
  marketProb: number | null
  basis: string
}

export interface Brier { n: number; stated: number | null; model: number | null; market: number | null }

export interface TrackRecord {
  overall: Summary
  byStat: Record<string, Summary>
  byBasis: Record<string, Summary>
  byOdds: Record<string, Summary>
  calibration: Bin[]
  /** Scored on the bets that have both a model and a market chance, so the three numbers are comparable. */
  brier: Brier
}

const oddsBand = (price: number) => (price < 1.7 ? 'under 1.70' : price < 2 ? '1.70 to 1.99' : price < 2.5 ? '2.00 to 2.49' : '2.50 and up')

const toGraded = (r: GradedPrediction): Graded & GradedPrediction => ({
  ...r, odds: r.price, stake: 1, result: r.hit === 1 ? 'won' : r.hit === 0 ? 'lost' : 'push',
})

export function trackRecord(rows: GradedPrediction[]): TrackRecord {
  const gs = rows.map(toGraded)
  const both = rows.filter((r) => r.hit !== 2 && r.modelProb != null && r.marketProb != null)
  const mean = (f: (r: GradedPrediction) => number) => (both.length ? both.reduce((a, r) => a + f(r), 0) / both.length : null)
  const sq = (p: number, r: GradedPrediction) => (p - (r.hit === 1 ? 1 : 0)) ** 2
  return {
    overall: summarize(gs),
    byStat: breakdown(gs, (g) => g.stat),
    byBasis: breakdown(gs, (g) => g.basis),
    byOdds: breakdown(gs, (g) => oddsBand(g.price)),
    calibration: calibrationBins(gs),
    brier: { n: both.length, stated: mean((r) => sq(r.prob, r)), model: mean((r) => sq(r.modelProb!, r)), market: mean((r) => sq(r.marketProb!, r)) },
  }
}
