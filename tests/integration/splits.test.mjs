// Run: npm run test:integration. "With / without a teammate" splits, on a hand-built stint.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

const ME = 9000001, MATE = 9000002, TEAM = 777
// date -> who played. g1: the teammate has not arrived yet. g7: he was traded away for good. g8: he is on another team.
const DAYS = [
  ['2026-01-01', { me: true, mate: false }],
  ['2026-01-02', { me: true, mate: true }],
  ['2026-01-03', { me: true, mate: false }],   // without
  ['2026-01-04', { me: true, mate: true }],
  ['2026-01-05', { me: true, mate: false }],   // without
  ['2026-01-06', { me: true, mate: true }],
  ['2026-01-07', { me: true, mate: false }],
  ['2026-01-08', { me: true, mate: 'elsewhere' }],
]
let app

before(async () => {
  app = await start({
    seed: (db) => {
      db.prepare("INSERT INTO players (id, name, team) VALUES (?, 'Split Me', 'TST'), (?, 'Split Mate', 'TST')").run(ME, MATE)
      DAYS.forEach(([date, who], i) => {
        const gid = 9100001 + i
        db.prepare("INSERT INTO games (id, date, season, home_team_id, visitor_team_id, game_type) VALUES (?, ?, 2025, ?, 1, 'regular')").run(gid, date, TEAM)
        const row = db.prepare("INSERT INTO player_games (player_id, game_id, team_id, minutes, pts, reb, ast, fg3m, stl, blk) VALUES (?, ?, ?, 30, ?, 5, 5, 1, 0, 0)")
        if (who.me) row.run(ME, gid, TEAM, 10 + i)
        if (who.mate === true) row.run(MATE, gid, TEAM, 20)
        if (who.mate === 'elsewhere') row.run(MATE, gid, 888, 20)
      })
      // the stint ends on 01-06: no later game for the teammate with this team (g8 is for team 888)
    },
  })
})
after(async () => { await app?.stop() })

const dates = (r) => r.body.data.map((g) => g.date).sort()

describe('with / without a teammate', () => {
  it('without: only games he missed while he belonged to the team (not before he arrived, not after he left)', async () => {
    const r = await api(`/players/${ME}/log?without=${MATE}`)
    assert.equal(r.status, 200)
    assert.deepEqual(dates(r), ['2026-01-03', '2026-01-05'])
  })
  it('with: only games where he played for the same team', async () => {
    const r = await api(`/players/${ME}/log?with=${MATE}`)
    assert.deepEqual(dates(r), ['2026-01-02', '2026-01-04', '2026-01-06'])
  })
  it('no filter returns everything', async () => {
    assert.equal((await api(`/players/${ME}/log`)).body.data.length, 8)
  })
  it('rejects a bad teammate id and both filters at once', async () => {
    for (const q of ['without=abc', 'with=-1', 'without=1;DROP', `with=${MATE}&without=${MATE}`]) assert.equal((await api(`/players/${ME}/log?${q}`)).status, 400, q)
  })
  it('lists teammates with the number of games missed', async () => {
    const r = await api(`/players/${ME}/teammates`)
    assert.equal(r.status, 200)
    const mate = r.body.data.find((t) => t.id === MATE)
    assert.equal(mate.missed, 2)
  })
})
