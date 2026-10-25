import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestStreak, sortRows, type RecentGame, type Row } from './cheatSheet.ts'

// Newest first, as the API sends them.
const g = (pts: number, extra: Partial<RecentGame> = {}): RecentGame => ({ date: '2026-10-01', minutes: 32, pts, reb: 5, ast: 4, fg3m: 2, ...extra })

test('the best streak is the highest ladder threshold cleared in every game of the window', () => {
  const s = bestStreak([g(18), g(22), g(16), g(30)], 'pts', 3)!
  assert.deepEqual([s.threshold, s.hits, s.games], [15, 3, 3])          // 18, 22, 16 all reach 15; 16 misses 18
  assert.deepEqual(s.values, [16, 22, 18])                              // oldest first
  assert.ok(Math.abs(s.average - 56 / 3) < 1e-9)
})

test('the window is the most recent games only, and an older bad game does not count', () => {
  assert.equal(bestStreak([g(20), g(20), g(20), g(2)], 'pts', 3)!.threshold, 20)
  assert.equal(bestStreak([g(20), g(20), g(20), g(6)], 'pts', 4)!.threshold, 5)    // widening the window to include the 6 drops the streak to 5+
})

test('a lower hit-rate bar allows a higher threshold: 4 of 5 at 25+ beats 5 of 5 at 15+ when 80% is enough', () => {
  const games = [g(26), g(30), g(27), g(16), g(28)]
  assert.equal(bestStreak(games, 'pts', 5, 1)!.threshold, 15)
  const s = bestStreak(games, 'pts', 5, 0.8)!
  assert.deepEqual([s.threshold, s.hits], [25, 4])
})

test('too few games means no streak, and a player who clears nothing on the ladder has none', () => {
  assert.equal(bestStreak([g(20), g(20)], 'pts', 3), null)
  assert.equal(bestStreak([g(2), g(1), g(3)], 'pts', 3), null)
  assert.equal(bestStreak([], 'pts', 1), null)
})

test('PRA adds points, rebounds and assists; threes use their own small ladder', () => {
  const s = bestStreak([g(20, { reb: 8, ast: 6 }), g(18, { reb: 7, ast: 5 }), g(25, { reb: 9, ast: 7 })], 'pra', 3)!
  assert.equal(s.threshold, 30)                                         // 34, 30, 41
  assert.equal(bestStreak([g(10, { fg3m: 3 }), g(12, { fg3m: 4 }), g(9, { fg3m: 3 })], 'fg3m', 3)!.threshold, 3)
})

test('sorting by threshold compares each statistic against its own ladder, not raw numbers', () => {
  const mk = (player: string, stat: 'pts' | 'reb', threshold: number): Row => ({ playerId: 1, player, team: null, streak: { stat, threshold, hits: 3, games: 3, values: [], average: threshold, minutes: 30 } })
  const rows = [mk('Scorer 20', 'pts', 20), mk('Rebounder 14', 'reb', 14), mk('Rebounder 6', 'reb', 6)]
  assert.deepEqual(sortRows(rows, 'level').map((r) => r.player), ['Rebounder 14', 'Scorer 20', 'Rebounder 6'])
  assert.deepEqual(sortRows(rows, 'name').map((r) => r.player), ['Rebounder 14', 'Rebounder 6', 'Scorer 20'])
})
