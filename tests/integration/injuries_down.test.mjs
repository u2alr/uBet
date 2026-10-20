// Run: npm run test:integration. If ESPN's injury list is down, nobody is shown as healthy by default.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { EVENT_DATE_ET } from './fake_odds_server.mjs'
import { api, FAKE, start } from './harness.mjs'

let app, wembyId

before(async () => {
  app = await start({
    seed: (db) => {
      wembyId = db.prepare("SELECT id FROM players WHERE name = 'Victor Wembanyama'").get().id
      db.exec('DELETE FROM projections')
      db.prepare("INSERT INTO projections (player_id, game_date, stat, mean, alpha, model, created_at) VALUES (?, ?, 'pts', 25.5, 0.08, 'gbm-v1', datetime('now', '-2 hours'))").run(wembyId, EVENT_DATE_ET)
    },
  })
  await fetch(`${FAKE}/__failinjuries?on=1`) // before the first request, so the Worker's cache is cold
})
after(async () => { await app?.stop() })

describe('ESPN injuries unavailable', () => {
  it('picks still load and the missing data is reported, with no one wrongly dropped', async () => {
    const { status, body } = await api('/picks')
    assert.equal(status, 200)
    assert.ok(body.data.length > 5)
    assert.ok(body.meta.warnings.some((w) => w.code === 'no_injury_data'))
    assert.ok(!body.meta.warnings.some((w) => w.code === 'injured_dropped'))
    assert.ok(body.data.every((p) => p.injury === null))
  })
  it('the player page still loads', async () => {
    const r = await api(`/players/${wembyId}/stats?stat=pts`)
    assert.equal(r.status, 200)
    assert.equal(r.body.injury, null)
  })
})
