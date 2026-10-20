// Run: npm run test:integration. The opt-in negative-binomial fallback, exercised through the real Worker.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { EVENT_DATE_ET } from './fake_odds_server.mjs'
import { api, start } from './harness.mjs'

let app, wembyId

before(async () => {
  app = await start({
    extraBindings: ['FALLBACK_MODEL=v3'],
    seed: (db) => {
      wembyId = db.prepare("SELECT id FROM players WHERE name = 'Victor Wembanyama'").get().id
      db.exec('DELETE FROM projections')
      db.prepare("INSERT INTO projections (player_id, game_date, stat, mean, alpha, model, created_at) VALUES (?, ?, 'pts', 25.5, 0.08, 'gbm-v1', datetime('now', '-2 hours'))").run(wembyId, EVENT_DATE_ET)
    },
  })
})
after(async () => { await app?.stop() })

describe('FALLBACK_MODEL=v3', () => {
  it('fallback lines are produced by baseline-v3; a fresh projection still wins', async () => {
    const { body } = await api('/picks')
    const models = new Set(body.data.map((p) => p.model))
    assert.ok(models.has('baseline-v3'), `models seen: ${[...models]}`)
    assert.ok(!models.has('baseline-v2'))
    assert.equal(body.data.find((p) => p.playerId === wembyId && p.stat === 'pts').model, 'gbm-v1')
  })
  it('the player-page projection uses it too, and its probabilities add up', async () => {
    const r = await api('/players/201939/stats?stat=reb&line=3')
    assert.equal(r.body.prediction.model, 'baseline-v3')
    const p = r.body.prediction
    assert.ok(Math.abs(p.pOver + p.pUnder + p.pPush - 1) < 1e-9)
  })
})
