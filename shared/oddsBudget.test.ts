import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MONTHLY_CREDITS, checkBudget, creditCost, monthKey, monthlyLimit } from './oddsBudget.ts'

test('the events list is free and an odds request costs one credit per market per region', () => {
  assert.equal(creditCost('/events', {}), 0)
  assert.equal(creditCost('/events/abc/odds', { regions: 'us', markets: 'player_points,player_rebounds,player_assists,player_points_rebounds_assists' }), 4)
  assert.equal(creditCost('/events/abc/odds', { regions: 'us,uk', markets: 'a,b,c' }), 6)
  assert.equal(creditCost('/odds', { regions: 'us', markets: 'h2h,spreads,totals' }), 3)
})

test('an odds request with missing parameters is charged at least one credit, never zero', () => {
  assert.equal(creditCost('/odds', {}), 1)
})

test('a request goes ahead only while the month has room for all of it', () => {
  assert.equal(checkBudget(100, 4, 450).allowed, true)
  assert.equal(checkBudget(446, 4, 450).allowed, true)
  assert.equal(checkBudget(447, 4, 450).allowed, false)
  assert.deepEqual(checkBudget(447, 4, 450), { allowed: false, used: 447, limit: 450, remaining: 3 })
  assert.equal(checkBudget(500, 0, 450).allowed, true, 'a free request is never blocked')
})

test('a missing or nonsense usage count is treated as nothing spent, and the limit falls back to the default', () => {
  assert.equal(checkBudget(Number.NaN, 4, 450).used, 0)
  assert.equal(checkBudget(-5, 4, 450).used, 0)
  assert.equal(monthlyLimit(undefined), DEFAULT_MONTHLY_CREDITS)
  assert.equal(monthlyLimit('abc'), DEFAULT_MONTHLY_CREDITS)
  assert.equal(monthlyLimit('0'), DEFAULT_MONTHLY_CREDITS)
  assert.equal(monthlyLimit('120.9'), 120)
})

test('the month key is the UTC month, so the count restarts when the plan does', () => {
  assert.equal(monthKey(Date.parse('2026-11-01T00:00:00Z')), '2026-11')
  assert.equal(monthKey(Date.parse('2026-10-31T23:59:59Z')), '2026-10')
})
