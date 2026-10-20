// Run: npm run test:integration   (starts the real Worker against a fake provider and a scratch database copy)
// Every finding of the audit that can be checked over HTTP is a test here, so it cannot quietly come back.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { EVENT_DATE_ET } from './fake_odds_server.mjs'
import { api, APP, openScratch, setUpstreamFailing, start, upstreamReset, upstreamStats } from './harness.mjs'

const TOKEN = 'integration-token'
const priv = { 'x-capture-token': TOKEN }
let app
let curryId, wembyId

const idOf = (db, name) => db.prepare('SELECT id FROM players WHERE name = ?').get(name).id
const rowCount = () => { const d = openScratch(); try { return d.prepare('SELECT COUNT(*) AS n FROM predictions').get().n } finally { d.close() } }

before(async () => {
  app = await start({
    extraBindings: [`CAPTURE_TOKEN=${TOKEN}`], // production-like: only a caller who knows the token is privileged
    seed: (db) => {
      curryId = idOf(db, 'Stephen Curry')
      wembyId = idOf(db, 'Victor Wembanyama')
      const played = db.prepare("SELECT g.date AS d FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.player_id = ? AND g.game_type = 'regular' ORDER BY g.date DESC LIMIT 1").get(curryId).d
      // A pick waiting for its result: if a page view grades it, a GET is writing to the database.
      db.prepare("INSERT INTO predictions (player_id, stat, line, predicted, p_over, model, game_date, side, price, book) VALUES (?, 'pts', 20.5, 25, 0.6, 'seed', ?, 'over', 1.9, 'seed')").run(curryId, played)
      // Projections for the fake games: Wembanyama's is fresh, Curry's is 60 hours old (past the 36 hour limit).
      db.exec('DELETE FROM projections')
      const ins = db.prepare("INSERT INTO projections (player_id, game_date, stat, mean, alpha, model, created_at) VALUES (?, ?, 'pts', ?, 0.08, 'gbm-v1', datetime('now', ?))")
      ins.run(wembyId, EVENT_DATE_ET, 25.5, '-2 hours')
      ins.run(curryId, EVENT_DATE_ET, 27, '-60 hours')
    },
  })
})
after(async () => { await app?.stop() })

describe('provider credits are not spendable by strangers', () => {
  it('a repeat call is served from the cache', async () => {
    await api('/games')
    await upstreamReset()
    await api('/games')
    assert.equal((await upstreamStats())['/odds'] ?? 0, 0)
  })
  it('?fresh=1 without the token does NOT bypass the cache', async () => {
    await upstreamReset()
    const r = await api('/games?fresh=1')
    assert.equal(r.status, 200)
    assert.equal((await upstreamStats())['/odds'] ?? 0, 0)
    assert.equal(r.body.meta.freshRequested, true)
    assert.equal(r.body.meta.freshHonored, false) // and it says so
  })
  it('?fresh=1 WITH the token does bypass it', async () => {
    await upstreamReset()
    const r = await api('/games?fresh=1', { headers: priv })
    assert.equal(r.body.meta.freshHonored, true)
    assert.equal((await upstreamStats())['/odds'], 1)
  })
  it('/capture is forbidden without the token and spends nothing', async () => {
    await upstreamReset()
    assert.equal((await api('/capture?hours=48')).status, 403)
    assert.equal((await api('/capture?hours=48', { headers: { 'x-capture-token': 'wrong' } })).status, 403)
    assert.deepEqual(await upstreamStats(), {})
  })
  it('/capture with the token works, and its window is capped at 12 hours', async () => {
    await upstreamReset()
    const r = await api('/capture?hours=3', { headers: priv })
    assert.equal(r.status, 200)
    assert.equal(r.body.games, 1) // only the game starting within 3 hours
    assert.equal((await upstreamStats())['/events/:id/odds'], 1)
    assert.equal((await api('/capture?hours=500', { headers: priv })).body.games, 1) // 500 is clamped to 12, still only that game
    assert.equal((await api('/capture?hours=abc', { headers: priv })).status, 200) // junk falls back to the default
  })
})

