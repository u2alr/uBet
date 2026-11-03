import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consensusProb, fairProb, median, power, proportional, shin } from './devig.ts'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

test('every method returns probabilities that add to 1', () => {
  for (const f of [proportional, power, shin]) {
    const p = f([1.5, 2.7])!
    assert.ok(Math.abs(sum(p) - 1) < 1e-9, f.name)
    assert.ok(p.every((x) => x > 0 && x < 1))
  }
})

test('an even market is 50/50 whatever the method', () => {
  for (const m of ['proportional', 'power', 'shin'] as const) assert.ok(Math.abs(fairProb(1.91, 1.91, m)! - 0.5) < 1e-9, m)
})

test('power and Shin give the favourite more than proportional does (favourite-longshot bias)', () => {
  const prop = fairProb(1.3, 3.9, 'proportional')!
  assert.ok(fairProb(1.3, 3.9, 'power')! > prop)
  assert.ok(fairProb(1.3, 3.9, 'shin')! > prop)
})

test('a market with no margin is left alone, and a margin below zero does not blow up', () => {
  assert.ok(Math.abs(fairProb(2, 2, 'power')! - 0.5) < 1e-9)
  const p = power([2.1, 2.1])!
  assert.ok(Math.abs(sum(p) - 1) < 1e-9)
})

test('bad prices are refused, not turned into numbers', () => {
  assert.equal(fairProb(1, 2), null)
  assert.equal(fairProb(0, 2), null)
  assert.equal(fairProb(NaN, 2), null)
  assert.equal(proportional([2, Infinity]), null)
  assert.equal(shin([1.5]), null)
})

test('median handles odd, even and empty lists', () => {
  assert.equal(median([]), null)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
})

test('consensus drops one far-off book when three or more quote, and reports it', () => {
  const c = consensusProb([0.6, 0.61, 0.59, 0.75])!
  assert.equal(c.dropped, 1)
  assert.equal(c.used, 3)
  assert.ok(Math.abs(c.prob - 0.6) < 1e-9)
})

test('with two books the mean is used and nothing is dropped; with none there is no answer', () => {
  const c = consensusProb([0.5, 0.6])!
  assert.ok(Math.abs(c.prob - 0.55) < 1e-9)
  assert.equal(c.dropped, 0)
  assert.equal(consensusProb([]), null)
  assert.equal(consensusProb([NaN, 0, 1]), null)
})
