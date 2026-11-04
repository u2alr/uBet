// Team bets: for one game (with no price, just the model's own chance), the best price on each side of the moneyline, the market's no-margin chance, our chance (the game model blended with the market the same way
// props are), and our own fair prices (moneyline and spread) next to the market's. It does not recommend bets. Pure: no network, no database, no clock.
//
// Honesty about what is tested: the game model (shared/games.status.json) is calibrated on past games but has NOT been tested against sportsbook prices, and it cannot see
// injuries or lineups. So the chance used here is a blend that leans on the market.
// Spreads and totals are shown as market lines only (we have no validated model of margin or scoring); our fair spread is a conversion of our win chance, not a separate model.
import { blendProb, MODEL_WEIGHT } from './baseline.ts'
import { consensusProb, fairProb, median } from './devig.ts'

/** A best price this far above the runner-up looks stale or mistyped, so the runner-up is used instead (same rule as the props engine). */
export const STALE_PRICE_RATIO = 1.15

export interface BookLine {
  key: string
  title: string
  moneyline?: { home: number; away: number }
  /** `point` is the home team's line (negative when the home team is favoured). */
  spread?: { point: number; home: number; away: number }
  total?: { point: number; over: number; under: number }
}

export interface TeamBetInput {
  home: string
  away: string
  books: BookLine[]
  /** The game model's home win chance, or null when there is no snapshot for this game. */
  modelHomeProb: number | null
  /** The model's expected home margin in points (home court included), or null. Used for our spread when present. */
  modelMargin?: number | null
}

export interface MoneylineBet {
  side: 'home' | 'away'
  team: string
  /** Best decimal price across the books, and the book offering it (a price far above every other book's is replaced by the runner-up's). */
  price: number
  book: string
  /** True when the best price was capped because it looked stale. */
  priceCapped: boolean
  marketProb: number
  /** Our chance: the model blended with the market. Equal to the market's when there is no model. */
  prob: number
  modelProb: number | null
}

export interface TeamBet {
  home: string
  away: string
  market: { spread: number | null; total: number | null; spreadBook: string | null; homeProb: number | null; books: number; booksUsed: number; booksDropped: number; /** True when at least two books priced the moneyline, so the chance and the price are cross-checked. */ corroborated: boolean }
  moneyline: { home: MoneylineBet; away: MoneylineBet } | null
  ours: { fairMoneyline: { home: number; away: number }; spread: number | null; homeProb: number } | null
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, error below 1.2e-9). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  const q = p - 0.5, r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** Typical standard deviation of an NBA final margin, used only to turn a win chance into a spread when the market gives nothing better. */
const DEFAULT_MARGIN_SD = 12
const halfPoint = (x: number) => Math.round(x * 2) / 2
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d

/**
 * The home team's line that matches a home win chance. The spread of the margin comes from the market itself (its own spread and win chance imply one), so our
 * spread sits on the same scale as the line it is compared with; with no usable market it falls back to a typical NBA spread of 12 points.
 */
export function fairSpread(homeProb: number, marketSpread: number | null, marketHomeProb: number | null): number | null {
  if (!(homeProb > 0 && homeProb < 1)) return null
  let sd = DEFAULT_MARGIN_SD
  if (marketSpread != null && marketHomeProb != null && marketHomeProb > 0 && marketHomeProb < 1) {
    const z = normInv(marketHomeProb)
    if (Math.abs(z) > 0.15) sd = Math.min(15, Math.max(9, Math.abs(marketSpread / z)))
  }
  return halfPoint(-sd * normInv(homeProb))
}

