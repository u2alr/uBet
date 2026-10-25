import { test } from 'node:test'
import assert from 'node:assert/strict'
import { myBetTotals, parseMyBet } from './mybets.ts'

const leg = (o: Record<string, unknown> = {}) => ({ playerId: 7, player: 'A Player', stat: 'pts', side: 'over', line: 20.5, price: 1.9, book: 'DraftKings', gameDate: '2026-10-24', ...o })

test('a valid bet parses, and the odds taken are kept exactly', () => {
  const r = parseMyBet({ stake: 25, note: ' lock ', legs: [leg(), leg({ playerId: 8, price: 2.05 })] })
  assert.ok(r.ok && r.bet.legs.length === 2 && r.bet.stake === 25 && r.bet.note === 'lock' && r.bet.legs[1].price === 2.05)
})

test('anything malformed is refused as a whole', () => {
  const bad: unknown[] = [null, [], 'x', {}, { stake: 0, legs: [leg()] }, { stake: -5, legs: [leg()] }, { stake: 'ten', legs: [leg()] }, { stake: 10, legs: [] },
    { stake: 10, legs: Array.from({ length: 13 }, (_, i) => leg({ playerId: i + 1 })) }, { stake: 10, legs: [leg({ stat: 'dunks' })] }, { stake: 10, legs: [leg({ side: 'push' })] },
    { stake: 10, legs: [leg({ price: 1 })] }, { stake: 10, legs: [leg({ price: Infinity })] }, { stake: 10, legs: [leg({ line: -1 })] }, { stake: 10, legs: [leg({ gameDate: '10/24/2026' })] },
    { stake: 10, legs: [leg({ playerId: 1.5 })] }, { stake: 10, legs: [leg({ player: '' })] }, { stake: 10, legs: [leg(), leg()] }, { stake: 10, legs: [leg(), 5] }]
  for (const b of bad) assert.equal(parseMyBet(b).ok, false, JSON.stringify(b)?.slice(0, 80))
})

test('PRA is an accepted statistic', () => {
  assert.equal(parseMyBet({ stake: 5, legs: [leg({ stat: 'pra', line: 33.5 })] }).ok, true)
})

test('totals: ROI counts only decided bets as risked; pushes and voids return the stake; open bets are not profit', () => {
  const t = myBetTotals([
    { stake: 10, status: 'won', profit: 9 }, { stake: 10, status: 'lost', profit: -10 }, { stake: 20, status: 'push', profit: 0 },
    { stake: 5, status: 'void', profit: 0 }, { stake: 50, status: 'open', profit: null },
  ])
  assert.deepEqual([t.bets, t.open, t.settled, t.won, t.lost, t.push, t.void], [5, 1, 4, 1, 1, 1, 1])
  assert.equal(t.profit, -1); assert.equal(t.staked, 20); assert.equal(t.roi, -0.05)
  assert.equal(myBetTotals([]).roi, null)
  assert.equal(myBetTotals([{ stake: 10, status: 'open', profit: null }]).roi, null)
})
