// Run: npm run test:integration. /api/lines prices props from our own projections and never calls an odds provider.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start, upstreamReset, upstreamStats } from './harness.mjs'

let app
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
before(async () => {
  app = await start({ seed: (db) => {
    const id = db.prepare("SELECT id FROM players WHERE name = 'Cade Cunningham'").get().id
    db.exec('DELETE FROM projections')
    const put = db.prepare('INSERT INTO projections (player_id, game_date, stat, mean, alpha, model) VALUES (?, ?, ?, ?, ?, ?)')
    put.run(id, today, 'pts', 24.3, 0.06, 'gbm-v1')
    put.run(id, today, 'ast', 8.1, 0.1, 'gbm-v1')
  } })
})
after(async () => { await app?.stop() })

describe('/api/lines', () => {
  it('gives each projected stat a line near its projection, with fair prices, and calls no provider', async () => {
    await upstreamReset()
    const { status, body } = await api('/lines?player=cunningham')
    assert.equal(status, 200)
    const p = body.data.find((x) => x.name === 'Cade Cunningham')
    assert.ok(p, JSON.stringify(body))
    const pts = p.lines.find((l) => l.stat === 'pts')
    assert.ok(Math.abs(pts.line - 24.3) <= 1.5)
    assert.ok(Math.abs(pts.over + pts.under - 1) < 0.01)
    assert.ok(pts.fairOver > 1.5 && pts.fairOver < 2.6)
    assert.equal(pts.ladder.length, 5)
    assert.equal(body.meta.stale, false)
    assert.deepEqual(await upstreamStats(), {})
  })
  it('narrows by stat, and a search with LIKE wildcards matches nothing instead of everything', async () => {
    const stat = await api('/lines?stat=ast')
    assert.deepEqual([...new Set(stat.body.data.flatMap((x) => x.lines.map((l) => l.stat)))], ['ast'])
    assert.equal((await api('/lines?player=%25')).body.data.length, 0)
  })
})
