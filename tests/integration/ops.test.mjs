// Run: npm run test:integration. Operational endpoints: health reports facts without secrets, and the heavy cheat-sheet query is cached.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

let app
before(async () => { app = await start({ extraBindings: ['CAPTURE_TOKEN=integration-token-value-0123456789'] }) })
after(async () => { await app?.stop() })

describe('/api/health', () => {
  it('reports status and checks, and never echoes a secret', async () => {
    const { status, body } = await api('/health')
    assert.ok(status === 200 || status === 503)
    assert.ok(['ok', 'degraded', 'down'].includes(body.status))
    assert.ok(body.checks.length >= 5)
    const text = JSON.stringify(body)
    assert.equal(text.includes('integration-token-value-0123456789'), false)
    assert.equal(text.includes('test-key-not-real'), false)
    assert.equal(body.checks.find((c) => c.name === 'access token').ok, true)
    assert.equal(body.checks.find((c) => c.name === 'odds provider key').ok, true)
  })
})

describe('/api/cheatsheet cache', () => {
  it('serves the second request from the cache: the same retrieval time, the same data', async () => {
    const a = await api('/cheatsheet')
    assert.equal(a.status, 200)
    const b = await api('/cheatsheet')
    assert.ok(a.body.cachedAt)
    assert.equal(b.body.cachedAt, a.body.cachedAt)
    assert.deepEqual(b.body.data, a.body.data)
  })
})
