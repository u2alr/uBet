// Run: npm test. One authoritative calculation: every screen shows the numbers the engine computes.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyAuthority } from './authority.ts'
import { makeConfig } from './config.ts'
import { binaryExpectedReturn } from './payoff.ts'
import { NOW, identityArtifact, mkPick, resetFixtureCounter, withMarket } from './fixtures.ts'
import type { Pick } from '../picks.ts'

const config = makeConfig(), calibration = identityArtifact()
const ctx = { now: NOW, config, calibration, injuryChecked: true }

const slate = (): Pick[] => {
  resetFixtureCounter()
  return [
    withMarket(mkPick({ modelProb: 0.66, oppFactor: 1.08 }), 2.0, 2.0),
    withMarket(mkPick({ modelProb: 0.76 }), 1.55, 2.5),
    withMarket(mkPick({ modelProb: 0.54, oppFactor: 1.08 }), 2.3, 1.7),
    mkPick({ modelProb: 0.58 }),
    mkPick({ side: 'under', modelProb: 0.57 }),
  ]
}

describe('screens read the engine records', () => {
  it('expected value is the canonical payoff at the executable price, not a second formula', () => {
    for (const p of applyAuthority(slate(), ctx).filter((x) => x.basis === 'authoritative')) {
      assert.ok(Math.abs(p.ev - binaryExpectedReturn(p.prob, p.push, p.auth!.price.executable!)) < 1e-12)
    }
  })
})

describe('when the engine cannot compute, the older blend is kept and labelled, never mixed in as if validated', () => {
  it('a fallback-model pick, a missing calibration artifact and an uncorroborated price are all legacy', () => {
    resetFixtureCounter()
    const fallback = withMarket(mkPick({ model: 'baseline-v2' as never }), 2.0, 2.0)
    const [f] = applyAuthority([fallback], ctx)
    assert.equal(f.basis, 'legacy'); assert.equal(f.prob, fallback.prob); assert.equal(f.ev, fallback.ev)
    const noCal = applyAuthority([withMarket(mkPick({ modelProb: 0.66 }), 2.0, 2.0)], { ...ctx, calibration: null })[0]
    assert.equal(noCal.basis, 'legacy')
    const lone = applyAuthority([withMarket(mkPick({ modelProb: 0.66 }), 2.0, 2.0, ['draftkings'])], ctx)[0]
    assert.equal(lone.basis, 'legacy', 'one book cannot corroborate a price')
    assert.ok(lone.auth && lone.auth.price.rejection)
  })
  it('legacy numbers are retained on every pick and the input is not modified', () => {
    const picks = slate(), before = JSON.stringify(picks)
    const out = applyAuthority(picks, ctx)
    assert.equal(JSON.stringify(picks), before)
    for (const [i, p] of out.entries()) { assert.equal(p.legacy!.prob, picks[i].prob); assert.equal(p.legacy!.ev, picks[i].ev) }
  })
  it('the replacement happens once: a second pass changes nothing', () => {
    const once = applyAuthority(slate(), ctx)
    assert.deepEqual(applyAuthority(once, ctx), once)
  })
})

describe('quote freshness is judged at the snapshot, so cached odds still agree across screens', () => {
  it('quotes that were fresh when retrieved give the same numbers hours later; without a snapshot time the same quotes are stale', () => {
    resetFixtureCounter()
    const p = withMarket(mkPick({ modelProb: 0.66 }), 2.0, 2.0)                       // quotes were 10 minutes old at NOW
    const later = { ...ctx, now: NOW + 6 * 3600_000 }
    const atSnapshot = applyAuthority([{ ...p, snapshotAt: NOW }], later)[0]
    const noSnapshot = applyAuthority([p], later)[0]
    assert.equal(atSnapshot.basis, 'authoritative')
    assert.equal(noSnapshot.basis, 'legacy'); assert.equal(noSnapshot.auth!.price.rejection, 'NO_FRESH_QUOTE')
    assert.equal(atSnapshot.auth!.ev.raw, applyAuthority([p], ctx)[0].auth!.ev.raw)
  })
})
