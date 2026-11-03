// Run: npm run test:integration. /api/season-review counts the season's upsets against what the model expected, and reports an empty table without failing.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

let app
before(async () => {
  app = await start({ seed: (db) => {
    db.exec('DELETE FROM season_review')
    const put = db.prepare('INSERT INTO season_review (date, home, away, p_home, home_won, srs_gap, talent_diff, rest_diff, b2b_home, b2b_away) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    // 20 games where the home team was a 75% favourite: 15 held, 5 upsets (exactly what the model expected).
    for (let i = 0; i < 20; i++) put.run(`2026-10-${String(20 + (i % 9)).padStart(2, '0')}`, 'DET', `T${String(i).padStart(2, '0')}`, 0.75, i < 15 ? 1 : 0, 5, 0, 0, 0, 0)
    // one road favourite that lost: its context is read from its own side
    put.run('2026-10-30', 'CHA', 'BOS', 0.3, 1, -4, -25, 2, 0, 1)
  } })
})
after(async () => { await app?.stop() })

describe('/api/season-review', () => {
  it('reviews the games with the favourite taken from the model\'s own pre-game number', async () => {
    const { status, body } = await api('/season-review')
    assert.equal(status, 200)
    const r = body.data
    assert.equal(r.games, 21)
    assert.equal(r.favouriteWon, 15)
    assert.equal(r.upsets.observed, 6)
    assert.ok(r.upsets.expected > 5 && r.upsets.expected < 6.5)
    assert.match(r.upsets.verdict, /normal variance/)
    assert.match(r.caution, /small sample/)
    const clear = r.tiers.find((t) => t.key === 'clear')
    assert.ok(clear.n >= 20, JSON.stringify(r.tiers))
  })
  it('names what was visibly different in an upset, from the favourite\'s side', async () => {
    const { body } = await api('/season-review')
    const road = body.data.upsetGames.find((g) => g.favourite === 'BOS')
    assert.equal(road.home, false)
    assert.equal(road.factors.ratingGap, 4)
    const why = road.why.join(' | ')
    assert.match(why, /on the road/)
    assert.match(why, /missing more talent/, 'BOS was the more depleted side (home minus away was -25)')
    assert.match(why, /back-to-back/)
    assert.match(why, /underdog had more rest/)
    assert.doesNotMatch(why, /narrow rating gap/, 'a 4-point rating edge is not narrow')
  })
  it('says what was tried to make the model learn within a season, and that nothing was adopted', async () => {
    const { body } = await api('/season-review')
    assert.deepEqual(body.meta.adaptation.adopted, [])
    assert.ok(body.meta.adaptation.tested.length >= 2)
  })
})
