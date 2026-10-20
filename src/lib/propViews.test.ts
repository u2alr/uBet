import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PROP_VIEWS, isSingle, viewValue } from './propViews.ts'
import { TEAMS, teamByName, teamId } from './teams.ts'

const game = { pts: 20, reb: 7, ast: 5, fg3m: 3, stl: 1, blk: 2 } as never

test('combination props add the right box-score columns', () => {
  const v = (k: string) => viewValue(game, k as never)
  assert.equal(v('pra'), 32)
  assert.equal(v('pr'), 27)
  assert.equal(v('pa'), 25)
  assert.equal(v('ra'), 12)
  assert.equal(v('pts'), 20)
  assert.equal(v('fg3m'), 3)
  assert.equal(v('blk'), 2)
})

test('only single statistics are treated as having book lines', () => {
  assert.deepEqual(PROP_VIEWS.filter((p) => isSingle(p.key)).map((p) => p.key), ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk'])
})

test('all 30 teams are present with unique ids, and names resolve either way the sources spell them', () => {
  assert.equal(TEAMS.length, 30)
  assert.equal(new Set(TEAMS.map((t) => t[1])).size, 30)
  assert.equal(new Set(TEAMS.map((t) => t[0])).size, 30)
  assert.equal(teamId('OKC'), 1610612760)
  assert.equal(teamId('XXX'), null)
  assert.equal(teamByName('Los Angeles Clippers')?.[0], 'LAC')
  assert.equal(teamByName('LA Clippers')?.[0], 'LAC')
  assert.equal(teamByName('Oklahoma City Thunder')?.[0], 'OKC')
})
