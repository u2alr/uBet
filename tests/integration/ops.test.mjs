// Run: npm run test:integration. Operational endpoints: health reports facts without secrets, and the heavy cheat-sheet query is cached.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, openScratch, start } from './harness.mjs'

let app
before(async () => { app = await start({ extraBindings: ['CAPTURE_TOKEN=integration-token-value-0123456789'] }); clearSnapshots() })
/** The scratch database is a copy of the real local one, which may hold a real snapshot: start these tests from empty snapshot tables. */
function clearSnapshots() {
  const db = openScratch()
  try { for (const t of ['defense_team', 'defense_matchup', 'defense_meta', 'game_lean', 'game_lean_log']) db.prepare(`DELETE FROM ${t}`).run() } finally { db.close() }
}

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

describe('/api/schedule-context', () => {
  it('refuses malformed input', async () => {
    for (const q of ['', 'home=BOS&away=NYK', 'home=bos&away=NYK&date=2026-10-27', 'home=BOS&away=NYK&date=10/27/2026', 'home=BOS&away=NYK&date=2026-10-27&players=1,x']) assert.equal((await api(`/schedule-context?${q}`)).status, 400, q)
  })
  it('returns facts for both teams, a matchup summary and the model status, and says what is not known; it never carries a probability adjustment', async () => {
    const { status, body } = await api('/schedule-context?home=BOS&away=NYK&date=2099-01-15&tip=2099-01-16T00:30:00Z')
    assert.equal(status, 200)
    const d = body.data
    assert.equal(d.home.team, 'BOS'); assert.equal(d.away.team, 'NYK')
    assert.equal(d.home.restDays, null, 'no game in the 30 days before that date: unknown, not zero')
    assert.ok(d.home.unknown.includes('previous game'))
    assert.equal(d.model.adjustsPredictions, false)
    assert.equal(d.matchup.restEdge, 'unknown')
    assert.doesNotMatch(JSON.stringify(d.matchup), /probab/i)
  })
  it('reads real workload for a player the database knows, without inventing a reason for any gap', async () => {
    const search = (await api('/players?search=Curry')).body.data[0]
    const { body } = await api(`/schedule-context?home=BOS&away=GSW&date=2099-01-15&players=${search.id}`)
    const w = body.data.players[String(search.id)]
    assert.ok(w && (w.lastGameMinutes === null || w.lastGameMinutes > 0))
    assert.ok(['no', 'possible', 'unknown'].includes(w.returning))
    assert.doesNotMatch(JSON.stringify(w), /injur|illness|suspen/i)
  })
})

describe('/api/live/:id (live box score)', () => {
  it('returns parsed player lines', async () => {
    const r = await api('/live/123456')
    assert.equal(r.status, 200)
    assert.equal(r.body.data.state, 'in')
    assert.deepEqual(r.body.data.teams[0].players[0], { id: 77, name: 'Test Player', starter: true, minutes: 18, pts: 12, reb: 3, ast: 2, fg3m: 1 })
  })
  it('rejects a malformed id and hides provider failures', async () => {
    assert.equal((await api('/live/abc')).status, 400)
    const r = await api('/live/99999')
    assert.equal(r.status, 502)
    assert.deepEqual(Object.keys(r.body), ['error'])
  })
})

describe('/api/defense-context (display-only defensive matchup facts)', () => {
  it('validates input and says "not available" when no snapshot exists, without failing', async () => {
    assert.equal((await api('/defense-context')).status, 400)
    assert.equal((await api('/defense-context?player=abc&opp=BOS')).status, 400)
    assert.equal((await api('/defense-context?player=1&opp=bos')).status, 400)
    const r = await api('/defense-context?player=1&opp=BOS')
    assert.equal(r.status, 200)
    assert.equal(r.body.data.available, false)
    assert.equal(r.body.data.model.adjustsPredictions, false)
  })
  it('serves the estimated defenders, team traits and meta from the snapshot tables, never a probability', async () => {
    const db = openScratch()
    try {
      db.prepare("INSERT INTO defense_team (team, metric, value_l10, value_s2d, pct_l10) VALUES ('BOS','p3a_rate',0.4,0.39,0.9)").run()
      db.prepare("INSERT INTO defense_matchup (player_id, player, opp, rank, defender_id, defender, weight, dpoe100, foul100, expo, direct_poss, role, conf, herf, direct) VALUES (7,'Test Guard','BOS',1,9,'Test Defender',0.6,1.4,1.5,0.9,35,'G',0.7,0.4,0.5)").run()
      for (const [k, v] of Object.entries({ as_of: '2026-10-31 09:00', matchups_through: '2026-10-30', dpoe_mean: '0', dpoe_sd: '1', defenders_rated: '300', games_with_matchups: '5000' })) db.prepare('INSERT OR REPLACE INTO defense_meta (key, value) VALUES (?, ?)').run(k, v)
    } finally { db.close() }
    const r = await api('/defense-context?player=7&opp=BOS')
    assert.equal(r.status, 200)
    assert.equal(r.body.data.available, true)
    assert.equal(r.body.data.matchup[0].defender, 'Test Defender')
    assert.equal(r.body.data.team[0].metric, 'p3a_rate')
    assert.equal(r.body.data.meta.matchups_through, '2026-10-30')
    assert.doesNotMatch(JSON.stringify(r.body.data), /probab|\bev\b/i)
    assert.equal((await api('/defense-context?player=8&opp=BOS')).body.data.matchup.length, 0, 'another player has no estimated defenders, only the team traits')
  })
})

describe('/api/game-lean (display-only game-winner view)', () => {
  it('returns snapshot rows with the model status, and an empty list when there is no snapshot', async () => {
    const empty = await api('/game-lean')
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.body.data.rows, [])
    assert.equal(empty.body.data.model.evaluated, true)
    const db = openScratch()
    try {
      const today = new Date().toISOString().slice(0, 10)
      db.prepare("INSERT INTO game_lean (date, home, away, model_home_prob, elo_home, elo_away, home_net10, away_net10, home_off20, home_def20, away_off20, away_def20, as_of) VALUES (?, 'BOS', 'NYK', 0.61, 1560, 1520, 3.1, -1.2, 117, 111, 112, 113, 'x')").run(today)
    } finally { db.close() }
    const r = await api('/game-lean')
    assert.equal(r.body.data.rows.length, 1)
    assert.equal(r.body.data.rows[0].home, 'BOS')
    assert.doesNotMatch(JSON.stringify(r.body.data.model), /profit|edge/i)
  })
})
