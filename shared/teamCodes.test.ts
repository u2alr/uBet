import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ESPN_TO_NBA, NBA_ABBRS, isNbaAbbr, normAbbr } from './teamCodes.ts'
import { TEAM_NAMES } from './picks.ts'
import { parseStandings } from './standings.ts'

test('every ESPN code that differs maps to a real NBA.com code, and NBA.com codes pass through unchanged', () => {
  for (const [espn, nba] of Object.entries(ESPN_TO_NBA)) { assert.ok(isNbaAbbr(nba), `${espn} -> ${nba}`); assert.equal(normAbbr(espn), nba) }
  for (const a of NBA_ABBRS) assert.equal(normAbbr(a), a)
  assert.equal(normAbbr('XYZ'), 'XYZ')
})

test('the list of NBA codes is the list the rest of the app knows, with no duplicates', () => {
  assert.deepEqual([...NBA_ABBRS].sort(), Object.keys(TEAM_NAMES).sort())
  assert.equal(new Set(NBA_ABBRS).size, 30)
})

test('the standings parser uses the same mapping', () => {
  const feed = { children: [{ name: 'West Conference', standings: { entries: [{ team: { abbreviation: 'UTAH', displayName: 'Utah Jazz' }, stats: [] }] } }] }
  assert.equal(parseStandings(feed)[0].rows[0].abbr, normAbbr('UTAH'))
})

test('the Python projection job reads the same file, not its own copy', () => {
  const py = readFileSync(new URL('../research/project.py', import.meta.url), 'utf8')
  assert.match(py, /teamCodes\.json/)
  assert.doesNotMatch(py, /ESPN_TO_NBA\s*=\s*\{/)
})
