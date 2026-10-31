import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capByAssignment, describeMatchup, offenseLines, matchupConfidence, rateDefender, teamLines, type DefenseMeta, type MatchupRow } from './defense.ts'

const meta: DefenseMeta = { as_of: '2026-10-31', matchups_through: '2026-10-30', dpoe_mean: 0, dpoe_sd: 1, defenders_rated: 300, games_with_matchups: 5000 }

test('confidence thresholds are the pre-registered ones', () => {
  assert.equal(matchupConfidence(0.6), 'high')
  assert.equal(matchupConfidence(0.59), 'medium')
  assert.equal(matchupConfidence(0.3), 'medium')
  assert.equal(matchupConfidence(0.29), 'low')
  assert.equal(matchupConfidence(null), null)
})

test('a defender with a thin sample is never rated, whatever the number says', () => {
  assert.equal(rateDefender(9, 0.1, meta).rated, false)
  assert.equal(rateDefender(null, 1, meta).rated, false)
  assert.equal(rateDefender(9, 0.49, meta).rated, false)
})

test('ratings are contextual and the sign is right: opponents scoring more than expected means below average', () => {
  assert.match(rateDefender(1.2, 0.9, meta).label, /^Below-average in the available matchup sample/)
  assert.match(rateDefender(-1.2, 0.9, meta).label, /^Above-average/)
  assert.match(rateDefender(0.1, 0.9, meta).label, /^About average/)
  assert.ok(!/bad|terrible|elite/i.test(rateDefender(5, 1, meta).label))
})

test('team lines only mention what is relevant to the statistic and notable', () => {
  const rows = [
    { metric: 'p3a_rate', value_l10: 0.4, value_s2d: 0.39, pct_l10: 0.9 },
    { metric: 'oreb_share', value_l10: 0.3, value_s2d: 0.29, pct_l10: 0.95 },
    { metric: 'ftr', value_l10: 0.25, value_s2d: 0.25, pct_l10: 0.5 },
  ]
  const threes = teamLines(rows, 'fg3m')
  assert.equal(threes.length, 1)
  assert.match(threes[0], /three-point attempts/)
  assert.match(threes[0], /higher than 90% of teams/)
  assert.equal(teamLines(rows, 'ast').length, 0)
  assert.equal(teamLines(rows, 'reb').length, 1)
})

test('matchup description separates direct history from a role-based estimate', () => {
  const row = (rank: number, direct: number, poss: number): MatchupRow => ({ rank, defender_id: rank, defender: `D${rank}`, weight: 0.5 / rank, dpoe100: 1, foul100: 1.5, expo: 0.9, direct_poss: poss, role: 'G', conf: 0.7, herf: 0.3, direct })
  const strong = describeMatchup([row(1, 0.5, 40), row(2, 0.5, 20)], meta)!
  assert.match(strong.basis, /own past matchups/)
  assert.equal(strong.confidence, 'high')
  assert.equal(strong.concentrated, true)
  const weak = describeMatchup([row(1, 0, 0)], meta)!
  assert.match(weak.basis, /tends to guard players in his role/)
  assert.equal(weak.defenders[0].sample, 'no past matchups with him')
  assert.equal(describeMatchup([], meta), null)
})

test('displayed confidence cannot exceed how concentrated the estimated assignment is', () => {
  assert.equal(capByAssignment('high', 0.6), 'high')
  assert.equal(capByAssignment('high', 0.4), 'medium')
  assert.equal(capByAssignment('high', 0.19), 'low')
  assert.equal(capByAssignment('low', 0.9), 'low')
  assert.equal(capByAssignment(null, 0.9), null)
})

test('offence lines describe the own team of the player, only for relevant statistics, and only when notable', () => {
  const rows = [
    { metric: 'off_pace', value_l10: 104, value_s2d: 103, pct_l10: 0.9 },
    { metric: 'off_ast', value_l10: 0.2, value_s2d: 0.2, pct_l10: 0.1 },
    { metric: 'off_ftr', value_l10: 0.25, value_s2d: 0.25, pct_l10: 0.5 },
  ]
  assert.match(offenseLines(rows, 'pts')[0], /fast pace/)
  assert.equal(offenseLines(rows, 'pts').length, 1)
  assert.match(offenseLines(rows, 'ast').join(' '), /low assist rate/)
  assert.equal(offenseLines(rows, 'reb').length, 1, 'pace applies to rebounds; assist rate does not')
})
