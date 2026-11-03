import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fairProb } from './devig.ts'
import { fairSpread, modelAgeHours, modelIsFresh, normInv, teamBet, type BookLine } from './teamBets.ts'

const book = (title: string, home: number, away: number, spread = -4.5): BookLine => ({ key: title.toLowerCase(), title, moneyline: { home, away }, spread: { point: spread, home: 1.91, away: 1.91 }, total: { point: 228.5, over: 1.91, under: 1.91 } })

test('the inverse normal curve matches known values', () => {
  assert.ok(Math.abs(normInv(0.5)) < 1e-9)
  assert.ok(Math.abs(normInv(0.975) - 1.959964) < 1e-5)
  assert.ok(Math.abs(normInv(0.1) + 1.281552) < 1e-5)
  assert.equal(normInv(0), -Infinity)
})

test('the market chance has each book margin removed on its own, and the best price on each side is kept with its book', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: null, books: [book('DraftKings', 1.556, 2.5), book('FanDuel', 1.562, 2.5)] })
  const p1 = fairProb(1.556, 2.5, 'power')!, p2 = fairProb(1.562, 2.5, 'power')!
  assert.ok(Math.abs(t.market.homeProb! - (p1 + p2) / 2) < 0.001)
  assert.ok(t.market.corroborated)
  assert.equal(t.moneyline!.home.price, 1.562)
  assert.equal(t.moneyline!.home.book, 'FanDuel')
  assert.equal(t.moneyline!.away.price, 2.5)
  assert.equal(t.market.spread, -4.5)
  assert.equal(t.market.total, 228.5)
})

test('with no model, our chance is the market chance and no side shows an edge', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: null, books: [book('DraftKings', 1.8, 2.1)] })
  assert.equal(t.moneyline!.home.edge, 0)
  assert.equal(t.moneyline!.home.modelProb, null)
  assert.ok(t.moneyline!.home.ev < 0, 'the margin makes a market-priced bet a small loss')
  assert.equal(t.best, null)
})

test('a model that likes the underdog more than the market moves our chance toward it, but only part of the way', () => {
  const books = [book('DraftKings', 1.5, 2.7)]
  const market = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: null, books }).market.homeProb!
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: 0.45, books })
  const away = t.moneyline!.away
  assert.ok(away.prob > 1 - market, 'we like the away side more than the market does')
  assert.ok(away.prob < 0.55, 'but we do not hand the model the whole decision')
  assert.ok(away.edge > 0 && away.ev > -0.1)
  assert.equal(away.modelProb, 0.55)
})

test('a clearly positive side is reported as the best bet; our fair prices have no margin', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: 0.2, books: [book('DraftKings', 1.45, 3.4), book('FanDuel', 1.46, 3.35)] })
  assert.equal(t.best?.side, 'away')
  assert.ok(t.best!.ev > 0)
  const f = t.ours!.fairMoneyline
  assert.ok(Math.abs(1 / f.home + 1 / f.away - 1) < 0.01)
})

test('our spread moves with our win chance, on the market scale', () => {
  const same = fairSpread(0.62, -4.5, 0.62)!
  assert.ok(Math.abs(same - -4.5) <= 0.5, 'matching the market gives back about the market spread')
  assert.ok(fairSpread(0.75, -4.5, 0.62)! < same, 'a likelier home win means a bigger home favourite')
  assert.ok(fairSpread(0.45, -4.5, 0.62)! > 0, 'below a coin flip the home team is the underdog')
  assert.equal(fairSpread(1, -4.5, 0.6), null)
})

test('a game no book prices and no model has seen gives no bets and no numbers instead of invented ones', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: null, books: [] })
  assert.equal(t.moneyline, null)
  assert.equal(t.best, null)
  assert.equal(t.ours, null)
})

test('with no price the model still gives its own chance and spread, but never a bet or an expected profit', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: 0.7, modelMargin: 6.2, books: [] })
  assert.equal(t.moneyline, null)
  assert.equal(t.best, null)
  assert.equal(t.ours!.homeProb, 0.7)
  assert.equal(t.ours!.spread, -6)
  assert.ok(Math.abs(1 / t.ours!.fairMoneyline.home + 1 / t.ours!.fairMoneyline.away - 1) < 0.01)
})

test('with a market, the expected margin from the ratings sets our spread', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: 0.7, modelMargin: 6.2, books: [book('DraftKings', 1.5, 2.7)] })
  assert.equal(t.ours!.spread, -6)
})

test('a stale best price is capped at the runner-up, so it cannot fake an edge', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: null, books: [book('DraftKings', 1.8, 2.1), book('FanDuel', 1.82, 2.08), book('Stale', 2.6, 2.1)] })
  assert.equal(t.moneyline!.home.priceCapped, true)
  assert.equal(t.moneyline!.home.price, 1.82)
  assert.equal(t.moneyline!.away.priceCapped, false)
})

test('one far-off book is dropped from the market chance when three or more quote, and is counted', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: null, books: [book('A', 1.8, 2.1), book('B', 1.81, 2.09), book('C', 1.79, 2.12), book('Odd', 1.3, 3.8)] })
  assert.equal(t.market.booksDropped, 1)
  assert.equal(t.market.booksUsed, 3)
  assert.ok(Math.abs(t.market.homeProb! - 0.54) < 0.02)
})

test('a single book is shown but not marked as corroborated', () => {
  const t = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: null, books: [book('Only', 1.8, 2.1)] })
  assert.equal(t.market.corroborated, false)
  assert.equal(t.moneyline!.home.priceCapped, false)
})

test('a model snapshot is fresh for a day and a half, and a missing or unreadable stamp counts as stale', () => {
  const now = Date.parse('2026-11-03T12:00:00Z')
  assert.equal(modelIsFresh('2026-11-03T06:00:00Z', now), true)
  assert.equal(modelIsFresh('2026-11-03 06:00:00', now), true)
  assert.equal(modelIsFresh('2026-11-01T06:00:00Z', now), false)
  assert.equal(modelIsFresh(null, now), false)
  assert.equal(modelIsFresh('not a date', now), false)
  assert.ok(Math.abs(modelAgeHours('2026-11-03T06:00:00Z', now)! - 6) < 1e-9)
})

test('a single-book game never produces a recommended bet, even when the model disagrees strongly', () => {
  const one = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: 0.3, books: [book('Only', 1.5, 2.7)] })
  assert.ok(one.moneyline!.away.ev > 0, 'the numbers alone would show an edge')
  assert.equal(one.best, null)
  const two = teamBet({ home: 'CLE', away: 'OKC', modelHomeProb: 0.3, books: [book('A', 1.5, 2.7), book('B', 1.5, 2.7)] })
  assert.ok(two.best != null)
})