describe('reads do not write, and writes are guarded and validated', () => {
  it('GET /results does not grade pending picks', async () => {
    await api('/results')
    const d = openScratch()
    try { assert.equal(d.prepare("SELECT hit FROM predictions WHERE model = 'seed'").get().hit, null) } finally { d.close() }
  })

  it('POST /predictions without the token is forbidden and adds nothing', async () => {
    const before = rowCount()
    const body = JSON.stringify({ playerId: curryId, stat: 'pts', line: 20.5, predicted: 25, pOver: 0.6, model: 'x' })
    for (const payload of [body, '{not json', JSON.stringify({ playerId: 'x', line: 'abc', pOver: 7 })]) {
      const r = await api('/predictions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
      assert.equal(r.status, 403)
    }
    assert.equal(rowCount(), before)
  })

  it('with the token, invalid values are rejected with a 400 and nothing is stored', async () => {
    const before = rowCount()
    const post = (b) => api('/predictions', { method: 'POST', headers: { ...priv, 'content-type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) })
    const ok = { playerId: curryId, stat: 'pts', line: 20.5, predicted: 25, pOver: 0.6, model: 'manual' }
    for (const bad of [
      { ...ok, line: 'abc' }, { ...ok, line: -1 }, { ...ok, line: 301 }, { ...ok, pOver: 7 }, { ...ok, pOver: -0.1 },
      { ...ok, predicted: -5 }, { ...ok, stat: 'dunks' }, { ...ok, playerId: 1.5 }, { ...ok, playerId: 'x' },
      { ...ok, model: 'x'.repeat(5000) }, { ...ok, model: 'bad model!' }, '{not json', '[]', 'null', '5', '"text"',
    ]) {
      const r = await post(bad)
      assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 80))
    }
    assert.equal(rowCount(), before)
    assert.equal((await post(ok)).status, 200)
    assert.equal(rowCount(), before + 1)
  })
})

describe('inputs are validated', () => {
  it('rejects bad ids, stats, types and lines (including Infinity, which used to hang the Worker)', async () => {
    for (const path of [
      '/players/abc/stats', '/players/1.5/stats', '/players/-1/stats', '/players/abc', '/players/abc/log',
      '/players/201939/stats?stat=dunks', '/players/201939/stats?type=nope',
      '/players/201939/stats?stat=fg3m&line=abc', '/players/201939/stats?stat=fg3m&line=Infinity',
      '/players/201939/stats?stat=fg3m&line=-1', '/players/201939/stats?stat=fg3m&line=301', '/players/201939/stats?stat=fg3m&line=1e9',
    ]) {
      const t = Date.now()
      const r = await api(path)
      assert.equal(r.status, 400, path)
      assert.ok(Date.now() - t < 3000, `${path} took too long`)
    }
  })
  it('accepts a normal line and returns probabilities that add up', async () => {
    const r = await api('/players/201939/stats?stat=pts&line=24')
    assert.equal(r.status, 200)
    const p = r.body.prediction
    assert.ok(Math.abs(p.pOver + p.pUnder + p.pPush - 1) < 1e-9)
    assert.ok(p.pPush > 0, 'a whole-number line has a refund chance')
  })
  it('LIKE wildcards in a search are literal, and long searches are refused', async () => {
    assert.equal((await api('/players?search=%25')).body.data.length, 0)
    assert.equal((await api('/players?search=' + 'a'.repeat(65))).status, 400)
    assert.ok((await api('/players?search=curry')).body.data.length >= 1)
  })
  it('no cross-site read access is granted', async () => {
    const res = await fetch(`${APP}/api/status`, { headers: { Origin: 'https://evil.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })
})

describe('picks', () => {
  let body
  before(async () => { body = (await api('/picks')).body })

  it('are well-formed: finite, in range, no retired fields', () => {
    assert.ok(body.data.length > 5)
    for (const p of body.data) {
      for (const k of ['modelProb', 'prob', 'push', 'impliedProb']) assert.ok(p[k] >= 0 && p[k] <= 1, `${k}=${p[k]}`)
      for (const k of ['ev', 'projection', 'price', 'line']) assert.ok(Number.isFinite(p[k]), k)
      assert.ok(p.ev <= p.price - 1 + 1e-9 && p.ev >= -1 - 1e-9)
      assert.equal('confidence' in p, false)
      if (Number.isInteger(p.line)) assert.ok(p.push > 0, 'whole-number lines carry a refund chance')
      else assert.equal(p.push, 0)
    }
  })

  it('use a fresh projection, and fall back (loudly) when it is too old', () => {
    const wemby = body.data.find((p) => p.playerId === wembyId && p.stat === 'pts')
    const curry = body.data.find((p) => p.playerId === curryId && p.stat === 'pts')
    assert.equal(wemby.model, 'gbm-v1')
    assert.ok(wemby.projectionAgeHours > 1 && wemby.projectionAgeHours < 3)
    assert.equal(curry.model, 'baseline-v2')
    assert.equal(curry.projectionAgeHours, null)
    const w = body.meta.warnings.find((x) => x.code === 'fallback_model')
    assert.ok(w && w.message.includes('Stephen Curry'), 'the stale projection is named')
  })

  it('say how old the odds are and what is missing', () => {
    assert.ok(Math.abs(Date.now() - Date.parse(body.meta.oddsAsOf)) < 5 * 60_000)
    const codes = body.meta.warnings.map((x) => x.code)
    assert.ok(codes.includes('no_injury_data'))
    assert.ok(codes.includes('unmatched_players'), 'a player in the odds that is not in the database is reported')
  })

  it('log the model, market and refund chance of what was shown', () => {
    const d = openScratch()
    try {
      const row = d.prepare("SELECT model_prob, market_prob, push FROM predictions WHERE model IN ('gbm-v1','baseline-v2') AND price IS NOT NULL LIMIT 1").get()
      assert.ok(row && row.model_prob > 0 && row.model_prob < 1)
    } finally { d.close() }
  })

  it('logging is throttled, so page views cannot become a stream of writes', async () => {
    const d = openScratch()
    try { d.exec('DELETE FROM predictions WHERE model IN (\'gbm-v1\', \'baseline-v2\')') } finally { d.close() }
    await api('/picks')
    await api('/picks')
    const e = openScratch()
    try { assert.equal(e.prepare("SELECT COUNT(*) AS n FROM predictions WHERE model IN ('gbm-v1','baseline-v2')").get().n, 0) } finally { e.close() }
  })
})

describe('provider failures', () => {
  it('give a generic 502 and never leak the provider text', async () => {
    await setUpstreamFailing(true)
    try {
      const r = await api('/picks?fresh=1', { headers: priv }) // bypass the cache so the failure is reached
      assert.equal(r.status, 502)
      assert.deepEqual(Object.keys(r.body), ['error'])
      assert.ok(!JSON.stringify(r.body).includes('boom'))
    } finally { await setUpstreamFailing(false) }
  })
  it('a failed team-odds load is reported on /games instead of silently hidden', async () => {
    await setUpstreamFailing(true)
    try {
      const r = await api('/games?fresh=1', { headers: priv })
      assert.equal(r.status, 200)
      assert.equal(r.body.meta.oddsAvailable, false)
    } finally { await setUpstreamFailing(false) }
  })
})
