// Point-in-time odds archive: what to store from one provider response, and how to read it back honestly. Pure: no network, no database, no clock.
//
// Why it is built this way
//  - Store changes, not every poll: a price that did not move is not written again. The run row proves the market was looked at.
//  - Every row keeps WHEN we saw it, where its timestamp came from, and whether it was fresh when seen. A price in the database is not evidence
//    that the price was on offer at some other moment.
//  - "Opening" and "closing" are labels that must be earned. We only know the first price we observed and the last price we observed before a cutoff.
import type { OddsEvent } from './picks.ts'
import { MARKET_STAT } from './picks.ts'

export type ArchiveSource = 'theoddsapi' | 'oddsblaze'
export type RunKind = 'board' | 'daily' | 'pre_event'
export type Freshness = 'fresh' | 'stale' | 'unknown'

export interface ObservedQuote {
  eventId: string; eventStart: string | null; playerName: string; stat: string; line: number; side: 'over' | 'under'
  book: string; source: ArchiveSource; price: number
  updated: string | null; timestampSource: 'quote' | 'feed' | 'unknown'; main: boolean | null
}

export interface ArchiveRow extends ObservedQuote {
  capturedAt: string
  marketStatus: 'open' | 'unavailable'
  /** Null when the market is unavailable. */
  priceOrNull: number | null
  freshness: Freshness
}

export interface Prior { price: number | null; marketStatus: 'open' | 'unavailable'; main: boolean | null }
export const marketKey = (q: { eventId: string; playerName: string; stat: string; line: number; side: string; book: string; source: string }) =>
  `${q.eventId}|${q.playerName}|${q.stat}|${q.line}|${q.side}|${q.book}|${q.source}`

/** Quotes older than this when we captured them are marked stale (kept, never silently trusted). */
export const STALE_MINUTES = 120

/** Every valid Over/Under player-prop price in one provider event, flattened. Invalid prices and unknown markets are skipped and counted. */
export function flatten(ev: OddsEvent, source: ArchiveSource): { quotes: ObservedQuote[]; skipped: number } {
  const quotes: ObservedQuote[] = []
  let skipped = 0
  for (const b of ev.bookmakers ?? [])
    for (const m of b.markets) {
      const stat = MARKET_STAT[m.key]
      if (!stat) continue
      for (const o of m.outcomes) {
        const side = o.name === 'Over' ? 'over' : o.name === 'Under' ? 'under' : null
        if (!side || typeof o.description !== 'string' || !o.description || !Number.isFinite(o.price) || o.price <= 1 || !Number.isFinite(o.point)) { skipped++; continue }
        quotes.push({
          eventId: ev.id, eventStart: ev.commence_time ?? null, playerName: o.description, stat, line: o.point!, side, book: b.title, source,
          price: o.price, updated: o.updated ?? null, timestampSource: o.updatedSource ?? (o.updated ? 'feed' : 'unknown'), main: o.main ?? null,
        })
      }
    }
  return { quotes, skipped }
}

export function freshnessOf(updated: string | null, capturedAt: string, maxMinutes = STALE_MINUTES): Freshness {
  if (!updated) return 'unknown'
  const age = (Date.parse(capturedAt) - Date.parse(updated)) / 60_000
  if (!Number.isFinite(age)) return 'unknown'
  return age > maxMinutes ? 'stale' : 'fresh'      // a timestamp slightly in the future is clock skew, not staleness
}

export interface Plan { rows: ArchiveRow[]; seen: number; written: number; stale: number; disagreements: number; skipped: number; unavailable: number }

/**
 * Decide what to write for one complete provider response.
 *  - `prior` holds the latest stored state of every market already known for this event (key = marketKey).
 *  - A market is written if it is new, its price changed, its main-line flag changed, or it was unavailable and is back.
 *  - The same book listing two different prices for one market in the same response is a disagreement: the first listed price is kept and the event is counted.
 *  - With `complete = true`, a known open market missing from this response is written as 'unavailable' (it was pulled or the provider stopped listing it).
 */
