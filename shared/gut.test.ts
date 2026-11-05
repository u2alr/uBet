import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MIN_DISAGREEMENTS, gutKey, isOpen, parsePick, scoreGut, scoreboardResults, wilson, type GutResult } from './gut.ts'

const row = (pick: 'home' | 'away', homeWon: boolean, modelHomeProb: number | null, level: 1 | 2 | 3 = 1): GutResult =>
  ({ source: 'claude', date: '2026-11-04', home: 'DET', away: 'PHI', pick, level, note: null, modelHomeProb, savedAt: '2026-11-04T12:00:00Z', homeWon })

describe('parsePick', () => {
  it('accepts a normal pick and trims and caps the note', () => {
    const r = parsePick({ date: '2026-11-04', home: 'DET', away: 'PHI', pick: 'away', level: 2, note: `  ${'x'.repeat(400)}  ` })
    assert.ok(r.ok)
    if (r.ok) { assert.equal(r.value.note?.length, 300); assert.equal(r.value.pick, 'away') }
  })
  it('rejects anything that is not exactly a pick', () => {
    for (const b of [null, [], 'x', {}, { date: '2026-11-04', home: 'DET', away: 'DET', pick: 'home', level: 1 }, { date: '11/04', home: 'DET', away: 'PHI', pick: 'home', level: 1 },
      { date: '2026-11-04', home: 'det', away: 'PHI', pick: 'home', level: 1 }, { date: '2026-11-04', home: 'DET', away: 'PHI', pick: 'draw', level: 1 },
      { date: '2026-11-04', home: 'DET', away: 'PHI', pick: 'home', level: 4 }, { date: '2026-11-04', home: 'DET', away: 'PHI', pick: 'home', level: '1' },
      { date: '2026-11-04', home: 'DET', away: 'PHI', pick: 'home', level: 1, note: 5 }])
      assert.equal(parsePick(b).ok, false, JSON.stringify(b))
  })
  it('the author is always Claude, and a pick claiming another author is refused', () => {
    const base = { date: '2026-11-04', home: 'DET', away: 'PHI', pick: 'home', level: 1 }
    const r = parsePick(base)
    assert.ok(r.ok && r.value.source === 'claude')
    const c = parsePick({ ...base, source: 'claude' })
    assert.ok(c.ok && c.value.source === 'claude')
    assert.equal(parsePick({ ...base, source: 'you' }).ok, false)
  })
  it('treats an empty note as no note', () => {
    const r = parsePick({ date: '2026-11-04', home: 'DET', away: 'PHI', pick: 'home', level: 1, note: '   ' })
    assert.ok(r.ok && r.value.note === null)
  })
})

describe('isOpen', () => {
  it('is open before tip-off and closed from tip-off on, and closed for a bad time', () => {
    const tip = '2026-11-04T19:00:00Z'
    assert.equal(isOpen(tip, Date.parse('2026-11-04T18:59:59Z')), true)
    assert.equal(isOpen(tip, Date.parse('2026-11-04T19:00:00Z')), false)
    assert.equal(isOpen('nonsense', 0), false)
  })
})

describe('wilson', () => {
  it('is wide at small n and stays inside 0..1', () => {
    const [lo, hi] = wilson(1, 1)!
    assert.ok(lo > 0.2 && hi === 1)
    assert.equal(wilson(0, 0), null)
    const [l2, h2] = wilson(60, 100)!
    assert.ok(l2 > 0.5 && h2 < 0.7)
  })
})

describe('scoreGut', () => {
  it('counts the gut\'s hits overall and by confidence level, and the model\'s on the same games', () => {
    const r = scoreGut([row('home', true, 0.7, 1), row('home', false, 0.7, 3), row('away', false, 0.7, 3), row('away', true, null, 2)])
    assert.equal(r.games, 4)
    assert.equal(r.right, 2)
    assert.deepEqual(r.byLevel.map((l) => [l.n, l.right]), [[1, 1], [1, 0], [2, 1]])
    assert.deepEqual(r.model, { games: 3, right: 1 })
  })
  it('only the games where gut and model disagree decide who is better, and a small number says "too early"', () => {
    const r = scoreGut([row('away', false, 0.7), row('away', true, 0.7), row('home', true, 0.7)])
    assert.equal(r.disagreements.n, 2)
    assert.equal(r.disagreements.gutWon, 1)
    assert.match(r.verdict, /Too early/)
  })
  it('calls a clear win for the gut only when the whole interval is above one half', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row('away', i < 70 ? false : true, 0.7))      // the gut said away against a home-favouring model; away won 70 of 100
    const r = scoreGut(rows)
    assert.ok(rows.length >= MIN_DISAGREEMENTS)
    assert.equal(r.disagreements.gutWon, 70)
    assert.match(r.verdict, /Claude's gut won more often/)
  })
  it('calls it a wash when 55 of 100 disagreements go to the gut', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row('away', i < 55 ? false : true, 0.7))
    assert.match(scoreGut(rows).verdict, /No difference/)
  })
  it('says the model won when the whole interval is below one half', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row('away', i < 25 ? false : true, 0.7))
    assert.match(scoreGut(rows).verdict, /the model won more often/)
  })
  it('an empty record does not fail', () => {
    const r = scoreGut([])
    assert.equal(r.games, 0)
    assert.equal(r.disagreements.gutShare, null)
  })
})

describe('scoreboardResults', () => {
  const day = (iso: string) => iso.slice(0, 10)
  const code = (a: string) => ({ GS: 'GSW', NY: 'NYK' } as Record<string, string>)[a] ?? a
  const game = (state: string, hs: string, as_: string, home = 'GS', away = 'LAL') => ({ date: '2026-11-05T01:00Z', state, home: { abbr: home, score: hs }, away: { abbr: away, score: as_ } })

  it('grades a finished game as soon as the scoreboard says it is over, keyed with the standard team codes', () => {
    const m = scoreboardResults([game('post', '112', '104')], day, code)
    assert.equal(m.get(gutKey('2026-11-05', 'GSW', 'LAL')), true)
    assert.equal(scoreboardResults([game('post', '98', '104')], day, code).get(gutKey('2026-11-05', 'GSW', 'LAL')), false)
  })
  it('ignores a game that is not over, and a result that cannot be right (a tie, a 0-0, a score that is not a number)', () => {
    assert.equal(scoreboardResults([game('in', '50', '48'), game('pre', '0', '0')], day, code).size, 0)
    assert.equal(scoreboardResults([game('post', '100', '100'), game('post', '0', '0'), game('post', '--', '90')], day, code).size, 0)
  })
})
