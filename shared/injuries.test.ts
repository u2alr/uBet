import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annotateInjuries, parseInjuries, roleFromMinutes, type Injury } from './injuries.ts'

const feed = (rows: [string, string, string?][]) => ({ injuries: [{ injuries: rows.map(([n, s, c]) => ({ status: s, shortComment: c, athlete: { displayName: n } })) }] })

test('parses statuses, accents and picks the most serious entry for a player', () => {
  const m = parseInjuries(feed([['Nikola Jokić', 'Day-To-Day'], ['Nikola Jokić', 'Out', 'knee'], ['Jaylen Brown', 'Questionable'], ['A B', 'Out For Season'], ['C D', 'Doubtful'], ['E F', 'Probable']]))
  assert.equal(m.get('nikola jokic')?.status, 'out')
  assert.equal(m.get('nikola jokic')?.note, 'knee')
  assert.equal(m.get('jaylen brown')?.status, 'questionable')
  assert.equal(m.get('a b')?.status, 'out')
  assert.equal(m.get('c d')?.status, 'doubtful')
  assert.equal(m.get('e f')?.status, 'other')
})

test('malformed feeds give an empty map instead of throwing', () => {
  for (const bad of [null, undefined, 5, 'x', {}, { injuries: 'no' }, { injuries: [null, { injuries: 3 }, { injuries: [{}, { status: 'Out' }, { athlete: {} }] }] }])
    assert.equal(parseInjuries(bad).size, 0)
})

test('a pick on a player who is Out is dropped and named; others keep their pick with the status', () => {
  const inj = parseInjuries(feed([['Out Guy', 'Out'], ['Maybe Guy', 'Questionable', 'ankle']]))
  const picks = [{ player: 'Out Guy' }, { player: 'Maybe Guy' }, { player: 'Healthy Guy' }, { player: 'Out Guy' }] as { player: string; injury?: Injury | null }[]
  const r = annotateInjuries(picks, inj)
  assert.deepEqual(r.dropped, ['Out Guy'])
  assert.deepEqual(r.picks.map((p) => p.player), ['Maybe Guy', 'Healthy Guy'])
  assert.equal(r.picks[0].injury?.status, 'questionable')
  assert.equal(r.picks[1].injury, null)
})

test('roles come from the last 10 games of minutes, with a trend once there are 8', () => {
  assert.equal(roleFromMinutes([30, 31]), null)
  assert.equal(roleFromMinutes([34, 33, 35])?.label, 'Starter')
  assert.equal(roleFromMinutes([22, 24, 21])?.label, 'Rotation')
  assert.equal(roleFromMinutes([12, 14, 11])?.label, 'Bench')
  assert.equal(roleFromMinutes([4, 6, 3])?.label, 'Fringe')
  assert.equal(roleFromMinutes([28, 28, 28])?.label, 'Starter')           // the boundary is inclusive
  const up = roleFromMinutes([30, 30, 30, 30, 30, 20, 20, 20, 20, 20])!
  assert.equal(up.trend, 10)
  assert.equal(roleFromMinutes([30, 30, 30])!.trend, null)
})

test('impossible minutes are ignored rather than averaged in', () => {
  const r = roleFromMinutes([-4, 0, 99, 30, 30, 30])!
  assert.equal(r.games, 3)
  assert.equal(r.min10, 30)
})
