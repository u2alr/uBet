// Run: npm test. Schedule, rest, travel and workload facts: definitions, edge cases, and "unknown stays unknown".
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { haversineMiles, matchupSummary, teamFacts, workloadFacts, type PlayedGame, type UpcomingGame } from './schedule.ts'

const g = (id: string, date: string, home: string, away: string, overtime: boolean | null = false): PlayedGame => ({ id, date, homeAbbr: home, awayAbbr: away, overtime })
const up = (date: string, home: string, away: string, tipIso: string | null = null): UpcomingGame => ({ id: 'u', date, tipIso, homeAbbr: home, awayAbbr: away })

describe('rest and congestion', () => {
  it('rest days, back-to-back and its type (home-home is not road-road)', () => {
    const played = [g('1', '2026-10-20', 'BOS', 'NYK'), g('2', '2026-10-21', 'LAL', 'BOS')]
    const road = teamFacts('BOS', played, up('2026-10-22', 'LAC', 'BOS'))
    assert.deepEqual([road.restDays, road.backToBack, road.b2bType], [1, true, 'road_to_road'])
    const hh = teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK')], up('2026-10-21', 'BOS', 'MIA'))
    assert.deepEqual([hh.backToBack, hh.b2bType, hh.travel?.miles, hh.travel?.sameCity], [true, 'home_to_home', 0, true])
    assert.equal(teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK')], up('2026-10-21', 'MIA', 'BOS')).b2bType, 'home_to_road')
    assert.equal(teamFacts('BOS', [g('1', '2026-10-20', 'NYK', 'BOS')], up('2026-10-21', 'BOS', 'MIA')).b2bType, 'road_to_home')
  })
  it('three in four nights, four in six nights, and games in the last 7 and 14 days', () => {
    const played = [g('1', '2026-10-20', 'BOS', 'NYK'), g('2', '2026-10-21', 'BOS', 'MIA'), g('3', '2026-10-22', 'BOS', 'LAL')]
    const f = teamFacts('BOS', played, up('2026-10-24', 'BOS', 'DEN'))
    assert.deepEqual([f.threeInFour, f.fourInSix, f.gamesLast7, f.gamesLast14], [true, true, 3, 3], 'Oct 21, 22 and 24 is three games in four nights; Oct 20, 21, 22 and 24 is four in five')
    assert.equal(teamFacts('BOS', played.slice(0, 1), up('2026-10-24', 'BOS', 'DEN')).threeInFour, false)
    const t = teamFacts('BOS', played, up('2026-10-23', 'BOS', 'DEN'))
    assert.equal(t.threeInFour, true)
  })
  it('only games before the target date count, so the target game itself and later results cannot change anything', () => {
    const played = [g('1', '2026-10-20', 'BOS', 'NYK'), g('2', '2026-10-24', 'BOS', 'MIA'), g('3', '2026-10-30', 'BOS', 'LAL')]
    assert.equal(teamFacts('BOS', played, up('2026-10-24', 'BOS', 'MIA')).restDays, 4)
    assert.equal(teamFacts('BOS', played.slice(0, 1), up('2026-10-24', 'BOS', 'MIA')).restDays, 4)
  })
  it('a postponed game is absent, so the previous played game stays the previous game; duplicate records collapse', () => {
    const played = [g('1', '2026-10-20', 'BOS', 'NYK'), g('1', '2026-10-20', 'BOS', 'NYK')]
    const f = teamFacts('BOS', played, up('2026-10-24', 'BOS', 'MIA'))
    assert.deepEqual([f.restDays, f.gamesLast7], [4, 1])
  })
  it('overtime in the previous game is reported only when it is known', () => {
    assert.equal(teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK', true)], up('2026-10-22', 'BOS', 'MIA')).overtimeInPrevious, true)
    const unknown = teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK', null)], up('2026-10-22', 'BOS', 'MIA'))
    assert.equal(unknown.overtimeInPrevious, null); assert.ok(unknown.unknown.includes('overtime in the previous game'))
  })
  it('no previous game is unknown, not zero rest', () => {
    const f = teamFacts('BOS', [], up('2026-10-22', 'BOS', 'MIA'))
    assert.equal(f.restDays, null); assert.ok(f.unknown.includes('previous game'))
  })
})

describe('travel is an estimate, with direction, and it can be unknown', () => {
  it('Boston to Los Angeles is about 2,600 miles, westward, and labelled an estimate', () => {
    const f = teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK')], up('2026-10-22', 'LAL', 'BOS'))
    assert.ok(f.travel && f.travel.miles > 2500 && f.travel.miles < 2700)
    assert.deepEqual([f.travel!.tzShift, f.travel!.direction, f.travel!.label], [-3, 'west', 'estimate from city locations'])
    assert.equal(f.roadTripGames, 0)
  })
  it('the way home is eastward; same-city (LAL then LAC) is not travel; consecutive road games are counted', () => {
    const home = teamFacts('BOS', [g('1', '2026-10-20', 'LAL', 'BOS')], up('2026-10-23', 'BOS', 'MIA'))
    assert.equal(home.travel?.direction, 'east')
    const same = teamFacts('BOS', [g('1', '2026-10-20', 'LAL', 'BOS')], up('2026-10-21', 'LAC', 'BOS'))
    assert.equal(same.travel?.sameCity, true)
    const trip = teamFacts('BOS', [g('3', '2026-10-24', 'DEN', 'BOS'), g('2', '2026-10-22', 'LAC', 'BOS'), g('1', '2026-10-21', 'LAL', 'BOS'), g('0', '2026-10-19', 'BOS', 'NYK')], up('2026-10-26', 'PHX', 'BOS'))
    assert.equal(trip.roadTripGames, 3)
  })
  it('an unknown team code, a long gap, or a missing location gives unknown travel, never a guess', () => {
    assert.equal(teamFacts('BOS', [g('1', '2026-10-20', 'XXX', 'BOS')], up('2026-10-21', 'LAL', 'BOS')).travel, null)
    const gap = teamFacts('BOS', [g('1', '2026-06-20', 'BOS', 'NYK')], up('2026-10-21', 'LAL', 'BOS'))
    assert.equal(gap.travel, null); assert.ok(gap.unknown.some((u) => /more than 10 days/.test(u)))
    assert.equal(gap.restDays, 10, 'capped')
    const noGame = teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK')], up('2026-10-21', 'ZZZ', 'BOS'))
    assert.ok(noGame.unknown.includes('game location') && noGame.elevation.gameFt === null)
  })
  it('neutral-site and unusual games cannot be identified, so a game keeps its designated home city', () => {
    const f = teamFacts('BOS', [g('1', '2026-10-20', 'NYK', 'BOS')], up('2026-10-21', 'BOS', 'NYK'))      // e.g. a designated-home game played elsewhere is not detectable
    assert.ok(f.travel)
  })
  it('altitude: the game location and the climb from the previous one', () => {
    const f = teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK')], up('2026-10-22', 'DEN', 'BOS'))
    assert.deepEqual([f.elevation.gameFt, f.elevation.climbFt], [5280, 5260])
  })
  it('hours since the previous game is a labelled range from dates, and unknown without a tip-off time', () => {
    const f = teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK')], up('2026-10-21', 'MIA', 'BOS', '2026-10-21T23:00:00Z'))
    assert.ok(f.hoursSinceRange)
    const [lo, hi] = f.hoursSinceRange!
    assert.ok(lo > 10 && hi < 30 && lo < hi, `${lo} to ${hi}`)
    assert.ok(teamFacts('BOS', [g('1', '2026-10-20', 'BOS', 'NYK')], up('2026-10-21', 'MIA', 'BOS')).unknown.some((u) => /tip-off time unknown/.test(u)))
  })
  it('a gap of more than ten days (the offseason) gives no hours range and no travel', () => {
    const f = teamFacts('BOS', [g('1', '2026-05-03', 'DET', 'BOS')], up('2026-10-21', 'MIA', 'BOS', '2026-10-21T23:00:00Z'))
    assert.equal(f.restDays, 10); assert.equal(f.hoursSinceRange, null); assert.equal(f.travel, null)
  })
  it('haversine is symmetric and zero for the same point', () => {
    const a = { lat: 42.366, lon: -71.062 }, b = { lat: 34.043, lon: -118.267 }
    assert.equal(haversineMiles(a, a), 0)
    assert.ok(Math.abs(haversineMiles(a, b) - haversineMiles(b, a)) < 1e-9)
  })
})

describe('matchup summary: observations and flags, never a probability', () => {
  it('flags a rest-and-travel disadvantage (here about 830 miles from Los Angeles to Denver, against a rested home team)', () => {
    const away = teamFacts('BOS', [g('1', '2026-10-24', 'LAL', 'BOS')], up('2026-10-25', 'DEN', 'BOS'))
    const home = teamFacts('DEN', [g('2', '2026-10-22', 'DEN', 'MIA')], up('2026-10-25', 'DEN', 'BOS'))
    const m = matchupSummary(away, home)
    assert.equal(m.restEdge, 'home'); assert.equal(m.restDifferenceDays, 2)
    assert.equal(m.flags.length, 1); assert.equal(m.flags[0].team, 'BOS')
  })
  it('the stated example: Team A played last night on the road and flew far; Team B has been home two days', () => {
    const a = teamFacts('MIA', [g('1', '2026-10-24', 'LAL', 'MIA')], up('2026-10-25', 'BOS', 'MIA'))
    const b = teamFacts('BOS', [g('2', '2026-10-23', 'BOS', 'NYK')], up('2026-10-25', 'BOS', 'MIA'))
    const m = matchupSummary(a, b)
    assert.equal(m.flags.length, 1); assert.equal(m.flags[0].team, 'MIA'); assert.match(m.flags[0].reason, /played yesterday and travelled an estimated/)
    assert.ok(m.notes.some((n) => /an estimate/.test(n)))
    assert.doesNotMatch(JSON.stringify(m), /probab|%/i, 'no probability penalty is ever attached')
  })
  it('unknown rest makes the edge unknown instead of even', () => {
    const none = teamFacts('BOS', [], up('2026-10-25', 'BOS', 'MIA'))
    const some = teamFacts('MIA', [g('1', '2026-10-23', 'MIA', 'NYK')], up('2026-10-25', 'BOS', 'MIA'))
    assert.equal(matchupSummary(some, none).restEdge, 'unknown')
  })
})

describe('player workload against his own baseline', () => {
  const games = (mins: number[], start = '2026-10-10') => mins.map((m, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 2 * 86400_000).toISOString().slice(0, 10), minutes: m }))
  it('a 44-minute game is heavy for a 36-minute starter and a 22-minute game is heavy for a 14-minute reserve: the same assessment for the same departure', () => {
    const star = workloadFacts(games([36, 36, 36, 36, 36, 44]), '2026-10-24'), bench = workloadFacts(games([14, 14, 14, 14, 14, 22]), '2026-10-24')
    assert.equal(star.heavyLastGame, true); assert.equal(bench.heavyLastGame, true)
    assert.equal(workloadFacts(games([36, 36, 36, 36, 36, 38]), '2026-10-24').heavyLastGame, false)
    assert.equal(workloadFacts(games([14, 14, 14, 14, 14, 16]), '2026-10-24').heavyLastGame, false)
  })
  it('cumulative minutes use only dates before the target; a player returning after a gap is a possibility with no reason attached', () => {
    const w = workloadFacts([{ date: '2026-10-22', minutes: 30 }, { date: '2026-10-20', minutes: 30 }, { date: '2026-10-10', minutes: 30 }, { date: '2026-10-25', minutes: 40 }], '2026-10-24')
    assert.deepEqual(w.cumulative, { d3: 30, d5: 60, d7: 60, d14: 90 })
    const back = workloadFacts([{ date: '2026-10-05', minutes: 30 }, { date: '2026-10-03', minutes: 30 }], '2026-10-20')
    assert.equal(back.returning, 'possible'); assert.equal(back.daysSincePrevious, 15)
    assert.doesNotMatch(JSON.stringify(back), /injur|illness|suspen/i)
  })
  it('with too few games the baseline is unknown, and with none everything is unknown', () => {
    const few = workloadFacts(games([30, 30]), '2026-10-24')
    assert.equal(few.heavyLastGame, null); assert.ok(few.unknown.length > 0)
    const none = workloadFacts([], '2026-10-24')
    assert.deepEqual([none.returning, none.lastGameMinutes], ['unknown', null])
  })
  it('zero-minute rows (did not play) are not games', () => {
    assert.equal(workloadFacts([{ date: '2026-10-22', minutes: 0 }, { date: '2026-10-20', minutes: 30 }], '2026-10-24').lastGameMinutes, 30)
  })
})
