// Run: npm run test:integration. /api/gut keeps Claude's pick for a game, refuses a bad or late one, and scores finished games against the model's own pre-game number.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

let app
let ref
before(async () => {
  app = await start({ seed: (db) => {
    db.exec('DELETE FROM gut_pick')
    // One finished game, 2026-10-01: DET (home) beat PHI. The model said 70% DET when the pick was saved.
    db.prepare("INSERT OR REPLACE INTO players (id, name, team, position) VALUES (999001, 'Gut Test', 'DET', NULL)").run()
    db.prepare("INSERT OR REPLACE INTO games (id, date, season, home_team_id, visitor_team_id, game_type) VALUES (29900001, '2026-10-01', 2026, 1610612765, 1610612755, 'regular')").run()
    db.prepare("INSERT OR REPLACE INTO player_games (player_id, game_id, team_id, minutes, opp, is_home, won) VALUES (999001, 29900001, 1610612765, 30, 'PHI', 1, 1)").run()
    const put = db.prepare('INSERT INTO gut_pick (source, date, home, away, pick, level, note, model_home_prob) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    put.run('claude', '2026-10-01', 'DET', 'PHI', 'away', 3, 'felt like an upset', 0.7)       // the gut said PHI against the model, and was wrong
    put.run('you', '2026-10-01', 'DET', 'PHI', 'home', 1, 'an old pick by another author', 0.7)   // never shown or scored
  } })
  const { body } = await api('/team-bets')
  ref = body.data.games.find((g) => g.home.abbr === 'DET').gutRef
})
after(async () => { await app?.stop() })

const post = (body) => api('/gut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('/api/gut', () => {
  it('scores a finished game: the gut disagreed with the model and lost, and a small number says "too early"', async () => {
    const { status, body } = await api('/gut')
    assert.equal(status, 200)
    const r = body.data.records.claude
    assert.equal(r.games, 1, 'only Claude\'s pick counts')
    assert.equal(r.right, 0)
    assert.deepEqual(r.model, { games: 1, right: 1 })
    assert.deepEqual([r.disagreements.n, r.disagreements.gutWon, r.disagreements.modelWon], [1, 0, 1])
    assert.match(r.verdict, /Too early/)
  })
  it('saves a pick for an upcoming game, changes it, and shows it back', async () => {
    assert.equal((await post({ ...ref, pick: 'away', level: 1, note: 'tired legs' })).status, 200)
    assert.equal((await post({ ...ref, pick: 'home', level: 3, note: null })).status, 200)
    const { body } = await api('/gut')
    const mine = body.data.picks.filter((x) => x.home === ref.home && x.away === ref.away)
    assert.equal(mine.length, 1, 'one pick per game')
    assert.equal(mine[0].pick, 'home')
    assert.equal(mine[0].level, 3)
    assert.equal(mine[0].source, 'claude')
  })
  it('refuses a malformed pick, another author, and a game that is not on the schedule', async () => {
    assert.equal((await post({ ...ref, pick: 'draw', level: 1 })).status, 400)
    assert.equal((await post({ ...ref, pick: 'home', level: 9 })).status, 400)
    assert.equal((await post({ ...ref, source: 'you', pick: 'home', level: 1 })).status, 400)
    assert.equal((await post({ date: ref.date, home: 'ZZZ', away: 'YYY', pick: 'home', level: 1 })).status, 404)
  })
  it('refuses a pick for a game that has already been played', async () => {
    const r = await post({ date: '2026-10-01', home: 'DET', away: 'PHI', pick: 'home', level: 1 })
    assert.ok([404, 409].includes(r.status), `a finished game is no longer on the schedule or is locked, got ${r.status}`)
  })
  it('will not erase the pick of a game that is over, even one no longer on the schedule', async () => {
    assert.equal((await api('/gut?date=2026-10-01&home=DET&away=PHI', { method: 'DELETE' })).status, 409)
  })
  it('clears a pick before tip-off', async () => {
    assert.equal((await api(`/gut?date=${ref.date}&home=${ref.home}&away=${ref.away}`, { method: 'DELETE' })).status, 200)
    const { body } = await api('/gut')
    assert.equal(body.data.picks.some((x) => x.home === ref.home && x.away === ref.away), false)
  })
})
