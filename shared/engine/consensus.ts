// Deterministic sportsbook consensus: margin removal, independent feeds, outliers, freshness and the executable price. Pure.
//
// Why each rule exists
//  - A quote with no usable timestamp, or one older than the limit, is never counted: the database holding a price is not
//    evidence that the price is still on offer.
//  - Books that republish one feed are one voice, not several (configurable groups; unlisted books are their own feed).
//  - The consensus is a median over feeds after dropping outliers, not a mean, so one bad quote cannot move it.
//  - The price we may count is the best fresh price capped at 3% above the next-best independent one: a lone favourable quote is
//    unverified, and is rejected rather than trusted.
// Line movement is NOT computed anywhere here: no timestamped history exists. See `OddsSnapshot` for the extension point.

export interface BookQuote {
  book: string
  /** Best executable decimal price for each side of THIS line at this book (null if that side is not quoted). */
  over: number | null
  under: number | null
  /** ISO timestamp of the quote: its own if the provider gives one, otherwise the feed's. */
  overUpdated: string | null
  underUpdated: string | null
  /** Where the timestamp came from: the quote itself, or only the feed it arrived in. */
  timestampSource?: 'quote' | 'feed'
}

export interface ConsensusSettings {
  now: number
  maxQuoteAgeMinutes: number
  feedGroups: Record<string, string>
  outlierMinDeviation: number
  outlierMadK: number
  maxBookDisagreement: number
}

export interface Contributor {
  book: string
  feed: string
  fairProportional: number
  fairPower: number
  impliedWithMargin: number
  ageMinutes: number
  timestampSource: 'quote' | 'feed' | 'unknown'
}
export interface Exclusion { book: string; reason: 'MISSING_TIMESTAMP' | 'STALE_QUOTE' | 'ONE_SIDED' | 'INVALID_PRICE' | 'OUTLIER' | 'DUPLICATE_FEED' }

export interface Consensus {
  side: 'over' | 'under'
  /** The median fair probability across included independent feeds (proportional margin removal). null if there are none. */
  fair: number | null
  /** The lowest fair probability across included feeds and both margin-removal methods: a robust lower envelope, not a confidence interval. */
  fairLower: number | null
  /** The median 1/price across included feeds: what the market implies before the margin is removed. */
  impliedWithMargin: number | null
  independentFeeds: number
  /** True when at least two independent feeds agree to within `maxBookDisagreement`. */
  corroborated: boolean
  contributors: Contributor[]
  exclusions: Exclusion[]
  flags: string[]
}

export const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y)
  const n = a.length
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2
}

const validPrice = (x: number | null): x is number => typeof x === 'number' && Number.isFinite(x) && x > 1

/** Proportional margin removal: scale the two implied probabilities so they sum to 1. Returns [over, under]. */
export function devigProportional(over: number, under: number): [number, number] {
  const a = 1 / over, b = 1 / under
  return [a / (a + b), b / (a + b)]
}

/**
 * Power margin removal: find k with (1/over)^k + (1/under)^k = 1. It takes proportionally more margin from the longshot side,
 * which is where books load it. If the two prices already sum to 1 or less (no margin, or an arbitrage), it falls back to
 * the proportional split rather than invent a negative margin.
 */
export function devigPower(over: number, under: number): [number, number] {
  const a = 1 / over, b = 1 / under
  if (a + b <= 1 + 1e-12) return devigProportional(over, under)
  let lo = 1, hi = 8
  for (let i = 0; i < 80; i++) {
    const k = (lo + hi) / 2
    if (a ** k + b ** k > 1) lo = k; else hi = k
  }
  const k = (lo + hi) / 2
  return [a ** k, b ** k]
}

const ageMinutes = (iso: string | null, now: number): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? (now - t) / 60_000 : null
}

const feedOf = (book: string, groups: Record<string, string>) => groups[book] ?? groups[book.toLowerCase()] ?? book.toLowerCase()

