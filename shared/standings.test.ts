import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStandings, seedZone } from './standings.ts'

const entry = (abbr: string, name: string, seed: number, w: number, l: number) => ({
  team: { abbreviation: abbr, displayName: name },
  stats: [{ name: 'playoffSeed', value: seed }, { name: 'wins', value: w }, { name: 'losses', value: l }, { name: 'winPercent', value: w / (w + l || 1) },
    { name: 'Home', displayValue: '2-0' }, { name: 'Last Ten Games', displayValue: `${w}-${l}` }, { name: 'streak', displayValue: 'W2' }, { name: 'pointDifferential', value: 12 }],
})

test('conferences are parsed, ordered by seed, with ESPN abbreviations normalised', () => {
  const out = parseStandings({ children: [
    { name: 'Western Conference', standings: { entries: [entry('GS', 'Golden State Warriors', 2, 3, 1), entry('OKC', 'Oklahoma City Thunder', 1, 4, 0)] } },
    { name: 'Eastern Conference', standings: { entries: [entry('NY', 'New York Knicks', 1, 2, 2)] } },
  ] })
  assert.deepEqual(out.map((c) => c.name), ['Western', 'Eastern'])
  assert.deepEqual(out[0].rows.map((r) => r.abbr), ['OKC', 'GSW'])
  assert.equal(out[1].rows[0].abbr, 'NYK')
  assert.equal(out[0].rows[1].last10, '3-1')
})

test('junk and missing data never throw: unknown shapes give an empty list, bad rows are skipped', () => {
  for (const bad of [null, undefined, 5, 'x', {}, { children: 'no' }, { children: [null] }]) assert.deepEqual(parseStandings(bad as never).flatMap((c) => c.rows), [])
  const out = parseStandings({ children: [{ name: 'X Conference', standings: { entries: [{ team: {} }, { stats: [] }, entry('BOS', 'Boston Celtics', 1, 1, 0)] } }] })
  assert.equal(out[0].rows.length, 1)
})

test('seed zones follow the 6 + 4 play-in format', () => {
  assert.deepEqual([1, 6, 7, 10, 11, 15].map(seedZone), ['playoffs', 'playoffs', 'play-in', 'play-in', 'out', 'out'])
})