export function planArchive(prior: Map<string, Prior>, quotes: ObservedQuote[], capturedAt: string, opts: { complete: boolean; skipped?: number } = { complete: true }): Plan {
  const rows: ArchiveRow[] = []
  const seenKeys = new Set<string>()
  let disagreements = 0, stale = 0
  for (const q of quotes) {
    const key = marketKey(q)
    if (seenKeys.has(key)) {
      const first = rows.find((r) => marketKey(r) === key)
      const known = first ? first.price : prior.get(key)?.price
      if (known !== undefined && known !== q.price) disagreements++
      continue
    }
    seenKeys.add(key)
    const freshness = freshnessOf(q.updated, capturedAt)
    if (freshness === 'stale') stale++
    const p = prior.get(key)
    const changed = !p || p.marketStatus === 'unavailable' || p.price !== q.price || (p.main ?? null) !== (q.main ?? null)
    if (changed) rows.push({ ...q, capturedAt, marketStatus: 'open', priceOrNull: q.price, freshness })
  }
  let unavailable = 0
  if (opts.complete) {
    for (const [key, p] of prior) {
      if (p.marketStatus !== 'open' || seenKeys.has(key)) continue
      const [eventId, playerName, stat, line, side, book, source] = key.split('|')
      rows.push({ eventId, eventStart: null, playerName, stat, line: Number(line), side: side as 'over' | 'under', book, source: source as ArchiveSource, price: 0, updated: null,
        timestampSource: 'unknown', main: p.main, capturedAt, marketStatus: 'unavailable', priceOrNull: null, freshness: 'unknown' })
      unavailable++
    }
  }
  return { rows, seen: seenKeys.size, written: rows.length, stale, disagreements, skipped: opts.skipped ?? 0, unavailable }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reading it back. These are the only places that attach the words "opening" and "closing".

export interface StoredQuote { capturedAt: string; price: number | null; marketStatus: 'open' | 'unavailable'; freshness: Freshness; timestampSource: string | null }

/** The first price this system observed. NOT the bookmaker's opening line: the market may have been open for days before we looked. */
export function firstObserved(history: StoredQuote[]): StoredQuote | null {
  return [...history].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).find((q) => q.marketStatus === 'open' && q.price !== null) ?? null
}

export interface ClosingProxy {
  kind: 'closing_proxy'
  price: number
  observedAt: string
  minutesBeforeStart: number
  /** Minutes between the observation and the cutoff. Small means a tight proxy. */
  gapToCutoffMinutes: number
  freshness: Freshness
  /** Always false: no provider in this project marks a market as closed, so this is never a true closing line. */
  isTrueClosingLine: false
}
export type ClosingResult = { ok: true; proxy: ClosingProxy } | { ok: false; reason: 'NO_OBSERVATION_BEFORE_CUTOFF' | 'OBSERVATION_TOO_OLD' | 'MARKET_UNAVAILABLE_AT_CUTOFF' | 'STALE_QUOTE' }

/**
 * The last observed price at or before `cutoffMinutes` before the event starts, if it is recent enough to mean something.
 * `maxGapMinutes`: the observation must be within this many minutes of the cutoff (default 20), otherwise there is no proxy rather than a misleading one.
 */
