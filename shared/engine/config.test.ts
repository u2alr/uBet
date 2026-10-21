import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ENGINE_CONFIG, makeConfig, stableHash, validateConfig } from './config.ts'

test('the defaults validate and are frozen', () => {
  const c = makeConfig()
  assert.equal(c.eligibility.minGamesStrict, 15)
  assert.equal(c.portfolio.maxStrictPerDay, 12)
  assert.throws(() => { (c.portfolio as { maxStrictPerDay: number }).maxStrictPerDay = 99 }, TypeError)
  assert.equal(DEFAULT_ENGINE_CONFIG.portfolio.maxStrictPerDay, 12, 'building a config never mutates the defaults')
})

test('overrides merge deeply and are validated', () => {
  const c = makeConfig({ val: { minEvConservative: 0.05 }, probability: { confidenceLevel: '95' } })
  assert.equal(c.val.minEvConservative, 0.05)
  assert.equal(c.val.minProbability, 0.5, 'untouched siblings keep their defaults')
  assert.equal(c.probability.confidenceLevel, '95')
})

test('invalid configurations are refused, with every problem named', () => {
  const bad = (o: Parameters<typeof makeConfig>[0]) => assert.throws(() => makeConfig(o), RangeError)
  bad({ eligibility: { minGamesResearch: 20 } })                    // research must not need more games than strict
  bad({ eligibility: { reviewGap: 0.3 } })                          // review must come before the extreme-gap veto
  bad({ eligibility: { minIndependentBooks: 1 } })
  bad({ probability: { marketWeight: 1.2 } })
  bad({ probability: { confidenceLevel: '99' as never } })
  bad({ portfolio: { maxStrictPerPlayerStat: 3 } })                 // the stricter rule must win
  bad({ portfolio: { maxStrictPerDay: 0 } })
  bad({ portfolio: { maxUnderShare: 0 } })
  bad({ market: { priceCorroboration: 1.5 } })
  bad({ market: { staleLineRatio: 1.01 } })
  bad({ lou: { minLegs: 6, maxLegs: 5 } })
  bad({ cat: { minGap: 0.3 } })
  bad({ volume: { minPrice: 3, maxPrice: 2 } })
  assert.throws(() => makeConfig({ eligibility: { reviewGap: 0.3, minIndependentBooks: 1 } }), (e: Error) => /reviewGap/.test(e.message) && /minIndependentBooks/.test(e.message))
  assert.throws(() => validateConfig({ ...DEFAULT_ENGINE_CONFIG, portfolio: { ...DEFAULT_ENGINE_CONFIG.portfolio, unitStake: NaN } }), RangeError)
})

test('stableHash is order-independent, and changes when any setting changes', () => {
  assert.equal(stableHash({ a: 1, b: { c: 2, d: 3 } }), stableHash({ b: { d: 3, c: 2 }, a: 1 }))
  assert.notEqual(stableHash(makeConfig()), stableHash(makeConfig({ val: { minEvConservative: 0.031 } })))
  assert.equal(stableHash(makeConfig()), stableHash(makeConfig()))
  assert.match(stableHash(1), /^[0-9a-f]{16}$/)
})
