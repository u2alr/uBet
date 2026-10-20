// Run: npm run test:integration. /api/minds arithmetic, and what Refresh on a game page may spend.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start, upstreamReset, upstreamStats } from './harness.mjs'

const TOKEN = 'integration-token'
const priv = { 'x-capture-token': TOKEN }
let app, curryId, cutoff

before(async () => {
  app = await start({
    extraBindings: [`CAPTURE_TOKEN=${TOKEN}`],
    seed: (db) => {
      db.exec('DELETE FROM mind_legs; DELETE FROM mind_bets;')
      const ins = db.prepare("INSERT INTO mind_bets (bet_key, day, mind, version, kind, odds, prob, ev, status, profit) VALUES (?,?,?,?,?,?,?,?,?,?)")
      ins.run('a', '2026-10-01', 'sam', 'minds-v3', 'single', 2, 0.6, 0.2, 'won', 1)
      ins.run('b', '2026-10-01', 'sam', 'minds-v3', 'single', 2, 0.4, -0.2, 'lost', -1)
      ins.run('c', '2026-10-02', 'sam', 'minds-v3', 'single', 2, 0.9, 0.8, 'push', 0)   // refunded: neither a hit nor a miss
      ins.run('d', '2026-10-02', 'sam', 'minds-v3', 'single', 2, 0.7, 0.4, 'open', null)
      // An archived version-1 bet, which must never mix into version 2's record.
      ins.run('v1a', '2026-10-01', 'control', 'minds-v1', 'single', 2, 0.9, 0.8, 'lost', -1)
      ins.run('v2a', '2026-10-01', 'sam', 'minds-v2', 'single', 2, 0.6, 0.2, 'won', 1)
      // A leg whose "recent games" we can recompute independently: Curry's points before a cutoff date.
      curryId = db.prepare("SELECT id FROM players WHERE name = 'Stephen Curry'").get().id
      cutoff = db.prepare("SELECT g.date AS d FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id = ? AND g.game_type = 'regular' ORDER BY g.date DESC LIMIT 1 OFFSET 3").get(curryId).d
      const betId = ins.run('e', '2026-10-03', 'val', 'minds-v3', 'single', 2, 0.6, 0.1, 'open', null).lastInsertRowid
      db.prepare("INSERT INTO mind_legs (bet_id, idx, player_id, player, stat, side, line, price, game_date, prob) VALUES (?, 0, ?, 'Stephen Curry', 'pts', 'over', 20.5, 2, ?, 0.6)").run(betId, curryId, cutoff)
    },
  })
})
after(async () => { await app?.stop() })

describe('/api/minds', () => {
  it('compares stated probability and actual hit rate over the same bets (a push is in neither)', async () => {
    const { status, body } = await api('/minds')
    assert.equal(status, 200)
    const sam = body.data.summary.find((s) => s.mind === 'sam')
    assert.equal(sam.bets, 4)
    assert.equal(sam.settled, 3)
    assert.equal(sam.open, 1)
    assert.ok(Math.abs(sam.statedProb - 0.5) < 1e-9, `statedProb ${sam.statedProb}`)   // (0.6 + 0.4) / 2; the old query also counted the 0.9 push
    assert.equal(sam.actualRate, 0.5)
    assert.equal(sam.units, 0)
  })
})

describe('rule-set versions', () => {
  it('default to the current version and keep archived versions out of its record', async () => {
    const { body } = await api('/minds')
    assert.equal(body.data.version, 'minds-v3')
    assert.equal(body.data.current, 'minds-v3')
    assert.ok(body.data.bets.every((b) => b.version === 'minds-v3'))
    assert.equal(body.data.summary.find((s) => s.mind === 'control'), undefined)
    assert.deepEqual(body.data.versions.map((v) => v.version).sort(), ['minds-v1', 'minds-v2', 'minds-v3'])
  })
  it('an archived version can be read on its own', async () => {
    const { body } = await api('/minds?version=minds-v1')
    assert.equal(body.data.bets.length, 1)
    assert.equal(body.data.summary[0].mind, 'control')
    assert.equal(body.data.summary[0].units, -1)
  })
  it('rejects a malformed version', async () => {
    for (const v of ['x', 'minds-v', "minds-v1'--", '../etc']) assert.equal((await api(`/minds?version=${encodeURIComponent(v)}`)).status, 400, v)
  })
})

describe('each leg carries the games that were known when the bet was made', () => {
  it('is the last 10 regular-season games strictly before the game date, oldest first', async () => {
    const { body } = await api('/minds')
    const leg = body.data.legs.find((l) => l.playerId === curryId)
    assert.ok(leg, 'seeded leg returned')
    const { openScratch } = await import('./harness.mjs')
    const db = openScratch()
    try {
      const expected = db.prepare("SELECT pg.pts AS v FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id = ? AND g.game_type = 'regular' AND g.date < ? ORDER BY g.date DESC LIMIT 10").all(curryId, cutoff).map((r) => r.v).reverse()
      assert.equal(expected.length, 10)
      assert.deepEqual(leg.recent, expected)
    } finally { db.close() }
  })
  it('a leg with no history gets an empty list rather than an error', async () => {
    const { body } = await api('/minds')
    assert.ok(body.data.legs.every((l) => Array.isArray(l.recent)))
  })
})

describe('Refresh on a game page', () => {
  it('refreshes the schedule and team odds but never spends the ~24 prop credits', async () => {
    const list = await api('/games')
    const id = list.body.data[0].id
    await api(`/games/${id}`)                       // primes the prop cache the normal way
    await upstreamReset()
    const r = await api(`/games/${id}?fresh=1`, { headers: priv })
    assert.equal(r.status, 200)
    const spent = await upstreamStats()
    assert.equal(spent['/odds'], 1, 'team odds are refreshed')
    assert.equal(spent['/events'] ?? 0, 0)
    assert.equal(spent['/events/:id/odds'] ?? 0, 0, JSON.stringify(spent))
  })
})
