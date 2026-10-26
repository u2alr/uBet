// Run: npm run test:integration. The props pull spends credits per game, so it must respect the cap and the cache.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start, upstreamReset, upstreamStats } from './harness.mjs'

let app
before(async () => { app = await start({ extraBindings: ['ODDS_MAX_EVENTS=2'] }) })
after(async () => { await app?.stop() })

describe('odds credit budget', () => {
  it('asks the provider for props of at most ODDS_MAX_EVENTS games, one request per game', async () => {
    await upstreamReset()
    const { status } = await api('/picks')
    assert.equal(status, 200)
    const spent = await upstreamStats()
    assert.ok((spent['/events/:id/odds'] ?? 0) <= 2, `props requests: ${JSON.stringify(spent)}`)
    assert.ok((spent['/events/:id/odds'] ?? 0) >= 1, 'it did fetch something')
  })
  it('a second look inside the cache window spends nothing more', async () => {
    await upstreamReset()
    await api('/picks')
    const spent = await upstreamStats()
    assert.equal(spent['/events/:id/odds'] ?? 0, 0, JSON.stringify(spent))
  })
})
