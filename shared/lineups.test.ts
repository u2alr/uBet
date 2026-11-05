import { test } from 'node:test'
import assert from 'node:assert/strict'
import rates from './statusPlayRates.json' with { type: 'json' }
import { buildLineup, cleanReason, historyLine, nameKey, officialDisplay, officialKey, officialListings, reportAgeHours, reportState, type Candidate, type OfficialRow } from './lineups.ts'

const roster: Candidate[] = [
  { id: 1, name: 'Star One', avgMin: 36 }, { id: 2, name: 'Guard Two', avgMin: 34 }, { id: 3, name: 'Wing Three', avgMin: 31 }, { id: 4, name: 'Big Four', avgMin: 29 },
  { id: 5, name: 'Forward Five', avgMin: 28 }, { id: 6, name: 'Sixth Man', avgMin: 24 }, { id: 7, name: 'Seventh Guy', avgMin: 20 }, { id: 8, name: 'Eighth Guy', avgMin: 15 },
  { id: 9, name: 'Ninth Guy', avgMin: 9 }, { id: 10, name: 'Never Played', avgMin: 0 },
]
const DAY = '2026-11-04'
const MATCHUP = 'WAS@ATL'
const row = (player: string, status: string, reason: string | null = null, team = 'ATL', game_date: string | null = DAY, matchup: string | null = MATCHUP): OfficialRow => ({ team, player, status, reason, game_date, matchup })
const lineup = (rows: OfficialRow[], team = 'ATL', date = DAY, matchup = MATCHUP, asOf = '2026-11-04 17:30') =>
  buildLineup(roster, officialListings(rows, team, date, matchup), reportState(rows, team, date, matchup), asOf)

test('names match across the roster spelling and the PDF spelling, accents and suffixes included', () => {
  assert.equal(nameKey('Jaren Jackson Jr.'), officialKey('JacksonJr.,Jaren'))
  assert.equal(nameKey('Nikola Jokić'), officialKey('Jokic,Nikola'))
  assert.equal(nameKey('Yanic Konan Niederhauser'), officialKey('Niederhauser,YanicKonan'))
  assert.equal(nameKey('Jimmy Butler III'), officialKey('ButlerIII,Jimmy'))
  assert.notEqual(nameKey('Jalen Johnson'), nameKey('Jalen Green'))
})

test('a name the PDF ran together is spaced once, a suffix included', () => {
  assert.equal(officialDisplay('Niederhauser,YanicKonan'), 'Yanic Konan Niederhauser')
  assert.equal(officialDisplay('ButlerIII,Jimmy'), 'Jimmy Butler III')
  assert.equal(officialDisplay('CenacJr.,Christopher'), 'Christopher Cenac Jr.')
  assert.equal(officialDisplay('Trent Jr.,Gary'), 'Gary Trent Jr.')
})

test('with no entry at all the default lineup is shown: five by minutes, the next three, and no flags', () => {
  const l = lineup([])
  assert.deepEqual(l.starters.map((p) => p.name), ['Star One', 'Guard Two', 'Wing Three', 'Big Four', 'Forward Five'])
  assert.deepEqual(l.nextUp.map((p) => p.name), ['Sixth Man', 'Seventh Guy', 'Eighth Guy'])
  assert.equal(l.state, 'absent')
  assert.equal(l.asOf, null)
  assert.ok(![...l.starters, ...l.nextUp].some((p) => p.listing), 'no flags without a report')
  assert.equal(l.alsoListed.length, 0)
  assert.ok(!l.starters.some((p) => p.name === 'Never Played'), 'a player with no minutes is never a starter')
})

test('a team the report says has not filed shows the default lineup with no flags, even if the other team has players listed', () => {
  const rows = [row('Two,Guard', 'Out', null, 'WAS'), row('', 'NOT_SUBMITTED', null, 'ATL')]
  const l = lineup(rows, 'ATL')
  assert.equal(l.state, 'not_submitted')
  assert.ok(![...l.starters, ...l.nextUp].some((p) => p.listing))
  assert.equal(lineup(rows, 'WAS').state, 'listed')
})

test('a game on the report where this team has nobody listed is clear, and shows the default lineup', () => {
  const l = lineup([row('Two,Guard', 'Out', null, 'WAS')], 'ATL')
  assert.equal(l.state, 'clear')
  assert.equal(l.asOf, '2026-11-04 17:30', 'the report time is shown: the league did publish this game')
  assert.ok(![...l.starters, ...l.nextUp].some((p) => p.listing))
})

