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
  it('carries the same lineup data as the Lineups tab, so the two pages agree on who is out', async () => {
    const { body } = await api('/team-bets')
    const lineups = (await api('/lineups')).body.data.games
    const withLineup = body.data.games.filter((g) => g.lineup)
    assert.ok(withLineup.length > 0)
    for (const g of withLineup) {
      const other = lineups.find((x) => x.id === g.id)
      if (!other) continue
      for (const side of ['home', 'away']) {
        const mine = g.lineup[side].flagged.filter((f) => f.status === 'out').map((f) => f.name).sort()
        const theirs = [...other[side].starters, ...other[side].nextUp].filter((p) => p.listing?.status === 'out').map((p) => p.name)
          .concat(other[side].alsoListed.filter((a) => a.listing.status === 'out').map((a) => a.name)).sort()
        assert.deepEqual(mine.slice(0, 6), theirs.slice(0, 6), `${g.home.abbr} ${side}`)
      }
      assert.deepEqual(g.lineup.home.starters, other.home.starters.map((p) => p.name))
    }
  })
  it('suggests no bets: no ranked list, no expected profit, no best-bet field, and the honesty note is there', async () => {
    const { body } = await api('/team-bets')
    assert.equal('best' in body.data, false)
    for (const g of body.data.games) {
      assert.equal('best' in g.bet, false)
      for (const side of ['home', 'away']) {
        if (g.bet.moneyline) { assert.equal('ev' in g.bet.moneyline[side], false); assert.equal('edge' in g.bet.moneyline[side], false) }
      }
    }
    assert.match(body.meta.note, /not been tested against sportsbook prices/)
  })
})
