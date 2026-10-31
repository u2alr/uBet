// Moneyline, spread and total from the odds block ESPN's public scoreboard carries (one book, labelled by ESPN, currently DraftKings). It costs no credits, so the team-level
// features (market favourite, team bets) do not depend on The Odds API. One book means no cross-book average: the win chance is that book's own no-margin chance.
// Pure parsing; anything missing or malformed gives null, never a guess.

export interface EspnGameOdds {
  book: string
  /** Decimal moneyline prices. */
  home: number
  away: number
  /** The home team's spread (negative when the home team is favoured). */
  spread: number | null
  total: number | null
  /** The book's no-margin chance that the home team wins. */
  homeWinProb: number
}

/** "+210" -> 3.10, "-150" -> 1.6667. Anything else (including "EVEN" handled as +100) is null. */
export function americanToDecimal(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'EVEN' || s === 'PK') return 2
  const m = /^([+-]?)(\d{2,5})$/.exec(s)
  if (!m) return null
  const n = Number(m[2])
  if (m[1] === '-') return 1 + 100 / n
  return 1 + n / 100
}

const side = (ml: any, which: 'home' | 'away'): number | null => americanToDecimal(ml?.[which]?.close?.odds ?? ml?.[which]?.open?.odds)

export function parseEspnOdds(competition: any): EspnGameOdds | null {
  const o = competition?.odds?.[0]
  if (!o) return null
  const home = side(o.moneyline, 'home'), away = side(o.moneyline, 'away')
  if (home === null || away === null || home <= 1 || away <= 1) return null
  const ih = 1 / home, ia = 1 / away
  const abs = typeof o.spread === 'number' && Number.isFinite(o.spread) ? Math.abs(o.spread) : null
  const homeFav = o.homeTeamOdds?.favorite === true
  return {
    book: String(o.provider?.displayName ?? o.provider?.name ?? 'ESPN'),
    home, away,
    spread: abs === null ? null : abs === 0 ? 0 : homeFav ? -abs : abs,
    total: typeof o.overUnder === 'number' && Number.isFinite(o.overUnder) ? o.overUnder : null,
    homeWinProb: ih / (ih + ia),
  }
}