test('a listed starter keeps his place with the flag and the reason, and the official name is matched to the roster', () => {
  const l = lineup([row('One,Star', 'Out', 'Injury/Illness-LeftAnkleSprain')])
  assert.equal(l.state, 'listed')
  assert.equal(l.starters[0].name, 'Star One')
  assert.equal(l.starters[0].listing?.status, 'out')
  assert.equal(l.starters[0].listing?.reason, 'Left Ankle Sprain')
  assert.equal(l.asOf, '2026-11-04 17:30')
})

test('only rows for THIS game count: the same team on another day or in another game is never used', () => {
  const rows = [
    row('One,Star', 'Out', null, 'ATL', '2026-11-03', 'WAS@ATL'),     // yesterday's game
    row('Two,Guard', 'Out', null, 'ATL', DAY, 'ATL@BOS'),             // another game today
    row('Three,Wing', 'Questionable', null, 'ATL', DAY, MATCHUP),      // this game
  ]
  const l = lineup(rows)
  assert.equal(l.starters[0].listing, null, 'yesterday is ignored')
  assert.equal(l.starters[1].listing, null, 'another matchup is ignored')
  assert.equal(l.starters[2].listing?.status, 'questionable')
  assert.equal(reportState(rows, 'ATL', '2026-11-09', MATCHUP), 'absent', 'a game the report does not have')
})

test('the next men up skip anyone listed Out or Doubtful, who still show as listed, worst first', () => {
  const l = lineup([row('Man,Sixth', 'Out'), row('Guy,Seventh', 'Doubtful')])
  assert.deepEqual(l.nextUp.map((p) => p.name), ['Eighth Guy', 'Ninth Guy'])
  assert.deepEqual(l.alsoListed.map((a) => a.name), ['Sixth Man', 'Seventh Guy'])
})

test('Available is not a flag and a G League assignment is not shown as an injury', () => {
  const rows = [row('Three,Wing', 'Available'), row('Ghost,Rookie', 'Out', 'GLeague-Two-Way')]
  const l = lineup(rows)
  assert.equal(l.state, 'clear', 'neither is something to flag')
  assert.equal(l.alsoListed.length, 0)
})

test('last played and games missed ride along with each player', () => {
  const withDates: Candidate[] = [{ id: 1, name: 'Star One', avgMin: 36, lastPlayed: '2026-11-02', missed: 2 }, { id: 2, name: 'Guard Two', avgMin: 30 }]
  const rows = [row('One,Star', 'Out')]
  const l = buildLineup(withDates, officialListings(rows, 'ATL', DAY, MATCHUP), reportState(rows, 'ATL', DAY, MATCHUP), '2026-11-05 02:15')
  assert.equal(l.starters[0].lastPlayed, '2026-11-02')
  assert.equal(l.starters[0].missed, 2)
  assert.equal(l.starters[1].lastPlayed, null, 'a player with no dates gets null, not a guess')
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

test('the measured play rates are sane: each status has a real sample, and Out < Doubtful < Questionable < Probable', () => {
  const r = rates.rates
  for (const s of ['out', 'doubtful', 'questionable', 'probable'] as const) assert.ok(r[s].n >= 500, `${s} has only ${r[s].n} listings`)
  assert.ok(r.out.played < 0.01, 'a player listed Out almost never plays')
  assert.ok(r.out.played < r.doubtful.played && r.doubtful.played < r.questionable.played && r.questionable.played < r.probable.played)
  assert.ok(r.questionable.played > 0.35 && r.questionable.played < 0.65, 'Questionable is close to a coin flip')
  assert.match(rates.seasons, /^20\d\d-\d\d to 20\d\d-\d\d$/)
})

test('the history line says it is a measurement, with the sample and the seasons, and rounds the extremes in words', () => {
  const h = { seasons: '2020-21 to 2025-26', rates: { out: { n: 37873, played: 0.001 }, doubtful: { n: 932, played: 0.025 }, questionable: { n: 6667, played: 0.504 }, probable: { n: 2429, played: 0.907 } } }
  assert.equal(historyLine('questionable', h), 'Players listed Questionable have played 50% of the time (6,667 listings, 2020-21 to 2025-26)')
  assert.match(historyLine('out', h), /almost never \(37,873 listings/)
  assert.match(historyLine('probable', h), /91% of the time/)
  assert.match(historyLine('probable', { ...h, rates: { ...h.rates, probable: { n: 10, played: 0.999 } } }), /almost always/)
})
