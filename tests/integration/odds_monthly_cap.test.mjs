// Run: npm run test:integration. The monthly cap stops the props pull once the month's credits are spent, however many games are on the slate.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start, upstreamReset, upstreamStats } from './harness.mjs'

let app
// A four-market props request costs 4 credits, so a cap of 4 leaves room for exactly one game even though three are allowed per refresh.
before(async () => {
  app = await start({ extraBindings: ['ODDS_MAX_EVENTS=3', 'ODDS_MONTHLY_CREDITS=4'], seed: (db) => { db.exec("DELETE FROM meta WHERE key LIKE 'odds_credits_%'") } })
})
after(async () => { await app?.stop() })

describe('monthly odds credit cap', () => {
  it('fetches props for as many games as the month has room for, and no more', async () => {
    await upstreamReset()
    const { status } = await api('/picks')
    assert.equal(status, 200)
    const spent = await upstreamStats()
    assert.equal(spent['/events/:id/odds'] ?? 0, 1, JSON.stringify(spent))
  })
  it('reports what the month has spent against the cap', async () => {
    const { body } = await api('/status')
    assert.deepEqual([body.oddsCredits.used, body.oddsCredits.limit, body.oddsCredits.remaining], [4, 4, 0])
  })
  it('a forced refresh cannot spend past the cap either', async () => {
    await upstreamReset()
    await api('/picks?fresh=1')
    const spent = await upstreamStats()
    assert.equal(spent['/events/:id/odds'] ?? 0, 0, JSON.stringify(spent))
  })
})
