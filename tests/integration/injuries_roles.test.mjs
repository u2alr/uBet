// Run: npm run test:integration. ESPN availability and minutes roles, through the real Worker.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { EVENT_DATE_ET } from './fake_odds_server.mjs'
import { api, start } from './harness.mjs'

let app, wembyId, brownId

before(async () => {
  app = await start({
    seed: (db) => {
      wembyId = db.prepare("SELECT id FROM players WHERE name = 'Victor Wembanyama'").get().id
      brownId = db.prepare("SELECT id FROM players WHERE name = 'Jaylen Brown'").get().id
      db.exec('DELETE FROM projections')
      db.prepare("INSERT INTO projections (player_id, game_date, stat, mean, alpha, model, created_at) VALUES (?, ?, 'pts', 25.5, 0.08, 'gbm-v1', datetime('now', '-2 hours'))").run(wembyId, EVENT_DATE_ET)
    },
  })
})
after(async () => { await app?.stop() })

describe('injuries on picks', () => {
  it('hides lines for a player listed Out, and says so', async () => {
    const { body } = await api('/picks')
    assert.equal(body.data.some((p) => p.playerId === brownId), false, 'Jaylen Brown is Out: no pick')
    const w = body.meta.warnings.find((x) => x.code === 'injured_dropped')
    assert.ok(w && w.message.includes('Jaylen Brown'), JSON.stringify(body.meta.warnings))
  })
  it('keeps a Questionable player and tags the pick with the status and note', async () => {
    const { body } = await api('/picks')
    const p = body.data.find((x) => x.playerId === wembyId)
    assert.equal(p.injury.status, 'questionable')
    assert.match(p.injury.note, /illness/)
  })
  it('matches accented names (Dončić in the odds, Doncic in the injury list)', async () => {
    const { body } = await api('/picks')
    const luka = body.data.find((x) => x.player.startsWith('Luka'))
    assert.equal(luka?.injury?.status, 'day-to-day')
  })
  it('a healthy player has injury null, not a missing field', async () => {
    const { body } = await api('/picks')
    const healthy = body.data.find((x) => x.player === 'Stephen Curry')
    assert.equal(healthy.injury, null)
  })
})

describe('roles', () => {
  it('every pick carries a minutes role derived from real minutes', async () => {
    const { body } = await api('/picks')
    const p = body.data.find((x) => x.playerId === wembyId)
    assert.ok(['Starter', 'Rotation', 'Bench', 'Fringe'].includes(p.role.label))
    assert.ok(p.role.min10 > 0 && p.role.min10 <= 48)
  })
  it('the player endpoint reports role and injury for the player page', async () => {
    const { status, body } = await api(`/players/${wembyId}/stats?stat=pts`)
    assert.equal(status, 200)
    assert.equal(body.injury.status, 'questionable')
    assert.ok(body.role.min10 > 0)
  })
})
