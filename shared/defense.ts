// Defensive matchup context for display. Pure functions over the rows research/defense_snapshot.py writes (migration 0019).
// Nothing here is a probability: the evaluation (research/RESULTS_DEFENSE.md) decides whether any defensive feature may change a prediction, and until one does the app only describes.
// Wording is deliberately contextual ("below-average in the available sample"): a defender is never called bad on a small sample or a single noisy metric.

export interface TeamMetricRow { metric: string; value_l10: number | null; value_s2d: number | null; pct_l10: number | null }
export interface MatchupRow {
  rank: number; defender_id: number; defender: string; weight: number; dpoe100: number | null; foul100: number | null; expo: number | null
  direct_poss: number | null; role: string | null; conf: number | null; herf: number | null; direct: number | null
}
export interface DefenseMeta { as_of: string; matchups_through: string; dpoe_mean: number; dpoe_sd: number; defenders_rated: number; games_with_matchups: number }
export type Confidence = 'high' | 'medium' | 'low'

/** Thresholds fixed in research/PREREG_DEFENSE.md. */
export function matchupConfidence(conf: number | null): Confidence | null {
  if (conf === null || !Number.isFinite(conf)) return null
  return conf >= 0.6 ? 'high' : conf >= 0.3 ? 'medium' : 'low'
}

export const MIN_SAMPLE = 0.5      // exposure (0 to 1, where 1 means a full shrinkage-weight of matchup possessions) below which a defender is not rated

export interface DefenderRating { label: string; rated: boolean }

/** dpoe100 > 0 means the players he guarded scored MORE than they normally do, so he rates below average. */
export function rateDefender(dpoe100: number | null, expo: number | null, meta: Pick<DefenseMeta, 'dpoe_mean' | 'dpoe_sd'>): DefenderRating {
  if (dpoe100 === null || expo === null || expo < MIN_SAMPLE || !(meta.dpoe_sd > 0)) return { label: 'Not enough defensive sample to rate', rated: false }
  const z = (dpoe100 - meta.dpoe_mean) / meta.dpoe_sd
  if (z >= 0.5) return { label: 'Below-average in the available matchup sample', rated: true }
  if (z <= -0.5) return { label: 'Above-average in the available matchup sample', rated: true }
  return { label: 'About average in the available matchup sample', rated: true }
}

interface MetricInfo { high: string; low: string; stats: string[] }
const METRICS: Record<string, MetricInfo> = {
  ppp_adj: { high: 'has allowed more points per possession than those offences usually score', low: 'has held offences below what they usually score per possession', stats: ['pts', 'pra'] },
  p3a_rate: { high: 'allows a lot of three-point attempts', low: 'allows few three-point attempts', stats: ['fg3m', 'pts', 'pra'] },
  p3_pct: { high: 'has allowed a high three-point percentage (partly luck over a short window)', low: 'has held opponents to a low three-point percentage (partly luck over a short window)', stats: ['fg3m', 'pts', 'pra'] },
  ftr: { high: 'sends opponents to the free-throw line often', low: 'rarely sends opponents to the free-throw line', stats: ['pts', 'pra'] },
  oreb_share: { high: 'gives up a high share of offensive rebounds', low: 'secures a high share of defensive rebounds', stats: ['reb', 'pra'] },
  ast_rate: { high: 'allows a lot of assists per possession', low: 'allows few assists per possession', stats: ['ast', 'pra'] },
  tov_rate: { high: 'forces turnovers at a high rate', low: 'forces few turnovers', stats: ['pts', 'ast', 'pra'] },
}

/** Plain-language lines about the team defence that are relevant to this statistic and notable (top or bottom quarter of the league). */
export function teamLines(rows: TeamMetricRow[], stat: string): string[] {
  const out: string[] = []
  for (const r of rows) {
    const info = METRICS[r.metric]
    if (!info || !info.stats.includes(stat) || r.pct_l10 === null) continue
    if (r.pct_l10 >= 0.75) out.push(`Over its last 10 games this defence ${info.high} (higher than ${Math.round(r.pct_l10 * 100)}% of teams).`)
    else if (r.pct_l10 <= 0.25) out.push(`Over its last 10 games this defence ${info.low} (lower than ${Math.round((1 - r.pct_l10) * 100)}% of teams).`)
  }
  return out
}

