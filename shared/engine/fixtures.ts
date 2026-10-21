// Test fixtures for the engine and the Chief. Not imported by production code.
import type { Pick } from '../picks.ts'
import type { BookQuote, SideQuote } from './consensus.ts'
import type { CalibrationArtifact } from './calibration.ts'
import { makeConfig, type DeepPartial, type EngineConfig } from './config.ts'
import { minutesRanks, type RecordContext } from './record.ts'

export const NOW = Date.parse('2026-10-21T12:00:00Z')
export const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

/** A calibration artifact whose calibrated value equals the raw one and whose bounds are +/- `spread` (90 and 95 widen it). */
export function identityArtifact(opts: { spread?: number; status?: 'validated' | 'unvalidated'; stats?: string[] } = {}): CalibrationArtifact {
  const spread = opts.spread ?? 0.02
  const p = Array.from({ length: 49 }, (_, i) => Math.round((0.02 + i * 0.02) * 100) / 100)
  const stat = {
    method: 'platt' as const, status: opts.status ?? ('validated' as const), failedGates: opts.status === 'unvalidated' ? ['final: ECE 0.05 > 0.03'] : [],
    grid: {
      p, cal: p.map((x) => x),
      lo80: p.map((x) => Math.max(0, x - spread * 0.5)), hi80: p.map((x) => Math.min(1, x + spread * 0.5)),
      lo90: p.map((x) => Math.max(0, x - spread)), hi90: p.map((x) => Math.min(1, x + spread)),
      lo95: p.map((x) => Math.max(0, x - spread * 1.5)), hi95: p.map((x) => Math.min(1, x + spread * 1.5)),
    },
  }
  return { version: 'test', hash: 'testhash', caveat: 'synthetic', stats: Object.fromEntries((opts.stats ?? ['pts', 'reb', 'ast', 'fg3m']).map((s) => [s, stat])) }
}

let n = 0
export const resetFixtureCounter = () => { n = 0 }

/** Three fresh, agreeing books quoting both sides at ~1.95 (a 2.5% margin, so the best price is a little below the market's fair value, as in real markets). */
export function quotes(over = 1.95, under = 1.95, books = ['draftkings', 'fanatics', 'caesars'], min = 10): { bookQuotes: BookQuote[]; sideQuotes: (side: 'over' | 'under') => SideQuote[] } {
  const bookQuotes: BookQuote[] = books.map((book, i) => ({
    book, over: over - i * 0.01, under: under - i * 0.01, overUpdated: ago(min), underUpdated: ago(min), timestampSource: 'quote',
  }))
  return {
    bookQuotes,
    sideQuotes: (side) => bookQuotes.map((q) => ({ book: q.book, price: (side === 'over' ? q.over : q.under)!, updated: q.overUpdated, timestampSource: 'quote' as const })).sort((a, b) => b.price - a.price),
  }
}

/** A pick that passes every gate: fresh projection, a starter, healthy, verified, three fresh books. Override anything. */
export function mkPick(o: Partial<Pick> = {}): Pick {
  n++
  const side = o.side ?? 'over'
  const q = quotes()
  const price = o.price ?? 1.95
  return {
    playerId: 1000 + n, player: `P${n}`, team: 'BOS', teamName: 'Boston Celtics', stat: 'pts', side, line: 20.5 + (n % 9) * 0.5,
    price, book: 'draftkings', prices: q.sideQuotes(side).map((s) => ({ book: s.book, price: s.price })), oddsId: `o${n}`,
    eventId: `G${n}`, marketBooks: 3, modelProb: 0.6, marketProb: 0.5, prob: 0.55, push: 0, impliedProb: 1 / price, ev: 0.05, risk: 'balanced',
    model: 'gbm-v1', bigGap: false, projection: 24, hitRate10: 0.7, recent: [], sample: 40, projectionAgeHours: 2, game: 'Boston Celtics @ Detroit Pistons',
    gameDate: '2026-10-21', injury: null, injuryChecked: true, role: { label: 'Starter', min10: 34, trend: 0, games: 60 }, oppFactor: null,
    bookQuotes: q.bookQuotes, sideQuotes: q.sideQuotes(side), main: true, mainKnown: true, identity: 'verified', ...o,
  } as unknown as Pick
}

/** The same pick with its quotes rebuilt for a different pair of prices (so the market fair probability moves). */
export function withMarket(p: Pick, over: number, under: number, books?: string[], min = 10): Pick {
  const q = quotes(over, under, books, min)
  return { ...p, bookQuotes: q.bookQuotes, sideQuotes: q.sideQuotes(p.side), prices: q.sideQuotes(p.side).map((s) => ({ book: s.book, price: s.price })), price: q.sideQuotes(p.side)[0].price }
}

export function context(picks: Pick[], o: { config?: DeepPartial<EngineConfig>; calibration?: CalibrationArtifact | null; injuryChecked?: boolean } = {}): RecordContext {
  return {
    now: NOW, config: makeConfig(o.config), calibration: o.calibration === undefined ? identityArtifact() : o.calibration,
    minutesRank: minutesRanks(picks), injuryChecked: o.injuryChecked ?? true,
  }
}
