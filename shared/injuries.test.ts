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

test('absences list Out, Doubtful, Questionable and Day-To-Day players matched to the roster by name, most serious first', async () => {
  const { listAbsences } = await import('./injuries.ts')
  const inj = new Map([
    ['paolo banchero', { status: 'out' as const, label: 'Out', note: 'knee' }],
    ['franz wagner', { status: 'questionable' as const, label: 'Questionable', note: '' }],
    ['jalen suggs', { status: 'day-to-day' as const, label: 'Day-To-Day', note: '' }],
    ['someone else', { status: 'out' as const, label: 'Out', note: '' }],
  ])
  const roster = [{ id: 1, name: 'Franz Wagner', team: 'ORL' }, { id: 2, name: 'Paolo Banchero', team: 'ORL' }, { id: 3, name: 'Jalen Suggs', team: 'ORL' }, { id: 4, name: 'Healthy Guy', team: 'ORL' }]
  const out = listAbsences(roster, inj)
  assert.deepEqual(out.map((a) => [a.name, a.status]), [['Paolo Banchero', 'out'], ['Franz Wagner', 'questionable'], ['Jalen Suggs', 'day-to-day']])
  assert.equal(out[0].note, 'knee')
  assert.deepEqual(listAbsences([], inj), [])
})

test('absences take the club from the report, and report a listed player the roster does not have', async () => {
  const { listAbsences } = await import('./injuries.ts')
  const withTeam = { injuries: [{ displayName: 'Portland Trail Blazers', injuries: [{ status: 'Out', shortComment: 'ankle', athlete: { displayName: 'Shaedon Sharpe' } }] }, { displayName: 'Orlando Magic', injuries: [{ status: 'Day-To-Day', athlete: { displayName: 'Jalen Suggs' } }] }] }
  const abbr = (n: string) => ({ 'Portland Trail Blazers': 'POR', 'Orlando Magic': 'ORL' } as Record<string, string>)[n] ?? null
  const out = listAbsences([{ id: 3, name: 'Jalen Suggs', team: 'ATL' }], parseInjuries(withTeam), abbr)
  assert.deepEqual(out.map((a) => [a.name, a.team, a.status, a.id < 0]), [['Shaedon Sharpe', 'POR', 'out', true], ['Jalen Suggs', 'ORL', 'day-to-day', false]])
  assert.deepEqual(listAbsences([], parseInjuries(withTeam)), [])
})
