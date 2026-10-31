import assert from 'node:assert/strict'
import { test } from 'node:test'
import { americanToDecimal, parseEspnOdds } from './espnOdds.ts'

test('american odds convert to decimal', () => {
  assert.ok(Math.abs(americanToDecimal('+210')! - 3.1) < 1e-9)
  assert.ok(Math.abs(americanToDecimal('-150')! - (1 + 100 / 150)) < 1e-9)
  assert.equal(americanToDecimal('EVEN'), 2)
  assert.equal(americanToDecimal('abc'), null)
  assert.equal(americanToDecimal(undefined), null)
})

const comp = (extra: object = {}) => ({ odds: [{ provider: { displayName: 'Draft Kings' }, spread: 6.5, overUnder: 232.5, homeTeamOdds: { favorite: false }, awayTeamOdds: { favorite: true },
  moneyline: { home: { close: { odds: '+210' } }, away: { close: { odds: '-250' } } }, ...extra }] })

test('parses prices, the book, the total and the home spread from the favourite flag', () => {
  const g = parseEspnOdds(comp())!
  assert.equal(g.book, 'Draft Kings')
  assert.ok(Math.abs(g.home - 3.1) < 1e-9 && Math.abs(g.away - 1.4) < 1e-9)
  assert.equal(g.spread, 6.5, 'the away team is favoured, so the home team gets points')
  assert.equal(g.total, 232.5)
  assert.ok(g.homeWinProb > 0.30 && g.homeWinProb < 0.32, "0.3226 / (0.3226 + 0.7143)")
  assert.equal(parseEspnOdds(comp({ spread: 3, homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }))!.spread, -3)
})

test('the no-margin chance is the book price with the margin removed', () => {
  const g = parseEspnOdds(comp({ moneyline: { home: { close: { odds: '-110' } }, away: { close: { odds: '-110' } } } }))!
  assert.ok(Math.abs(g.homeWinProb - 0.5) < 1e-12)
})

test('missing or malformed odds give null, never a guess', () => {
  assert.equal(parseEspnOdds({}), null)
  assert.equal(parseEspnOdds({ odds: [] }), null)
  assert.equal(parseEspnOdds(comp({ moneyline: { home: { close: { odds: '+210' } } } })), null)
  assert.equal(parseEspnOdds(comp({ moneyline: { home: { close: { odds: 'x' } }, away: { close: { odds: '-110' } } } })), null)
})

test('falls back to the opening price when no current one is posted', () => {
  const g = parseEspnOdds(comp({ moneyline: { home: { open: { odds: '+100' } }, away: { open: { odds: '-120' } } } }))!
  assert.equal(g.home, 2)
})
