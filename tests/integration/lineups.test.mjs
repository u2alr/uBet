// Run: npm run test:integration. /api/lineups gives each unfinished game two teams of at most five projected starters with a valid status, and says plainly they are projected.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

let app
before(async () => { app = await start() })
after(async () => { await app?.stop() })

const STATUSES = ['out', 'doubtful', 'questionable', 'probable', 'gtd']

describe('/api/lineups', () => {
  it('lists upcoming games with at most five projected starters per team, each flag a known status, and never calls them confirmed', async () => {
    const { status, body } = await api('/lineups')
    assert.equal(status, 200)
    assert.ok(body.data.games.length > 0)
    for (const g of body.data.games) {
      assert.notEqual(g.state, 'post', 'a finished game has no lineup to project')
      for (const t of [g.home, g.away]) {
        assert.ok(t.starters.length <= 5, `${t.abbr} has ${t.starters.length} starters`)
        assert.ok(['official', 'espn', 'none'].includes(t.source))
        for (const p of [...t.starters, ...t.nextUp]) assert.ok(!p.listing || STATUSES.includes(p.listing.status), `${p.name}: ${p.listing?.status}`)
        for (const a of t.alsoListed) assert.ok(STATUSES.includes(a.listing.status))
        const names = new Set(t.starters.map((p) => p.name))
        assert.ok(!t.nextUp.some((p) => names.has(p.name)), 'a starter is not also listed as next up')
        assert.ok(!t.nextUp.some((p) => p.listing && ['out', 'doubtful'].includes(p.listing.status)), 'next up never includes a player who is out or doubtful')
      }
    }
    assert.match(body.meta.note, /projected/i)
    assert.match(body.meta.note, /not confirmed/i)
  })
})
