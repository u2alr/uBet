// Run: npm run test:integration. Once the odds sync has stored odds, a page load reads them and never calls the provider.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { gamesRow, propsRows, upsertSql } from '../../shared/oddsSnapshot.ts'
import { api, start, upstreamReset, upstreamStats } from './harness.mjs'

let app
const at = new Date(Date.now() + 5 * 3600_000).toISOString()
const book = (key, title, price) => ({ key, title, markets: [{ key: 'player_points', outcomes: [
  { name: 'Over', description: 'Cade Cunningham', price, point: 21.5, updated: new Date().toISOString() },
  { name: 'Under', description: 'Cade Cunningham', price: 1.95, point: 21.5, updated: new Date().toISOString() }] }] })
const props = { id: 'sync_det_bos', commence_time: at, home_team: 'Detroit Pistons', away_team: 'Boston Celtics', bookmakers: [book('draftkings', 'DraftKings', 1.9), book('fanduel', 'FanDuel', 1.92)] }
const game = { id: 'sync_det_bos', commence_time: at, home_team: 'Detroit Pistons', away_team: 'Boston Celtics', bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: [
  { key: 'h2h', outcomes: [{ name: 'Detroit Pistons', price: 2.1 }, { name: 'Boston Celtics', price: 1.75 }] },
  { key: 'spreads', outcomes: [{ name: 'Detroit Pistons', price: 1.91, point: 2.5 }, { name: 'Boston Celtics', price: 1.91, point: -2.5 }] },
  { key: 'totals', outcomes: [{ name: 'Over', price: 1.91, point: 221.5 }, { name: 'Under', price: 1.91, point: 221.5 }] }] }] }

before(async () => {
  app = await start({ extraBindings: ['CAPTURE_TOKEN=test-token-not-real'], seed: (db) => {
    db.exec('DELETE FROM odds_snapshot')
    const now = Date.now()
    for (const r of [gamesRow(game, now), ...propsRows(props, now)]) db.exec(upsertSql(r))
  } })
})
after(async () => { await app?.stop() })

describe('stored odds', () => {
  it('serve props without any call to the provider', async () => {
    await upstreamReset()
    const { status, body } = await api('/picks')
    assert.equal(status, 200)
    assert.ok(body.data.some((p) => p.player === 'Cade Cunningham' && p.line === 21.5), JSON.stringify(body.meta.warnings))
    assert.deepEqual(await upstreamStats(), {})
  })
  it('serve game odds without any call to the provider, labelled with their source', async () => {
    await upstreamReset()
    const { body } = await api('/games')
    const g = body.data.find((x) => x.home.name === 'Detroit Pistons')
    assert.equal(g.odds.spread, 2.5)
    assert.equal(g.odds.total, 221.5)
    assert.equal(g.odds.source, 'SharpAPI books')
    assert.deepEqual(await upstreamStats(), {})
  })
  it('a ?fresh=1 from a stranger still does not reach the provider', async () => {
    await upstreamReset()
    await api('/picks?fresh=1')
    await api('/games?fresh=1')
    assert.deepEqual(await upstreamStats(), {})
  })
  it('/status reports what is stored and how old it is', async () => {
    const { body } = await api('/status')
    assert.equal(body.odds.games, 1)
    assert.equal(body.odds.propGames, 1)
    assert.ok(Date.now() - body.odds.newest < 120_000)
  })
})