const OFFENCE: Record<string, MetricInfo> = {
  off_pace: { high: 'plays at a fast pace, which means more possessions for everyone', low: 'plays at a slow pace, which means fewer possessions for everyone', stats: ['pts', 'reb', 'ast', 'fg3m', 'pra'] },
  off_ppp: { high: 'scores efficiently', low: 'scores inefficiently', stats: ['pts', 'ast', 'pra'] },
  off_p3a: { high: 'takes a lot of threes', low: 'takes few threes', stats: ['fg3m', 'pts', 'pra'] },
  off_ast: { high: 'moves the ball (high assist rate)', low: 'has a low assist rate', stats: ['ast', 'pra'] },
  off_oreb: { high: 'crashes the offensive glass', low: 'rarely goes for offensive rebounds', stats: ['reb', 'pra'] },
  off_ftr: { high: 'gets to the free-throw line often', low: 'rarely gets to the free-throw line', stats: ['pts', 'pra'] },
}

/** Plain-language lines about the player's OWN team offence for this statistic (top or bottom quarter of the league, last 10 games). Descriptive only: these were not evaluated as model inputs. */
export function offenseLines(rows: TeamMetricRow[], stat: string): string[] {
  const out: string[] = []
  for (const r of rows) {
    const info = OFFENCE[r.metric]
    if (!info || !info.stats.includes(stat) || r.pct_l10 === null) continue
    if (r.pct_l10 >= 0.75) out.push(`His team ${info.high} (higher than ${Math.round(r.pct_l10 * 100)}% of teams over its last 10 games).`)
    else if (r.pct_l10 <= 0.25) out.push(`His team ${info.low} (lower than ${Math.round((1 - r.pct_l10) * 100)}% of teams over its last 10 games).`)
  }
  return out
}

export interface MatchupView {
  defenders: { name: string; share: number; rating: DefenderRating; sample: string }[]
  confidence: Confidence | null
  basis: string
  /** True when the history says one defender takes most of the assignment; false means it is spread out and may change through switches. */
  concentrated: boolean
}

const ORDER: Confidence[] = ['low', 'medium', 'high']
/** Sample confidence says how much history stands behind the defenders; it cannot exceed how concentrated the estimated assignment is. A top share under 25% is low, under 50% is at most medium. */
export function capByAssignment(sample: Confidence | null, topShare: number): Confidence | null {
  if (sample === null) return null
  const assignment: Confidence = topShare >= 0.5 ? 'high' : topShare >= 0.25 ? 'medium' : 'low'
  return ORDER[Math.min(ORDER.indexOf(sample), ORDER.indexOf(assignment))]
}

export function describeMatchup(rows: MatchupRow[], meta: DefenseMeta): MatchupView | null {
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => a.rank - b.rank)
  const first = sorted[0]
  const direct = first.direct ?? 0
  const basis = direct >= 0.4
    ? 'Estimated mostly from this player\'s own past matchups against these defenders.'
    : direct >= 0.1 ? 'Estimated from this player\'s past matchups and from who guards players in his role.'
    : 'Estimated from who tends to guard players in his role; little history between these two sides.'
  return {
    defenders: sorted.map((r) => ({
      name: r.defender, share: r.weight, rating: rateDefender(r.dpoe100, r.expo, meta),
      sample: r.direct_poss && r.direct_poss > 0 ? `${Math.round(r.direct_poss)} past matchup possessions with him` : 'no past matchups with him',
    })),
    confidence: capByAssignment(matchupConfidence(first.conf), Math.max(...sorted.map((r) => r.weight))), basis, concentrated: (first.herf ?? 0) >= 0.25,
  }
}