/** The consensus fair probability that `side` wins, from the books that quote both sides, with every inclusion and exclusion recorded. */
export function buildConsensus(quotes: BookQuote[], side: 'over' | 'under', s: ConsensusSettings): Consensus {
  const exclusions: Exclusion[] = []
  const raw: Contributor[] = []
  for (const q of quotes) {
    if (q.over === null || q.under === null) { exclusions.push({ book: q.book, reason: 'ONE_SIDED' }); continue }
    if (!validPrice(q.over) || !validPrice(q.under)) { exclusions.push({ book: q.book, reason: 'INVALID_PRICE' }); continue }
    const a1 = ageMinutes(q.overUpdated, s.now), a2 = ageMinutes(q.underUpdated, s.now)
    if (a1 === null || a2 === null) { exclusions.push({ book: q.book, reason: 'MISSING_TIMESTAMP' }); continue }
    const age = Math.max(a1, a2)                    // both sides must be fresh
    if (age > s.maxQuoteAgeMinutes || age < -5) { exclusions.push({ book: q.book, reason: 'STALE_QUOTE' }); continue }   // a timestamp in the future is a bad clock, not a fresh quote
    const [po, pu] = devigProportional(q.over, q.under)
    const [wo, wu] = devigPower(q.over, q.under)
    raw.push({
      book: q.book, feed: feedOf(q.book, s.feedGroups), fairProportional: side === 'over' ? po : pu, fairPower: side === 'over' ? wo : wu,
      impliedWithMargin: 1 / (side === 'over' ? q.over : q.under), ageMinutes: age, timestampSource: q.timestampSource ?? 'unknown',
    })
  }

  // One voice per feed: books that republish a feed are merged by median.
  const byFeed = new Map<string, Contributor[]>()
  for (const c of raw) (byFeed.get(c.feed) ?? byFeed.set(c.feed, []).get(c.feed)!).push(c)
  let feeds: Contributor[] = []
  for (const [feed, list] of byFeed) {
    list.slice(1).forEach((c) => exclusions.push({ book: c.book, reason: 'DUPLICATE_FEED' }))
    feeds.push(list.length === 1 ? list[0] : {
      ...list[0], feed, book: list.map((c) => c.book).join('+'), fairProportional: median(list.map((c) => c.fairProportional)),
      fairPower: median(list.map((c) => c.fairPower)), impliedWithMargin: median(list.map((c) => c.impliedWithMargin)), ageMinutes: Math.max(...list.map((c) => c.ageMinutes)),
    })
  }

  // Outliers, only when there are enough feeds to tell which one is wrong.
  const flags: string[] = []
  if (feeds.length >= 3) {
    const m = median(feeds.map((c) => c.fairProportional))
    const mad = median(feeds.map((c) => Math.abs(c.fairProportional - m)))
    const limit = Math.max(s.outlierMinDeviation, s.outlierMadK * 1.4826 * mad)
    const kept: Contributor[] = []
    for (const c of feeds) {
      if (Math.abs(c.fairProportional - m) > limit) exclusions.push({ book: c.book, reason: 'OUTLIER' }); else kept.push(c)
    }
    feeds = kept
  }

  let corroborated = false
  if (feeds.length >= 2) {
    const ps = feeds.map((c) => c.fairProportional)
    corroborated = Math.max(...ps) - Math.min(...ps) <= s.maxBookDisagreement
    if (!corroborated) flags.push('BOOKS_DISAGREE')
  }
  if (!feeds.length) return { side, fair: null, fairLower: null, impliedWithMargin: null, independentFeeds: 0, corroborated: false, contributors: [], exclusions, flags: [...flags, 'NO_USABLE_QUOTES'] }
  return {
    side, fair: median(feeds.map((c) => c.fairProportional)), fairLower: Math.min(...feeds.flatMap((c) => [c.fairProportional, c.fairPower])),
    impliedWithMargin: median(feeds.map((c) => c.impliedWithMargin)), independentFeeds: feeds.length, corroborated, contributors: feeds, exclusions, flags,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Executable price

export interface SideQuote { book: string; price: number; updated: string | null; timestampSource?: 'quote' | 'feed'; id?: string }
export type PriceRejection = 'NO_FRESH_QUOTE' | 'UNVERIFIED_PRICE' | 'STALE_LINE_SUSPECT'

export interface ExecutablePrice {
  /** The decimal price the bet may be graded at; null when no verified price exists. */
  price: number | null
  best: number | null
  corroboratedBy: string | null
  rejection: PriceRejection | null
  /** Oldest timestamp among the quotes that justify the price (ISO), and its age in minutes. */
  asOf: string | null
  ageMinutes: number | null
  contributing: { book: string; price: number; ageMinutes: number; id?: string }[]
  exclusions: Exclusion[]
}

export function selectExecutablePrice(quotes: SideQuote[], s: ConsensusSettings & { priceCorroboration: number; staleLineRatio: number }): ExecutablePrice {
  const exclusions: Exclusion[] = []
  const fresh: { book: string; feed: string; price: number; age: number; updated: string; id?: string }[] = []
  for (const q of quotes) {
    if (!validPrice(q.price)) { exclusions.push({ book: q.book, reason: 'INVALID_PRICE' }); continue }
    const age = ageMinutes(q.updated, s.now)
    if (age === null) { exclusions.push({ book: q.book, reason: 'MISSING_TIMESTAMP' }); continue }
    if (age > s.maxQuoteAgeMinutes || age < -5) { exclusions.push({ book: q.book, reason: 'STALE_QUOTE' }); continue }
    fresh.push({ book: q.book, feed: feedOf(q.book, s.feedGroups), price: q.price, age, updated: q.updated!, id: q.id })
  }
  const bestPerFeed = new Map<string, (typeof fresh)[number]>()
  for (const f of fresh) {
    const cur = bestPerFeed.get(f.feed)
    if (!cur) bestPerFeed.set(f.feed, f)
    else { exclusions.push({ book: (f.price > cur.price ? cur : f).book, reason: 'DUPLICATE_FEED' }); if (f.price > cur.price) bestPerFeed.set(f.feed, f) }
  }
  const ranked = [...bestPerFeed.values()].sort((a, b) => b.price - a.price)
  const empty = { price: null, best: ranked[0]?.price ?? null, corroboratedBy: null, asOf: null, ageMinutes: null, contributing: [], exclusions }
  if (!ranked.length) return { ...empty, rejection: 'NO_FRESH_QUOTE' }
  if (ranked.length < 2) return { ...empty, rejection: 'UNVERIFIED_PRICE' }
  const [best, second] = ranked
  if (best.price > second.price * s.staleLineRatio) return { ...empty, rejection: 'STALE_LINE_SUSPECT' }
  const older = best.age >= second.age ? best : second
  return {
    price: Math.min(best.price, second.price * s.priceCorroboration), best: best.price, corroboratedBy: second.book, rejection: null,
    asOf: older.updated, ageMinutes: older.age,
    contributing: ranked.map((r) => ({ book: r.book, price: r.price, ageMinutes: r.age, id: r.id })), exclusions,
  }
}

/**
 * Extension point for line movement. Nothing populates this today: no timestamped history of quotes is stored, so movement
 * analysis is UNAVAILABLE. When snapshots exist, they go in `odds_snapshots` (see migration 0015) in this shape.
 */
export interface OddsSnapshot { capturedAt: string; book: string; eventId: string; playerId: number; stat: string; line: number; side: 'over' | 'under'; price: number }
export const LINE_MOVEMENT_STATUS = 'unavailable' as const
