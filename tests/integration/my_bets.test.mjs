// Run: npm run test:integration. The bets a user actually placed: logging, listing, totals, deleting, and who may write.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

const TOKEN = 'integration-token'
const priv = { 'x-capture-token': TOKEN, 'content-type': 'application/json' }
let app
before(async () => { app = await start({ extraBindings: [`CAPTURE_TOKEN=${TOKEN}`], seed: (db) => { db.exec('DELETE FROM my_bet_legs; DELETE FROM my_bets;') } }) })
after(async () => { await app?.stop() })

const leg = (o = {}) => ({ playerId: 201939, player: 'Stephen Curry', stat: 'pts', side: 'over', line: 25.5, price: 1.95, book: 'DraftKings', gameDate: '2026-10-24', ...o })
const post = (body, headers = priv) => api('/my-bets', { method: 'POST', headers, body: JSON.stringify(body) })

describe('/api/my-bets', () => {
  it('keeps personal bets private: reading needs the token as well as writing', async () => {
    assert.equal((await api('/my-bets')).status, 403)
    assert.equal((await api('/my-bets', { headers: { 'x-capture-token': 'wrong-token' } })).status, 403)
    assert.equal((await api('/my-bets', { headers: priv })).status, 200)
  })
  it('refuses writes without the token, and stores nothing', async () => {
    assert.equal((await post({ stake: 10, legs: [leg()] }, { 'content-type': 'application/json' })).status, 403)
    assert.equal((await api('/my-bets', { headers: priv })).body.data.bets.length, 0)
  })
  it('refuses malformed bets whole', async () => {
    for (const b of [{ stake: 0, legs: [leg()] }, { stake: 10, legs: [] }, { stake: 10, legs: [leg({ price: 0.5 })] }, { stake: 10, legs: [leg({ stat: 'dunks' })] }]) assert.equal((await post(b)).status, 400)
    assert.equal((await api('/my-bets', { headers: priv })).body.data.bets.length, 0)
  })
  it('stores a bet with its legs at the odds actually taken, lists it open, and totals it', async () => {
    const r = await post({ stake: 25, note: 'test', legs: [leg(), leg({ playerId: 2544, player: 'LeBron James', stat: 'pra', line: 38.5, price: 2.1, book: 'FanDuel' })] })
    assert.equal(r.status, 200)
    const { body } = await api('/my-bets', { headers: priv })
    assert.equal(body.data.bets.length, 1)
    assert.deepEqual([body.data.bets[0].stake, body.data.bets[0].status, body.data.bets[0].note], [25, 'open', 'test'])
    const legs = body.data.legs.filter((l) => l.betId === r.body.id)
    assert.deepEqual(legs.map((l) => [l.stat, l.price, l.book]), [['pts', 1.95, 'DraftKings'], ['pra', 2.1, 'FanDuel']])
    assert.equal(body.data.totals.open, 1); assert.equal(body.data.totals.roi, null)
  })
  it('deletes a bet and its legs, only with the token', async () => {
    const id = (await api('/my-bets', { headers: priv })).body.data.bets[0].id
    assert.equal((await api(`/my-bets/${id}`, { method: 'DELETE' })).status, 403)
    assert.equal((await api(`/my-bets/${id}`, { method: 'DELETE', headers: priv })).status, 200)
    const { body } = await api('/my-bets', { headers: priv })
    assert.deepEqual([body.data.bets.length, body.data.legs.length], [0, 0])
    assert.equal((await api('/my-bets/abc', { method: 'DELETE', headers: priv })).status, 400)
  })
})
