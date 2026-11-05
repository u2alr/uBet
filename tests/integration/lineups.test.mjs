// Run: npm run test:integration. /api/lineups gives each unfinished game two teams of at most five projected starters. Flags come ONLY from the NBA's own report and only for that game;
// a team with no entry shows the default lineup with no flags; and it says plainly the starters are projected.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

let app
before(async () => { app = await start() })
after(async () => { await app?.stop() })

const STATUSES = ['out', 'doubtful', 'questionable', 'probable']
const STATES = ['listed', 'clear', 'not_submitted', 'absent']

describe('/api/lineups', () => {
  it('lists upcoming games with at most five projected starters per team, flags only from the NBA report, and never calls them confirmed', async () => {
    const { status, body } = await api('/lineups')
    assert.equal(status, 200)
    assert.ok(body.data.games.length > 0)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    for (const g of body.data.games) {
      assert.notEqual(g.state, 'post', 'a finished game has no lineup to project')
      assert.ok(new Date(g.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) >= today, 'a past day is never shown')
      for (const t of [g.home, g.away]) {
        assert.ok(t.starters.length <= 5, `${t.abbr} has ${t.starters.length} starters`)
        assert.ok(STATES.includes(t.state), `${t.abbr}: ${t.state}`)
        assert.equal('source' in t, false, 'no feed other than the NBA report is named')
        const flags = [...t.starters, ...t.nextUp].filter((p) => p.listing)
        for (const p of flags) { assert.ok(STATUSES.includes(p.listing.status), `${p.name}: ${p.listing.status}`); assert.equal('note' in p.listing, false, 'no ESPN news line') }
        for (const a of t.alsoListed) assert.ok(STATUSES.includes(a.listing.status))
        if (t.state !== 'listed') {
          assert.equal(flags.length, 0, `${t.abbr} (${t.state}) must show the default lineup with no flags`)
          assert.equal(t.alsoListed.length, 0)
        }
        const names = new Set(t.starters.map((p) => p.name))
        assert.ok(!t.nextUp.some((p) => names.has(p.name)), 'a starter is not also listed as next up')
        assert.ok(!t.nextUp.some((p) => p.listing && ['out', 'doubtful'].includes(p.listing.status)), 'next up never includes a player who is out or doubtful')
      }
    }
    assert.equal('espnAvailable' in body.meta, false)
    assert.match(body.meta.note, /projected/i)
    assert.match(body.meta.note, /not confirmed/i)
  })
})
