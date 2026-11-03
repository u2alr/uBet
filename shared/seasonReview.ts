// A season review: for the games already played, who the model had as the favourite BEFORE the game, who won, and what the upsets had in common. Pure: no network, no
// database, no clock. The predictions are the walk-forward ones (games-v2 fitted on earlier seasons, prior-only features) that research/game_snapshot.py stores.
//
// The point is honesty about luck. A 70% favourite is supposed to lose three games in ten, so the review counts upsets against what the model expected before
// it reads anything into them, and it says when a sample is too small to tell a pattern from noise.

export interface ReviewRow {
  date: string
  home: string
  away: string
  /** The model's chance for the home team, said before the game. */
  p_home: number
  home_won: number
  /** Opponent-adjusted rating, home minus away (points per game). */
  srs_gap: number | null
  /** Talent missing (Game Score of absent rotation players), home minus away: positive means the home team was more depleted. */
  talent_diff: number | null
  rest_diff: number | null
  b2b_home: number | null
  b2b_away: number | null
}

/** Where a favourite's chance puts them. Shared with the page so the words and colors mean the same thing everywhere. */
export const TIER_MIN = { heavy: 0.78, clear: 0.65, slight: 0.56 } as const
export type TierKey = 'heavy' | 'clear' | 'slight' | 'tossup'
export const tierKey = (p: number): TierKey => (p >= TIER_MIN.heavy ? 'heavy' : p >= TIER_MIN.clear ? 'clear' : p >= TIER_MIN.slight ? 'slight' : 'tossup')

export interface FavouriteGame {
  date: string
  favourite: string
  underdog: string
  /** The favourite is the home team. */
  home: boolean
  /** The favourite's chance, as the model said it before the game. */
  prob: number
  won: boolean
  /** The same context, from the favourite's side. */
  factors: { ratingGap: number | null; talentMissing: number | null; restAdvantage: number | null; onRoad: boolean; backToBack: boolean | null; underdogBackToBack: boolean | null }
  /** Plain-language observations for an upset; empty for a win. */
  why: string[]
}

export interface TierSummary { key: TierKey; n: number; stated: number | null; actual: number | null; /** About two standard errors of `actual`: a gap inside it is noise. */ noise: number | null; withinNoise: boolean | null }

export interface Review {
  games: number
  favouriteWon: number
  meanStated: number | null
  actualRate: number | null
  logLoss: number | null
  brier: number | null
  tiers: TierSummary[]
  upsets: { observed: number; expected: number; z: number | null; verdict: string }
  /** Average of each context factor among upsets and among the games the favourite won. */
  contrast: { factor: string; upsets: number | null; held: number | null }[]
  upsetGames: FavouriteGame[]
  /** Every game reviewed, newest first: the model's call before the game and what happened. */
  allGames: FavouriteGame[]
  caution: string
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10)

export function favouriteOf(r: ReviewRow): FavouriteGame {
  const home = r.p_home >= 0.5
  const s = home ? 1 : -1
  const prob = home ? r.p_home : 1 - r.p_home
  const won = (r.home_won === 1) === home
  const gap = num(r.srs_gap), talent = num(r.talent_diff), rest = num(r.rest_diff)
  const b2bFav = home ? r.b2b_home : r.b2b_away
  const b2bDog = home ? r.b2b_away : r.b2b_home
  const factors = {
    ratingGap: gap == null ? null : s * gap,
    talentMissing: talent == null ? null : s * talent,
    restAdvantage: rest == null ? null : s * rest,
    onRoad: !home,
    backToBack: b2bFav == null ? null : b2bFav === 1,
    underdogBackToBack: b2bDog == null ? null : b2bDog === 1,
  }
  const why: string[] = []
  if (!won) {
    if (factors.ratingGap != null && factors.ratingGap < 2) why.push(`narrow rating gap (${r1(factors.ratingGap)! > 0 ? '+' : ''}${r1(factors.ratingGap)} points a game)`)
    if (factors.talentMissing != null && factors.talentMissing > 15) why.push('favourite was missing more talent than the underdog')
    if (factors.onRoad) why.push('favourite was on the road')
    if (factors.backToBack && !factors.underdogBackToBack) why.push('favourite was on a back-to-back')
    if (factors.restAdvantage != null && factors.restAdvantage <= -2) why.push('underdog had more rest')
    if (!why.length) why.push('no visible cause: ordinary variance')
  }
  return { date: r.date, favourite: home ? r.home : r.away, underdog: home ? r.away : r.home, home, prob, won, factors, why }
}

