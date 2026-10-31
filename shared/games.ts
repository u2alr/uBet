// Game-winner view for display: the model's chance next to the market's, a "lean" only when they disagree enough, and plain-language facts about the matchup.
// The model is the rating baseline described in shared/games.status.json (research/PREREG_GAMES.md). It cannot see injuries or lineups and has not been tested against sportsbook
// lines, so a disagreement with the market is far more likely the model's blind spot than an opportunity. Nothing here is a bet recommendation.

/** Fixed in research/PREREG_GAMES.md: the gap in the home team's win chance that counts as a lean. */
export const LEAN_GAP = 0.07

export interface GameLeanRow {
  date: string; home: string; away: string
  model_home_prob: number; elo_home: number; elo_away: number
  home_net10: number | null; away_net10: number | null
  home_off20: number | null; home_def20: number | null; away_off20: number | null; away_def20: number | null
  as_of: string
}

export interface Lean {
  modelPick: string
  modelProb: number
  marketPick: string | null
  marketProb: number | null
  /** Gap in the home win chance, model minus market (percentage points / 100). Null without a market price. */
  gap: number | null
  agree: boolean | null
  /** True when the picks differ AND the gap is at least LEAN_GAP. */
  lean: boolean
}

export function lean(row: Pick3, marketHomeProb: number | null): Lean {
  const modelHome = row.model_home_prob >= 0.5
  const modelPick = modelHome ? row.home : row.away
  const modelProb = modelHome ? row.model_home_prob : 1 - row.model_home_prob
  if (marketHomeProb == null || !Number.isFinite(marketHomeProb)) return { modelPick, modelProb, marketPick: null, marketProb: null, gap: null, agree: null, lean: false }
  const marketHome = marketHomeProb >= 0.5
  const gap = row.model_home_prob - marketHomeProb
  const agree = modelHome === marketHome
  return { modelPick, modelProb, marketPick: marketHome ? row.home : row.away, marketProb: marketHome ? marketHomeProb : 1 - marketHomeProb, gap, agree, lean: !agree && Math.abs(gap) >= LEAN_GAP }
}
type Pick3 = Pick<GameLeanRow, 'home' | 'away' | 'model_home_prob'>

const sign = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`

/** Descriptive facts only (they did not pass validation as model inputs): how each team has been playing over its recent games. */
export function ratingFacts(r: GameLeanRow): string[] {
  const out: string[] = []
  if (r.home_net10 != null && r.away_net10 != null) {
    const gap = r.home_net10 - r.away_net10
    out.push(`Net rating over the last 10 games: ${r.home} ${sign(r.home_net10)}, ${r.away} ${sign(r.away_net10)} per 100 possessions${Math.abs(gap) >= 6 ? ` (a ${Math.abs(gap).toFixed(0)}-point gap in favour of ${gap > 0 ? r.home : r.away})` : ''}.`)
  }
  if (r.home_off20 != null && r.away_def20 != null && r.away_off20 != null && r.home_def20 != null) {
    out.push(`Last 20 games, points per 100 possessions: ${r.home} score ${r.home_off20.toFixed(1)} and allow ${r.home_def20.toFixed(1)}; ${r.away} score ${r.away_off20.toFixed(1)} and allow ${r.away_def20.toFixed(1)}.`)
  }
  return out
}

/** The sentence under the numbers. Careful wording: a lean is a prompt to check the news, not a pick. */
export function leanText(l: Lean): string {
  if (l.marketPick === null) return `The model favours ${l.modelPick} at ${Math.round(l.modelProb * 100)}%. There is no market price to compare it with.`
  if (l.agree) return `The model and the market both favour ${l.modelPick} (${Math.round(l.modelProb * 100)}% and ${Math.round(l.marketProb! * 100)}%).`
  if (!l.lean) return `The model slightly prefers ${l.modelPick} (${Math.round(l.modelProb * 100)}%) while the market favours ${l.marketPick} (${Math.round(l.marketProb! * 100)}%); the gap is small enough to be noise.`
  return `The model leans ${l.modelPick} (${Math.round(l.modelProb * 100)}%) against a market that favours ${l.marketPick} (${Math.round(l.marketProb! * 100)}%), a ${Math.round(Math.abs(l.gap!) * 100)}-point gap. The model cannot see injuries or lineups, which is the usual reason for a gap like this: check the news before reading anything into it.`
}