export function closingProxy(history: StoredQuote[], eventStart: string, opts: { cutoffMinutes?: number; maxGapMinutes?: number } = {}): ClosingResult {
  const cutoffMin = opts.cutoffMinutes ?? 5, maxGap = opts.maxGapMinutes ?? 20
  const cutoff = Date.parse(eventStart) - cutoffMin * 60_000
  const before = history.filter((q) => Date.parse(q.capturedAt) <= cutoff).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  const last = before[before.length - 1]
  if (!last) return { ok: false, reason: 'NO_OBSERVATION_BEFORE_CUTOFF' }
  if (last.marketStatus === 'unavailable' || last.price === null) return { ok: false, reason: 'MARKET_UNAVAILABLE_AT_CUTOFF' }
  const gap = (cutoff - Date.parse(last.capturedAt)) / 60_000
  if (gap > maxGap) return { ok: false, reason: 'OBSERVATION_TOO_OLD' }
  if (last.freshness === 'stale') return { ok: false, reason: 'STALE_QUOTE' }
  return { ok: true, proxy: { kind: 'closing_proxy', price: last.price, observedAt: last.capturedAt, minutesBeforeStart: (Date.parse(eventStart) - Date.parse(last.capturedAt)) / 60_000, gapToCutoffMinutes: gap, freshness: last.freshness, isTrueClosingLine: false } }
}

/** SQL text for the rows of one run (for scripts that write through wrangler). Values are escaped here; nothing is interpolated unescaped. */
const q = (v: string | number | null | boolean) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL') : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`)
export function runSql(run: { source: ArchiveSource; kind: RunKind; eventId: string; eventStart: string | null; capturedAt: string; status: string; plan: Plan; note?: string }): string[] {
  const head = `INSERT OR IGNORE INTO odds_runs (captured_at, source, kind, event_id, event_start, status, quotes_seen, quotes_written, stale_quotes, disagreements, note) VALUES (${q(run.capturedAt)}, ${q(run.source)}, ${q(run.kind)}, ${q(run.eventId)}, ${q(run.eventStart)}, ${q(run.status)}, ${run.plan.seen}, ${run.plan.written}, ${run.plan.stale}, ${run.plan.disagreements}, ${q(run.note ?? null)});`
  const where = `(SELECT id FROM odds_runs WHERE source = ${q(run.source)} AND event_id = ${q(run.eventId)} AND captured_at = ${q(run.capturedAt)})`
  return [head, ...run.plan.rows.map((r) =>
    `INSERT OR IGNORE INTO odds_quotes (event_id, event_start, player_name, stat, line, side, book, source, captured_at, run_id, price, market_status, quote_updated_at, timestamp_source, freshness, main) VALUES (${q(r.eventId)}, ${q(r.eventStart)}, ${q(r.playerName)}, ${q(r.stat)}, ${r.line}, ${q(r.side)}, ${q(r.book)}, ${q(r.source)}, ${q(r.capturedAt)}, ${where}, ${q(r.priceOrNull)}, ${q(r.marketStatus)}, ${q(r.updated)}, ${q(r.timestampSource)}, ${q(r.freshness)}, ${q(r.main)});`)]
}

/** Latest stored state of every market of one event (bind the event id twice). Rows feed `priorFromRows`. */
export const PRIOR_SQL = `SELECT q.player_name AS playerName, q.stat, q.line, q.side, q.book, q.source, q.price, q.market_status AS marketStatus, q.main
  FROM odds_quotes q JOIN (SELECT player_name, stat, line, side, book, source, MAX(captured_at) AS mc FROM odds_quotes WHERE event_id = ? GROUP BY player_name, stat, line, side, book, source) m
    ON q.event_id = ? AND q.player_name = m.player_name AND q.stat = m.stat AND q.line = m.line AND q.side = m.side AND q.book = m.book AND q.source = m.source AND q.captured_at = m.mc`

export interface PriorRow { playerName: string; stat: string; line: number; side: string; book: string; source: string; price: number | null; marketStatus: string; main: number | null }
export function priorFromRows(eventId: string, rows: PriorRow[]): Map<string, Prior> {
  return new Map(rows.map((r) => [marketKey({ eventId, playerName: r.playerName, stat: r.stat, line: r.line, side: r.side, book: r.book, source: r.source }),
    { price: r.price, marketStatus: r.marketStatus === 'unavailable' ? 'unavailable' as const : 'open' as const, main: r.main === null || r.main === undefined ? null : r.main === 1 }]))
}

/** SQL-escape a single value for the statements above (exported for scripts that build their own queries). */
export const sqlValue = q
