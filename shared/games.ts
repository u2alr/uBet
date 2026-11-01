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
  /** Rotation players the injury report lists Out, "Name (avg minutes)" separated by semicolons; empty when none (or when the team has no rotation yet this season). */
  absent_home?: string | null; absent_away?: string | null
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

/** What the model assumed about availability, in words. Names the rotation players treated as out so the number can be checked against the news. */
export function availabilityFact(r: GameLeanRow): string {
  const side = (team: string, list?: string | null) => (list && list.trim() ? `${team} without ${list}` : `${team}: no rotation player listed out`)
  return `Assumed available: ${side(r.home, r.absent_home)}; ${side(r.away, r.absent_away)}.`
}

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
  return `The model leans ${l.modelPick} (${Math.round(l.modelProb * 100)}%) against a market that favours ${l.marketPick} (${Math.round(l.marketProb! * 100)}%), a ${Math.round(Math.abs(l.gap!) * 100)}-point gap. The model reads the injury report as of the snapshot but not late scratches, Questionable players or lineup news, which is the usual reason for a gap like this: check the news before reading anything into it.`
}

export type GameReasonKind = 'for' | 'against' | 'caution' | 'context'
export interface GameReason { kind: GameReasonKind; label: string; text: string }
/** A player the injury report lists as Questionable or Doubtful: the model counts only players listed Out, so these are invisible to it. */
export interface Uncertain { team: string; name: string; status: string }

/** The home-court bonus the Elo ratings were built with. Elo's own win chance for the home team is a reference point, not the model's number. */
export const ELO_HOME_POINTS = 100
export const eloHomeProb = (eloHome: number, eloAway: number) => 1 / (1 + 10 ** (-(eloHome - eloAway + ELO_HOME_POINTS) / 400))

/** "Name (27 min); Other (12 min)" -> the players listed. */
const absentees = (list?: string | null) => (list ?? '').split(';').map((s) => s.trim()).filter(Boolean)

const pct0 = (x: number) => `${Math.round(x * 100)}%`
const NET_GAP = 6, ELO_GAP = 25, ELO_HUGE = 100, BEYOND_ELO = 0.03

/**
 * Why the model favours the team it does. The model's inputs are home court, a margin-aware Elo and the rotation players the injury report lists Out; those
 * give 'for' / 'against' reasons. Net rating and recent scoring did not pass validation as inputs, so they are 'context' and never counted as support.
 * Nothing here is a bet recommendation, and no per-factor percentage is claimed: the fitted weights are not part of the row.
 */
export function gameReasons(r: GameLeanRow, marketHomeProb: number | null, uncertain: Uncertain[] = []): GameReason[] {
  const l = lean(r, marketHomeProb)
  const homeFav = l.modelPick === r.home
  const fav = l.modelPick, opp = homeFav ? r.away : r.home
  const out: GameReason[] = []
  const add = (kind: GameReasonKind, label: string, text: string) => out.push({ kind, label, text })

  // Home court.
  if (homeFav) add('for', 'Home court', `${fav} plays at home, which the model counts as an advantage (about ${ELO_HOME_POINTS} Elo points in the ratings).`)
  else add('against', 'Home court', `${fav} is on the road, a disadvantage the model has already weighed and still favours them.`)

  // Elo, from the favourite's side.
  const eloFav = homeFav ? r.elo_home : r.elo_away, eloOpp = homeFav ? r.elo_away : r.elo_home
  const d = Math.round(eloFav - eloOpp)
  if (Math.abs(d) >= ELO_GAP) add(d > 0 ? 'for' : 'against', 'Team strength', `Elo rating (margin-aware, updated after every game): ${fav} ${Math.round(eloFav)} against ${opp} ${Math.round(eloOpp)}, ${d > 0 ? 'ahead' : 'behind'} by ${Math.abs(d)}${Math.abs(d) >= ELO_HUGE ? ', a large gap' : ''}.`)
  else add('context', 'Team strength', `Elo ratings are close: ${fav} ${Math.round(eloFav)}, ${opp} ${Math.round(eloOpp)}.`)

  // Who is out: the model's own availability input.
  const mine = absentees(homeFav ? r.absent_home : r.absent_away), theirs = absentees(homeFav ? r.absent_away : r.absent_home)
  if (theirs.length) add('for', 'Their absences', `${opp} has ${theirs.join('; ')} listed Out (average minutes in brackets), which the model counts against them.`)
  if (mine.length) add('against', 'Own absences', `${fav} has ${mine.join('; ')} listed Out (average minutes in brackets), which the model counts against them, and it still favours them.`)
  if (!theirs.length && !mine.length) add('context', 'Availability', 'Neither team has a rotation player listed Out, so availability does not move the number.')

  // Does the model sit away from plain Elo? Then the injury report and the fitted weights moved it.
  const plain = eloHomeProb(r.elo_home, r.elo_away), shift = r.model_home_prob - plain
  if (Math.abs(shift) >= BEYOND_ELO) {
    const favPlain = homeFav ? plain : 1 - plain
    add('context', 'Beyond Elo', `Elo with home court alone gives ${fav} ${pct0(favPlain)}; the model says ${pct0(l.modelProb)}, ${l.modelProb > favPlain ? 'higher' : 'lower'}, because it also reads the injury report and was fitted on past seasons.`)
  }

  // The market.
  if (l.marketPick !== null) {
    if (l.agree) add('for', 'Market', `The betting market also favours ${fav} (${pct0(l.marketProb!)}).`)
    else if (l.lean) add('caution', 'Market', `The market favours ${l.marketPick} (${pct0(l.marketProb!)}), a ${Math.round(Math.abs(l.gap!) * 100)}-point gap. That usually means the market has news the model lacks.`)
    else add('context', 'Market', `The market narrowly favours ${l.marketPick} (${pct0(l.marketProb!)}); the gap is small enough to be noise.`)
  } else add('context', 'Market', 'No market price to compare with.')

  // Descriptive form: not a model input.
  if (r.home_net10 != null && r.away_net10 != null) {
    const gap = (r.home_net10 - r.away_net10) * (homeFav ? 1 : -1)
    if (Math.abs(gap) >= NET_GAP) add('context', 'Recent form', `Net rating over the last 10 games is ${Math.abs(gap).toFixed(0)} points per 100 possessions ${gap > 0 ? 'better' : 'worse'} for ${fav}. Descriptive only: it did not pass validation as a model input.`)
  }

  // What the model cannot see.
  const doubt = uncertain.filter((u) => u.team === r.home || u.team === r.away)
  if (doubt.length) add('caution', 'Not seen by the model', `${doubt.map((u) => `${u.team} ${u.name} (${u.status})`).join('; ')}. ${doubt.some((u) => u.status === 'out, not counted') ? `"Out, not counted" means the report lists him Out now but he was not among the rotation players the model counted: it was scored ${r.as_of} ET, or he has missed too many of the team's recent games to count as rotation. ` : ''}The model counts only rotation players listed Out when it was scored, so these could change the picture.`)
  add('caution', 'Limits', 'Late scratches and lineup news are not seen, and the model has not been tested against sportsbook lines.')

  const order: Record<GameReasonKind, number> = { for: 0, against: 1, caution: 2, context: 3 }
  return out.sort((a, b) => order[a.kind] - order[b.kind])
}
