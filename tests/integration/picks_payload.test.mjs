// Run: npm run test:integration. The real Worker's /api/picks: nothing posted is dropped, every pick says which calculation produced its numbers.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

let app
before(async () => { app = await start() })
after(async () => { await app?.stop() })

const mkey = (p) => `${p.eventId}|${p.playerId}|${p.stat}|${p.line}`

describe('/api/picks payload', () => {
  it('returns every side the books posted: whenever a pick says its other side is posted, that side is in the payload', async () => {
    const { status, body } = await api('/picks')
    assert.equal(status, 200)
    assert.ok(body.data.length > 0)
    const sides = new Map()
    for (const p of body.data) (sides.get(mkey(p)) ?? sides.set(mkey(p), new Set()).get(mkey(p))).add(p.side)
    for (const p of body.data) {
      if (p.counterpart === 'posted') assert.equal(sides.get(mkey(p)).size, 2, `${p.player} ${p.stat} ${p.line}`)
      else assert.equal(p.counterpart, 'not_posted')
    }
  })
  it('reports coverage by game, and nothing is omitted at normal size', async () => {
    const { body } = await api('/picks')
    const c = body.meta.coverage
    assert.equal(c.returned, body.data.length); assert.equal(c.total, body.data.length)
    assert.deepEqual(c.omitted, [])
    assert.equal(c.events.reduce((a, e) => a + e.picks, 0), c.total)
  })
  it('labels the basis of every pick, keeps the legacy numbers, and does not ship engine-only arrays', async () => {
    const { body } = await api('/picks')
    for (const p of body.data) {
      assert.ok(p.basis === 'authoritative' || p.basis === 'legacy', p.basis)
      assert.ok(p.legacy && Number.isFinite(p.legacy.prob) && Number.isFinite(p.legacy.ev))
      assert.ok(p.auth && p.auth.version === 'auth-v1')
      assert.equal('bookQuotes' in p, false); assert.equal('sideQuotes' in p, false)
      assert.equal('risk' in p, false, 'the probability-only risk label is gone')
      if (p.basis === 'authoritative') { assert.equal(p.prob, p.auth.probability.decision); assert.equal(p.ev, p.auth.ev.raw) }
    }
  })
  it('a single game can be requested, and a malformed id is refused', async () => {
    const all = (await api('/picks')).body
    const first = all.meta.coverage.events[0]
    const one = (await api(`/picks?event=${first.eventId}`)).body
    assert.equal(one.data.length, first.picks); assert.ok(one.data.every((p) => p.eventId === first.eventId))
    assert.equal((await api('/picks?event=' + encodeURIComponent('<x>'))).status, 400)
  })
})
