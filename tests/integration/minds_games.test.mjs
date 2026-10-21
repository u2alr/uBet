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
      db.exec("DELETE FROM mind_legs; DELETE FROM mind_bets; DELETE FROM mind_rejections; DELETE FROM meta WHERE key LIKE 'minds_ran:%';")
      const ins = db.prepare("INSERT INTO mind_bets (bet_key, day, mind, version, kind, odds, prob, ev, status, profit, proposed_by, research) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      // version 4: a bet two personalities proposed counts for each of them, and once for the Chief
      ins.run('a', '2026-10-01', 'sam', 'minds-v4', 'single', 2, 0.6, 0.2, 'won', 1, 'sam,val', 0)
      ins.run('b', '2026-10-01', 'val', 'minds-v4', 'single', 2, 0.4, -0.2, 'lost', -1, 'val', 0)
      ins.run('c', '2026-10-02', 'sam', 'minds-v4', 'single', 2, 0.9, 0.8, 'push', 0, 'sam', 0)   // refunded: neither a hit nor a miss
      ins.run('d', '2026-10-02', 'sam', 'minds-v4', 'single', 2, 0.7, 0.4, 'open', null, 'sam', 0)
      ins.run('p1', '2026-10-02', 'lou', 'minds-v4', 'combo', 8, 0.1, 0.5, 'lost', -1, 'lou', 1)   // research parlay: graded, never staked
      // archived versions, which must never mix into version 4's record
      ins.run('v1a', '2026-10-01', 'control', 'minds-v1', 'single', 2, 0.9, 0.8, 'lost', -1, null, 0)
      ins.run('v2a', '2026-10-01', 'sam', 'minds-v2', 'single', 2, 0.6, 0.2, 'won', 1, null, 0)
      ins.run('v3a', '2026-10-01', 'val', 'minds-v3', 'single', 2, 0.6, 0.2, 'won', 1, null, 0)
      db.exec("INSERT INTO meta (key, value) VALUES ('minds_ran:minds-v4:2026-10-01', 'x'), ('minds_ran:minds-v4:2026-10-02', 'x')")
      const rej = db.prepare("INSERT INTO mind_rejections (day, version, proposed_by, player_id, player, stat, side, line, price, reason, detail, result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      rej.run('2026-10-01', 'minds-v4', 'val', 1, 'A', 'pts', 'over', 20.5, 1.9, 'form_contradiction', 'recent games', 'won')
      rej.run('2026-10-01', 'minds-v4', 'val', 2, 'B', 'pts', 'over', 20.5, 1.9, 'form_contradiction', 'recent games', 'lost')
      rej.run('2026-10-02', 'minds-v4', 'val', 3, 'C', 'ast', 'under', 5.5, 1.9, 'uncertainty_haircut', 'raw 8%', null)
      // A leg whose "recent games" we can recompute independently: Curry's points before a cutoff date.
      curryId = db.prepare("SELECT id FROM players WHERE name = 'Stephen Curry'").get().id
      cutoff = db.prepare("SELECT g.date AS d FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id = ? AND g.game_type = 'regular' ORDER BY g.date DESC LIMIT 1 OFFSET 3").get(curryId).d
      const betId = ins.run('e', '2026-10-03', 'val', 'minds-v4', 'single', 2, 0.6, 0.1, 'open', null, 'val', 0).lastInsertRowid
      db.prepare("INSERT INTO mind_legs (bet_id, idx, player_id, player, stat, side, line, price, game_date, prob) VALUES (?, 0, ?, 'Stephen Curry', 'pts', 'over', 20.5, 2, ?, 0.6)").run(betId, curryId, cutoff)
    },
  })
})
after(async () => { await app?.stop() })

describe('/api/minds', () => {
  it('the Chief row counts every staked bet once and leaves out research parlays', async () => {
    const { status, body } = await api('/minds')
    assert.equal(status, 200)
    const chief = body.data.summary.find((s) => s.mind === 'chief')
    assert.equal(chief.bets, 5)          // a b c d e, not the parlay
    assert.equal(chief.settled, 3)
    assert.equal(chief.units, 0)         // +1 -1 +0
  })
  it('a bet proposed by two personalities counts for each, and a push is in neither the stated nor the actual rate', async () => {
    const { body } = await api('/minds')
    const sam = body.data.summary.find((s) => s.mind === 'sam')
    const val = body.data.summary.find((s) => s.mind === 'val')
    assert.equal(sam.bets, 3)            // a, c, d
    assert.equal(val.bets, 3)            // a, b, e
    assert.ok(Math.abs(val.statedProb - 0.5) < 1e-9, `val statedProb ${val.statedProb}`)   // (0.6 + 0.4) / 2
    assert.equal(val.actualRate, 0.5)
    assert.ok(Math.abs(sam.statedProb - 0.6) < 1e-9, `sam statedProb ${sam.statedProb}`)    // the 0.9 push is excluded
    assert.equal(sam.actualRate, 1)
  })
  it('research parlays have their own row and never reach the portfolio', async () => {
    const { body } = await api('/minds')
    const r = body.data.summary.find((s) => s.mind === 'research')
    assert.equal(r.bets, 1)
    assert.equal(r.units, -1)
    assert.ok(body.data.summary.filter((s) => s.mind !== 'research').every((s) => s.bets <= 5))
  })
  it('audits the rejected candidates: counts by reason and what they would have done', async () => {
    const { body } = await api('/minds')
    const f = body.data.audit.find((a) => a.reason === 'form_contradiction')
    assert.equal(f.n, 2); assert.equal(f.graded, 2); assert.equal(f.won, 1); assert.equal(f.lost, 1)
    assert.ok(Math.abs(f.units - (0.9 - 1)) < 1e-9)
    assert.equal(body.data.audit.find((a) => a.reason === 'uncertainty_haircut').graded, 0)
    assert.equal(body.data.rejections.length, 3)
    assert.deepEqual(body.data.ranDays.sort(), ['2026-10-01', '2026-10-02'])
  })
  it('breaks calibration down by statistic and price band', async () => {
    const { body } = await api('/minds')
    assert.ok(Array.isArray(body.data.calibration))
  })
})

describe('rule-set versions', () => {
  it('default to the current version and keep archived versions out of its record', async () => {
    const { body } = await api('/minds')
    assert.equal(body.data.version, 'minds-v4')
    assert.equal(body.data.current, 'minds-v4')
    assert.ok(body.data.bets.every((b) => b.version === 'minds-v4'))
    assert.equal(body.data.summary.find((s) => s.mind === 'control'), undefined)
    assert.deepEqual(body.data.versions.map((v) => v.version).sort(), ['minds-v1', 'minds-v2', 'minds-v3', 'minds-v4'])
  })
  it('an archived version can be read on its own, with the old per-mind meaning', async () => {
    const { body } = await api('/minds?version=minds-v1')
    assert.equal(body.data.bets.length, 1)
    assert.equal(body.data.summary.find((s) => s.mind === 'control').units, -1)
    const v3 = (await api('/minds?version=minds-v3')).body
    assert.equal(v3.data.summary.find((s) => s.mind === 'val').bets, 1)
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
