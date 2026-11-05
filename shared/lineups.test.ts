import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Injury } from './injuries.ts'
import { buildLineup, cleanReason, espnListings, nameKey, officialDisplay, officialKey, officialListings, reportAgeHours, type Candidate, type OfficialRow } from './lineups.ts'

const roster: Candidate[] = [
  { id: 1, name: 'Star One', avgMin: 36 }, { id: 2, name: 'Guard Two', avgMin: 34 }, { id: 3, name: 'Wing Three', avgMin: 31 }, { id: 4, name: 'Big Four', avgMin: 29 },
  { id: 5, name: 'Forward Five', avgMin: 28 }, { id: 6, name: 'Sixth Man', avgMin: 24 }, { id: 7, name: 'Seventh Guy', avgMin: 20 }, { id: 8, name: 'Eighth Guy', avgMin: 15 },
  { id: 9, name: 'Ninth Guy', avgMin: 9 }, { id: 10, name: 'Never Played', avgMin: 0 },
]
const row = (player: string, status: string, reason: string | null = null, team = 'ATL', game_date: string | null = '2026-11-04'): OfficialRow => ({ team, player, status, reason, game_date })

test('names match across the roster spelling and the PDF spelling, accents and suffixes included', () => {
  assert.equal(nameKey('Jaren Jackson Jr.'), officialKey('JacksonJr.,Jaren'))
  assert.equal(nameKey('Nikola Jokić'), officialKey('Jokic,Nikola'))
  assert.equal(nameKey('Yanic Konan Niederhauser'), officialKey('Niederhauser,YanicKonan'))
  assert.notEqual(nameKey('Jalen Johnson'), nameKey('Jalen Green'))
})

test('a name the PDF ran together is made readable', () => {
  assert.equal(officialDisplay('Niederhauser,YanicKonan'), 'Yanic Konan Niederhauser')
  assert.equal(officialDisplay('Gueye,Mouhamed'), 'Mouhamed Gueye')
})

test('the five starters are the five with the most minutes, in that order, and the next three are the bench', () => {
  const l = buildLineup(roster, null, new Map())
  assert.deepEqual(l.starters.map((p) => p.name), ['Star One', 'Guard Two', 'Wing Three', 'Big Four', 'Forward Five'])
  assert.deepEqual(l.nextUp.map((p) => p.name), ['Sixth Man', 'Seventh Guy', 'Eighth Guy'])
  assert.equal(l.source, 'none')
  assert.ok(!l.starters.some((p) => p.name === 'Never Played'), 'a player with no minutes is never a starter')
})

test('a starter listed Out stays in the five with the flag, and the replacement comes from the bench, not from an Out player', () => {
  const off = officialListings([row('One,Star', 'Out', 'Injury/Illness-LeftAnkleSprain'), row('Two,Sixth', 'Out')], 'ATL', '2026-11-04')
  const fixed = [{ ...roster[0], name: 'Star One' }]
  assert.ok(off)
  const l = buildLineup([...fixed, ...roster.slice(1).map((r) => (r.name === 'Sixth Man' ? { ...r, name: 'Sixth Man' } : r))], new Map([[nameKey('Star One'), off!.get(officialKey('One,Star'))!]]), new Map())
  assert.equal(l.starters[0].listing?.status, 'out')
  assert.equal(l.starters[0].listing?.reason, 'Left Ankle Sprain')
  assert.equal(l.source, 'official')
})

test('the next men up skip anyone listed Out or Doubtful', () => {
  const listings = new Map([
    [nameKey('Sixth Man'), { status: 'out' as const, reason: '', source: 'official' as const, display: 'Sixth Man' }],
    [nameKey('Seventh Guy'), { status: 'doubtful' as const, reason: '', source: 'official' as const, display: 'Seventh Guy' }],
  ])
  const l = buildLineup(roster, listings, new Map())
  assert.deepEqual(l.nextUp.map((p) => p.name), ['Eighth Guy', 'Ninth Guy'])
  assert.deepEqual(l.alsoListed.map((a) => a.name), ['Sixth Man', 'Seventh Guy'], 'the ones skipped still show as listed, worst first')
})

test('a team that has filed with the league is taken from that report alone: a stale ESPN entry does not come back', () => {
  const off = officialListings([row('Two,Guard', 'Questionable')], 'ATL', '2026-11-04')
  const espnFeed = new Map<string, Injury>([['star one', { status: 'out', label: 'Out', note: 'stale', team: 'Atlanta Hawks', name: 'Star One' }]])
  const espn = espnListings(espnFeed, () => true)
  const l = buildLineup(roster, off, espn)
  assert.equal(l.source, 'official')
  assert.equal(l.starters[0].listing, null, 'Star One is not on the league report, so no flag')
  assert.equal(l.starters[1].listing?.status, 'questionable')
})

test('a team the league has not filed for falls back to ESPN, and day-to-day reads as game-time', () => {
  assert.equal(officialListings([row('Two,Guard', 'Out', null, 'BOS')], 'ATL', '2026-11-04'), null)
  const espn = espnListings(new Map<string, Injury>([['guard two', { status: 'day-to-day', label: 'Day-To-Day', note: 'knee', team: 'Atlanta Hawks', name: 'Guard Two' }]]), () => true)
  const l = buildLineup(roster, null, espn)
  assert.equal(l.source, 'espn')
  assert.equal(l.starters[1].listing?.status, 'gtd')
})

test('rows for another game date are ignored, Available is not a flag, and a G League assignment is not listed as an injury', () => {
  const off = officialListings([row('Two,Guard', 'Out', null, 'ATL', '2026-11-05'), row('Three,Wing', 'Available'), row('Ghost,Rookie', 'Out', 'GLeague-Two-Way')], 'ATL', '2026-11-04')
  assert.ok(off)
  assert.equal(off!.size, 1, 'only the G League row survives parsing; the other date and Available are out')
  const l = buildLineup(roster, off, new Map())
  assert.equal(l.alsoListed.length, 0, 'a G League assignment is not shown')
})

test('reasons are made readable', () => {
  assert.equal(cleanReason('Injury/Illness-LeftFootFracture'), 'Left Foot Fracture')
  assert.equal(cleanReason(null), '')
  assert.equal(cleanReason('GLeague-Two-Way'), 'G League')
})

test('a report older than a day and a half is detectable and an unreadable stamp gives null', () => {
  const now = Date.UTC(2026, 10, 5, 12, 0)
  assert.ok(reportAgeHours('2026-11-05 06:00', now)! < 12)
  assert.ok(reportAgeHours('2026-11-03 06:00', now)! > 36)
  assert.equal(reportAgeHours('nope', now), null)
})