export function review(rows: ReviewRow[]): Review {
  const fav = rows.map(favouriteOf)
  const n = fav.length
  const probs = fav.map((f) => f.prob)
  const tiers: TierSummary[] = (['heavy', 'clear', 'slight', 'tossup'] as const).map((key) => {
    const g = fav.filter((f) => tierKey(f.prob) === key)
    const actual = mean(g.map((f) => (f.won ? 1 : 0)))
    const noise = g.length && actual != null ? 2 * Math.sqrt((actual * (1 - actual)) / g.length) : null
    const stated = mean(g.map((f) => f.prob))
    return { key, n: g.length, stated, actual, noise, withinNoise: stated == null || actual == null || noise == null ? null : Math.abs(actual - stated) <= Math.max(noise, 0.03) }
  })
  const observed = fav.filter((f) => !f.won).length
  const expected = probs.reduce((a, p) => a + (1 - p), 0)
  const variance = probs.reduce((a, p) => a + p * (1 - p), 0)
  const z = variance > 0 ? (observed - expected) / Math.sqrt(variance) : null
  const verdict = n < 10 ? 'Too few games to say anything yet.'
    : z == null ? 'No verdict.'
      : Math.abs(z) < 1.5 ? `Upsets are within normal variance (${observed} against ${expected.toFixed(1)} expected).`
        : z > 0 ? `More upsets than the model expected (${observed} against ${expected.toFixed(1)}): worth watching, but still a small sample.`
          : `Fewer upsets than the model expected (${observed} against ${expected.toFixed(1)}).`
  const lost = fav.filter((f) => !f.won), held = fav.filter((f) => f.won)
  const contrastOf = (label: string, pick: (f: FavouriteGame) => number | null) => ({ factor: label, upsets: r1(mean(lost.map(pick).filter((x): x is number => x != null))), held: r1(mean(held.map(pick).filter((x): x is number => x != null))) })
  const ll = n ? -mean(fav.map((f) => Math.log(Math.min(Math.max(f.won ? f.prob : 1 - f.prob, 1e-6), 1 - 1e-6))))! : null
  return {
    games: n,
    favouriteWon: fav.filter((f) => f.won).length,
    meanStated: mean(probs),
    actualRate: mean(fav.map((f) => (f.won ? 1 : 0))),
    logLoss: ll,
    brier: n ? mean(fav.map((f) => (f.prob - (f.won ? 1 : 0)) ** 2)) : null,
    tiers,
    upsets: { observed, expected, z, verdict },
    contrast: [
      contrastOf('Rating gap in the favourite\'s favour (points a game)', (f) => f.factors.ratingGap),
      contrastOf('Talent missing, favourite minus underdog (negative: the underdog was more depleted)', (f) => f.factors.talentMissing),
      contrastOf('Rest advantage (days)', (f) => f.factors.restAdvantage),
      contrastOf('Favourite on the road (share of games)', (f) => (f.factors.onRoad ? 1 : 0)),
      contrastOf('Favourite on a back-to-back (share of games)', (f) => (f.factors.backToBack == null ? null : f.factors.backToBack ? 1 : 0)),
    ],
    upsetGames: [...lost].sort((a, b) => b.date.localeCompare(a.date) || b.prob - a.prob),
    allGames: [...fav].sort((a, b) => b.date.localeCompare(a.date) || b.prob - a.prob),
    caution: n < 200 ? `${n} games is a small sample: a few upsets either way can look like a pattern when it is only luck.` : '',
  }
}