export function teamBet(i: TeamBetInput): TeamBet {
  const withMl = i.books.filter((b) => b.moneyline)
  // Each book's margin is removed on its own with the power method (proportional removal under-prices favourites), then the books are combined by their median,
  // dropping one that sits far from the rest: one stale or mistyped book must not move the market's chance.
  const probs = withMl.map((b) => fairProb(b.moneyline!.home, b.moneyline!.away, 'power')).filter((p): p is number => p != null)
  const cons = consensusProb(probs)
  const marketHome = cons ? cons.prob : null
  const spreadBooks = i.books.filter((b) => b.spread)
  // The median of two books can land between lines (-2.5 and -2 average to -2.25); lines come in half points, so the result is put back on one.
  const onLine = (x: number | null) => (x == null ? null : halfPoint(x))
  const spread = onLine(median(spreadBooks.map((b) => b.spread!.point)))
  const total = onLine(median(i.books.filter((b) => b.total).map((b) => b.total!.point)))
  const market = { spread, total, spreadBook: spreadBooks[0]?.title ?? null, homeProb: marketHome == null ? null : round(marketHome), books: i.books.length, booksUsed: cons?.used ?? 0, booksDropped: cons?.dropped ?? 0, corroborated: (cons?.used ?? 0) >= 2 }
  if (marketHome == null) {
    // No book has priced the game. A model number still stands on its own (it is calibrated on past games), but there is no price to show.
    if (i.modelHomeProb == null) return { home: i.home, away: i.away, market, moneyline: null, ours: null }
    const p = i.modelHomeProb
    return {
      home: i.home, away: i.away, market, moneyline: null,
      ours: { fairMoneyline: { home: round(1 / p, 2), away: round(1 / (1 - p), 2) }, spread: i.modelMargin != null ? halfPoint(-i.modelMargin) : fairSpread(p, null, null), homeProb: round(p) },
    }
  }

  const homeProb = i.modelHomeProb == null ? marketHome : blendProb(i.modelHomeProb, marketHome, MODEL_WEIGHT)
  const best = (side: 'home' | 'away') => {
    const quotes = withMl.map((b) => ({ price: b.moneyline![side], book: b.title })).filter((q) => Number.isFinite(q.price) && q.price > 1).sort((a, b) => b.price - a.price)
    if (!quotes.length) return { price: 0, book: '', capped: false }
    if (quotes.length >= 2 && quotes[0].price > quotes[1].price * STALE_PRICE_RATIO) return { ...quotes[1], capped: true }
    return { ...quotes[0], capped: false }
  }
  const mk = (side: 'home' | 'away'): MoneylineBet => {
    const p = side === 'home' ? homeProb : 1 - homeProb
    const mp = side === 'home' ? marketHome : 1 - marketHome
    const b = best(side)
    return {
      side, team: side === 'home' ? i.home : i.away, price: b.price, book: b.book, priceCapped: b.capped, marketProb: round(mp), prob: round(p),
      modelProb: i.modelHomeProb == null ? null : round(side === 'home' ? i.modelHomeProb : 1 - i.modelHomeProb),
    }
  }
  const home = mk('home'), away = mk('away')
  return {
    home: i.home, away: i.away, market, moneyline: { home, away },
    ours: { fairMoneyline: { home: round(1 / homeProb, 2), away: round(1 / (1 - homeProb), 2) }, spread: i.modelMargin != null ? halfPoint(-i.modelMargin) : fairSpread(homeProb, spread, marketHome), homeProb: round(homeProb) },
  }
}

/** A game-model snapshot older than this is not trusted: the injury list and form it read have moved on. The market alone is used instead. */
export const MAX_MODEL_AGE_HOURS = 36

/** Hours between a snapshot's `as_of` stamp and `nowMs`, or null when the stamp is missing or unreadable (treated as stale by the caller). */
export function modelAgeHours(asOf: string | null | undefined, nowMs: number): number | null {
  if (!asOf) return null
  const t = Date.parse(asOf.includes('T') || asOf.endsWith('Z') ? asOf : asOf.replace(' ', 'T') + 'Z')
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / 3_600_000) : null
}

export function modelIsFresh(asOf: string | null | undefined, nowMs: number, maxHours = MAX_MODEL_AGE_HOURS): boolean {
  const age = modelAgeHours(asOf, nowMs)
  return age != null && age <= maxHours
}
