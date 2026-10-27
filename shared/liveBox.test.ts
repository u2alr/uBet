import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLiveBox } from './liveBox.ts'

const feed = {
  header: { competitions: [{ status: { type: { state: 'in', shortDetail: 'Q3 4:12' } } }] },
  boxscore: { players: [{
    team: { abbreviation: 'OKC' },
    statistics: [{ names: ['MIN', 'PTS', 'REB', 'AST', '3PT'], athletes: [
      { athlete: { id: '1', displayName: 'Shai Gilgeous-Alexander' }, starter: true, stats: ['30', '28', '5', '7', '2-6'] },
      { athlete: { id: '2', displayName: 'Bench Guy' }, stats: ['0', '0', '0', '0', '0-0'] },
      { athlete: { id: '3', displayName: 'No Stats' }, stats: [] },
    ] }],
  }] },
}

test('parses a live box score', () => {
  const box = parseLiveBox(feed)!
  assert.equal(box.state, 'in')
  assert.equal(box.status, 'Q3 4:12')
  assert.equal(box.teams[0].abbr, 'OKC')
  const shai = box.teams[0].players.find((p) => p.id === 1)!
  assert.deepEqual([shai.minutes, shai.pts, shai.reb, shai.ast, shai.fg3m, shai.starter], [30, 28, 5, 7, 2, true])
})

test('drops players with zero minutes and no points, keeps missing stats as null', () => {
  const players = parseLiveBox(feed)!.teams[0].players
  assert.ok(!players.some((p) => p.id === 2))
  assert.equal(players.find((p) => p.id === 3)!.pts, null)
})

test('returns null for an unusable feed', () => {
  assert.equal(parseLiveBox({}), null)
  assert.equal(parseLiveBox(null), null)
})
