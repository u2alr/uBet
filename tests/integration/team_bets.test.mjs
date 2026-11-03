// Run: npm run test:integration. /api/team-bets turns stored or fetched game odds into per-game team bets, and never invents a bet for a game no book prices.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { api, start } from './harness.mjs'

let app
before(async () => { app = await start() })
after(async () => { await app?.stop() })

describe('/api/team-bets', () => {
  it('lists each upcoming game with the market lines, the best price per side and our own fair prices', async () => {
    const { status, body } = await api('/team-bets')
    assert.equal(status, 200)
    const g = body.data.games.find((x) => x.home.abbr === 'DET')
    assert.ok(g, JSON.stringify(body.data.games.map((x) => x.home.abbr)))
    const { market, moneyline, ours } = g.bet
    assert.equal(market.spread, -2)            // the fake books quote -2.5 and -2; the median of two is the upper one
    assert.ok(market.total >= 224 && market.total <= 225)
    assert.ok(moneyline.home.price >= 1.8 && moneyline.away.price >= 2)
    assert.ok(Math.abs(1 / ours.fairMoneyline.home + 1 / ours.fairMoneyline.away - 1) < 0.01, 'our fair prices carry no margin')
    assert.equal(body.meta.oddsAvailable, true)
  })
  it('ranks only sides with positive expected profit, best first, and carries the honesty note', async () => {
    const { body } = await api('/team-bets')
    const evs = body.data.best.map((b) => b.ev)
    assert.ok(evs.every((e) => e > 0))
    assert.deepEqual(evs, [...evs].sort((a, b) => b - a))
    assert.match(body.meta.note, /not been tested against sportsbook prices/)
  })
})
