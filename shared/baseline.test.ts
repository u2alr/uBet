// Run: npm test      (node:test, no dependencies)
// The reference values in testdata/golden_probs.json were computed with scipy, independently of this code.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import dispersionTable from './dispersion.json' with { type: 'json' }
import { describe, it } from 'node:test'
import {
  alphaAt, blendProb, distributionFor, expectedValue, hitRate, nbPOver, outcomeProbs, predict, predictV3, riskTier,
  type Dist, type Sample,
} from './baseline.ts'

const golden = JSON.parse(readFileSync(new URL('./testdata/golden_probs.json', import.meta.url), 'utf8')) as {
  kind: 'poisson' | 'nb' | 'normal'; params: Record<string, number>; line: number; over: number; under: number; push: number
}[]

const toDist = (r: (typeof golden)[number]): Dist =>
  r.kind === 'poisson' ? { kind: 'poisson', mu: r.params.mu }
    : r.kind === 'nb' ? { kind: 'nb', mu: r.params.mu, alpha: r.params.alpha }
      : { kind: 'normal', mu: r.params.mu, sd: r.params.sd }

// Small deterministic generator so failures reproduce.
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}
const samples = (values: number[], type: Sample['type'] = 'regular'): Sample[] => values.map((value) => ({ value, type }))

describe('outcomeProbs against scipy', () => {
  it('matches every reference case (Poisson, negative binomial, continuity-corrected normal)', () => {
    let worst = 0
    for (const r of golden) {
      const got = outcomeProbs(r.line, toDist(r))
      assert.ok(got, `null for ${JSON.stringify(r)}`)
      const tol = r.kind === 'normal' ? 3e-7 : 1e-9 // the normal CDF is a 7e-8 approximation by design
      for (const k of ['over', 'under', 'push'] as const) {
        const err = Math.abs(got[k] - r[k])
        worst = Math.max(worst, err)
        assert.ok(err <= tol, `${r.kind} ${JSON.stringify(r.params)} line ${r.line} ${k}: got ${got[k]}, scipy ${r[k]}`)
      }
    }
    console.log(`      ${golden.length} cases, largest difference ${worst.toExponential(2)}`)
  })

  it('worked example anyone can check by hand: Poisson(3) at a line of 3', () => {
    const p = outcomeProbs(3, { kind: 'poisson', mu: 3 })!
    assert.ok(Math.abs(p.push - 0.224042) < 1e-6) // P(X = 3)
    assert.ok(Math.abs(p.under - 0.423190) < 1e-6) // P(X <= 2)
    assert.ok(Math.abs(p.over - 0.352768) < 1e-6) // P(X >= 4)
  })
})

describe('boundaries and ties (regression: Under used to be 1 - Over, handing the tie to the Under)', () => {
  it('whole-number line: over + under + push = 1, and push is the tie probability', () => {
    const p = outcomeProbs(24, { kind: 'nb', mu: 24, alpha: 0.1 })!
    assert.ok(p.push > 0.03, 'a tie at the mean must be a real probability')
    assert.ok(Math.abs(p.over + p.under + p.push - 1) < 1e-12)
    assert.ok(p.under < 1 - p.over - 0.03, 'under must NOT absorb the tie')
  })

  it('half-point line: no push, and under is exactly 1 - over', () => {
    const p = outcomeProbs(24.5, { kind: 'nb', mu: 24, alpha: 0.1 })!
    assert.equal(p.push, 0)
    assert.ok(Math.abs(p.over + p.under - 1) < 1e-12)
  })

  it('for a count, over L and over L+0.5 are the same event when L is a whole number', () => {
    for (const d of [{ kind: 'poisson', mu: 3 }, { kind: 'nb', mu: 8, alpha: 0.2 }, { kind: 'normal', mu: 18, sd: 5 }] as Dist[]) {
      for (const L of [0, 1, 2, 5, 9, 18, 25]) {
        assert.ok(Math.abs(outcomeProbs(L, d)!.over - outcomeProbs(L + 0.5, d)!.over) < 1e-12, `${d.kind} line ${L}`)
      }
    }
  })

  it('P(over) never increases as the line rises', () => {
    for (const d of [{ kind: 'poisson', mu: 2.5 }, { kind: 'nb', mu: 22, alpha: 0.3 }, { kind: 'normal', mu: 30, sd: 8 }] as Dist[]) {
      let prev = 1
      for (let L = 0; L <= 80; L += 0.5) {
        const o = outcomeProbs(L, d)!.over
        assert.ok(o <= prev + 1e-12, `${d.kind} rose at line ${L}`)
        prev = o
      }
    }
  })

  it('line 0 and a mean of 0 behave (a player cannot score a negative amount)', () => {
    const p = outcomeProbs(0, { kind: 'poisson', mu: 0 })!
    assert.deepEqual(p, { over: 0, under: 0, push: 1 })
    const q = outcomeProbs(0.5, { kind: 'nb', mu: 0, alpha: 0.2 })!
    assert.deepEqual(q, { over: 0, under: 1, push: 0 })
  })
})

describe('invalid input is rejected, never turned into a confident number', () => {
  const ok: Dist = { kind: 'nb', mu: 5, alpha: 0.1 }
  it('bad lines', () => {
    for (const line of [NaN, Infinity, -Infinity, -1, -0.5, 301, 1e9]) assert.equal(outcomeProbs(line, ok), null, `line ${line}`)
  })
  it('bad distributions', () => {
    for (const d of [
      { kind: 'poisson', mu: NaN }, { kind: 'poisson', mu: -1 }, { kind: 'poisson', mu: 501 },
      { kind: 'nb', mu: 5, alpha: NaN }, { kind: 'nb', mu: 5, alpha: -0.1 }, { kind: 'nb', mu: 5, alpha: 1001 },
      { kind: 'normal', mu: 5, sd: 0 }, { kind: 'normal', mu: 5, sd: -1 }, { kind: 'normal', mu: Infinity, sd: 1 },
    ] as Dist[]) assert.equal(outcomeProbs(10.5, d), null, JSON.stringify(d))
  })
  it('nbPOver returns NaN (not a plausible-looking number) for bad input', () => {
    assert.ok(Number.isNaN(nbPOver(NaN, 5, 0.1)))
    assert.ok(Number.isNaN(nbPOver(-3, 5, 0.1)))
    assert.ok(Number.isNaN(nbPOver(24.5, NaN, 0.1)))
  })
})

describe('cost is bounded (regression: line=Infinity looped forever)', () => {
  const quick = (f: () => unknown) => {
    const t = performance.now()
    f()
    return performance.now() - t
  }
  it('extreme but valid inputs return promptly', () => {
    assert.ok(quick(() => outcomeProbs(300, { kind: 'nb', mu: 500, alpha: 1000 })) < 100)
    assert.ok(quick(() => outcomeProbs(300, { kind: 'poisson', mu: 500 })) < 100)
    assert.ok(quick(() => outcomeProbs(300, { kind: 'poisson', mu: 0.05 })) < 100)
  })
  it('predict() with an absurd line returns null at once', () => {
    const s = samples(Array(10).fill(2))
    for (const line of [Infinity, 1e308, 1e9]) assert.ok(quick(() => assert.equal(predict(s, line), null)) < 50, `line ${line}`)
  })
})

describe('fuzz: every output is finite, in [0, 1] and sums to 1', () => {
  it('3000 random valid inputs', () => {
    const r = rng(42)
    for (let i = 0; i < 3000; i++) {
      const mu = r() < 0.2 ? 0 : r() * 60
      const line = r() < 0.5 ? Math.floor(r() * 70) : Math.floor(r() * 70) + 0.5
      const d: Dist = [
        { kind: 'poisson', mu } as Dist,
        { kind: 'nb', mu, alpha: r() * 2 } as Dist,
        { kind: 'normal', mu, sd: 0.3 + r() * 15 } as Dist,
      ][i % 3]
      const o = outcomeProbs(line, d)!
      for (const k of ['over', 'under', 'push'] as const) assert.ok(Number.isFinite(o[k]) && o[k] >= 0 && o[k] <= 1, `${JSON.stringify(d)} ${line} ${k}=${o[k]}`)
      assert.ok(Math.abs(o.over + o.under + o.push - 1) < 1e-9, JSON.stringify([d, line, o]))
      if (!Number.isInteger(line)) assert.equal(o.push, 0)
    }
  })
})

describe('predict()', () => {
  it('half-point lines are unchanged from the previous implementation', () => {
    // Frozen copy of the previous Poisson / normal tail, written independently of the new code.
    const legacy = (vals: number[], line: number) => {
      const w = vals.map((_, i) => 0.93 ** i)
      const sw = w.reduce((a, b) => a + b, 0)
      const mean = vals.reduce((a, v, i) => a + w[i] * v, 0) / sw
      const sd = Math.sqrt(vals.reduce((a, v, i) => a + w[i] * (v - mean) ** 2, 0) / sw)
      const nEff = (sw * sw) / w.reduce((a, b) => a + b * b, 0)
      const spread = Math.max(sd * (1 + 1 / Math.max(nEff, 1)), 0.5)
      if (mean < 6) {
        const lam = Math.max(mean, 0.05)
        let term = Math.exp(-lam), sum = term
        for (let i = 1; i <= Math.floor(line); i++) { term *= lam / i; sum += term }
        return 1 - Math.min(sum, 1)
      }
      const z = (line - mean) / spread
      const t = 1 / (1 + 0.2316419 * Math.abs(z))
      const dd = 0.3989423 * Math.exp((-z * z) / 2)
      const p = dd * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
      return 1 - (z > 0 ? 1 - p : p)
    }
    const r = rng(7)
    for (let i = 0; i < 300; i++) {
      const base = [1.2, 3, 5, 9, 18, 28][i % 6]
      const vals = Array.from({ length: 8 + (i % 40) }, () => Math.max(0, Math.round(base + (r() - 0.5) * base)))
      const line = Math.floor(base * (0.6 + r() * 0.8)) + 0.5
      const got = predict(samples(vals), line)!.pOver
      assert.ok(Math.abs(got - legacy(vals, line)) < 1e-12, `case ${i}: ${got} vs ${legacy(vals, line)}`)
    }
  })

  it('over + under + push = 1 and the inputs are validated', () => {
    const p = predict(samples([20, 25, 22, 30, 18, 24, 27, 21]), 24)!
    assert.ok(Math.abs(p.pOver + p.pUnder + p.pPush - 1) < 1e-12)
    assert.ok(p.pPush > 0)
    assert.equal(predict(samples([1, 2, 3, 4]), 2.5), null, 'needs 5 games')
    assert.equal(predict(samples([1, 2, 3, 4, NaN]), 2.5), null, 'non-finite history')
    assert.equal(predict(samples([1, 2, 3, 4, -1]), 2.5), null, 'negative count')
    assert.equal(predict(samples([1, 2, 3, 4, 5]), NaN), null)
  })

  it('effectiveGames is positive and never exceeds the games used', () => {
    const p = predict(samples(Array.from({ length: 30 }, (_, i) => 20 + (i % 5))), 21.5)!
    assert.ok(p.effectiveGames > 1 && p.effectiveGames <= p.sample)
  })
})

describe('hitRate', () => {
  it('a tie is a refund: neither a win nor a loss', () => {
    assert.equal(hitRate([10, 10, 10, 12], 10, 4), 1) // one decided game, a win
    assert.equal(hitRate([10, 10, 10, 12], 10, 4, 'under'), 0)
    assert.equal(hitRate([10, 10, 10], 10, 3), null) // nothing decided
  })
  it('half-point lines are the plain share of games over', () => {
    assert.equal(hitRate([12, 8, 11, 9], 9.5, 4), 0.5)
    assert.equal(hitRate([12, 8, 11, 9], 9.5, 4, 'under'), 0.5)
    assert.equal(hitRate([], 9.5, 4), null)
  })
})

describe('blendProb, expectedValue, riskTier', () => {
  it('stays within [0, 1] even for out-of-range inputs', () => {
    for (const [m, k, w] of [[0, 1, 0], [1, 0, 1], [-5, 7, 5], [0.5, null, 0.3], [2, null, -9], [0.9, 0.1, 0.3]] as const) {
      const b = blendProb(m, k, w)
      assert.ok(Number.isFinite(b) && b >= 0 && b <= 1, `${m} ${k} ${w} -> ${b}`)
    }
  })
  it('agreement returns the shared value', () => {
    assert.ok(Math.abs(blendProb(0.6, 0.6) - 0.6) < 1e-12)
  })
  it('the market gets the larger weight, and less trust is given to a model that disagrees wildly', () => {
    assert.ok(Math.abs(blendProb(0.55, 0.5) - 0.5) < Math.abs(blendProb(0.55, 0.5) - 0.55))
    // model 0.9 vs market 0.5 is a big gap: halved weight, so the result sits closer to the market than at 0.7 vs 0.5
    assert.ok((blendProb(0.9, 0.5) - 0.5) / 0.4 < (blendProb(0.7, 0.5) - 0.5) / 0.2)
  })
  it('without a market the result is pulled toward 50%', () => {
    assert.ok(blendProb(0.9, null) < 0.9 && blendProb(0.9, null) > 0.5)
    assert.ok(blendProb(0.1, null) > 0.1 && blendProb(0.1, null) < 0.5)
  })
  it('expected value: fair bet is 0, a refund scales the stake at risk', () => {
    assert.ok(Math.abs(expectedValue(0.5, 0, 2)) < 1e-12)
    assert.ok(Math.abs(expectedValue(0.55, 0, 2) - 0.1) < 1e-12)
    assert.ok(Math.abs(expectedValue(0.55, 0.2, 2) - 0.08) < 1e-12)
    assert.equal(expectedValue(0.9, 1, 3), 0) // always refunded
  })
  it('risk tiers', () => {
    assert.equal(riskTier(0.7), 'safe')
    assert.equal(riskTier(0.5), 'balanced')
    assert.equal(riskTier(0.3), 'risky')
  })
})

describe('game-type weights (regression: swapping the playoff weights went unnoticed)', () => {
  // newest first: five playoff games at 30, then ten regular-season games at 10
  const mixed = [...Array(5).fill(30).map((value) => ({ value, type: 'playoffs' as const })), ...Array(10).fill(10).map((value) => ({ value, type: 'regular' as const }))]
  const expected = (wPlayoff: number, wRegular: number) => {
    let sw = 0, sm = 0
    mixed.forEach((s, i) => { const w = (s.type === 'playoffs' ? wPlayoff : wRegular) * 0.93 ** i; sw += w; sm += w * s.value })
    return sm / sw
  }
  it('before a regular-season game, playoff games count 0.6 and regular games 1.0', () => {
    assert.ok(Math.abs(predict(mixed, 20.5, 'regular')!.predicted - expected(0.6, 1)) < 1e-9)
  })
  it('before a playoff game, playoff games count 1.2 and regular games 0.7', () => {
    assert.ok(Math.abs(predict(mixed, 20.5, 'playoffs')!.predicted - expected(1.2, 0.7)) < 1e-9)
  })
  it('preseason games count 0.3 whatever comes next', () => {
    const pre = [...Array(5).fill(30).map((value) => ({ value, type: 'preseason' as const })), ...Array(10).fill(10).map((value) => ({ value, type: 'regular' as const }))]
    let sw = 0, sm = 0
    pre.forEach((s, i) => { const w = (s.type === 'preseason' ? 0.3 : 1) * 0.93 ** i; sw += w; sm += w * s.value })
    for (const up of ['regular', 'playoffs'] as const) {
      const w2 = pre.map((s, i) => (s.type === 'preseason' ? 0.3 : up === 'playoffs' ? 0.7 : 1) * 0.93 ** i)
      const m2 = pre.reduce((a, s, i) => a + w2[i] * s.value, 0) / w2.reduce((a, b) => a + b, 0)
      assert.ok(Math.abs(predict(pre, 20.5, up)!.predicted - m2) < 1e-9, up)
    }
    assert.ok(sw > 0 && sm > 0)
  })
})

describe('baseline-v3 (opt-in): negative-binomial tails chosen per statistic', () => {
  it('dispersion is interpolated between fitted points and held flat beyond the ends', () => {
    const lo = alphaAt('pts', 0.1), hi = alphaAt('pts', 500)
    assert.equal(alphaAt('pts', 0), lo)
    assert.equal(alphaAt('pts', 1000), hi)
    assert.ok(lo > hi, 'low-scoring players are far more dispersed than stars')
    // halfway between two fitted points gives the midpoint of their dispersions
    const { centers, alphas } = dispersionTable.dispersion.pts
    for (let i = 1; i < centers.length; i++) {
      const mid = (alphaAt('pts', (centers[i - 1] + centers[i]) / 2))
      assert.ok(Math.abs(mid - (alphas[i - 1] + alphas[i]) / 2) < 1e-9, `between points ${i - 1} and ${i}`)
      assert.ok(Math.abs(alphaAt('pts', centers[i]) - alphas[i]) < 1e-12)
    }
  })

  it('follows the pre-registered policy table', () => {
    assert.equal(distributionFor('pts', 12, 6).kind, 'normal') // stars: the native rule survives
    assert.equal(distributionFor('pts', 4, 3).kind, 'nb')
    assert.equal(distributionFor('reb', 9, 3).kind, 'nb')
    assert.equal(distributionFor('fg3m', 7, 2).kind, 'normal')
    assert.equal(distributionFor('stl', 3, 1).kind, 'poisson') // too few rows to justify a change
    // constant-dispersion cells use ONE value per statistic, whatever the mean
    for (const mean of [0.2, 0.5, 1.9]) {
      const c = distributionFor('blk', mean, 0.5)
      assert.ok(c.kind === 'nb' && c.alpha === dispersionTable.dispersion.blk.constant, `blk mean ${mean}`)
    }
    // bucket edges: below 2 is the low bucket, 2 and above is the middle bucket
    const lowAst = distributionFor('ast', 1.99, 1)
    const midAst = distributionFor('ast', 2, 1)
    assert.ok(lowAst.kind === 'nb' && lowAst.alpha === dispersionTable.dispersion.ast.constant)
    assert.ok(midAst.kind === 'nb' && midAst.alpha === alphaAt('ast', 2) && midAst.alpha !== lowAst.alpha)
    assert.equal(distributionFor('stl', 2.5, 1).kind, 'poisson') // the middle bucket keeps the native rule for steals
    assert.equal(distributionFor('stl', 1.99, 1).kind, 'nb')
    // 6 is the edge between the middle and high buckets
    assert.equal(distributionFor('pts', 5.99, 3).kind, 'nb')
    assert.equal(distributionFor('pts', 6, 3).kind, 'normal')
  })

  it('is identical to the current model wherever the policy keeps the native rule', () => {
    const vals = [24, 27, 22, 30, 19, 25, 28, 21, 26, 23, 29, 20, 24, 27, 25]
    for (const line of [22.5, 24.5, 27.5]) {
      const a = predict(samples(vals), line)!, b = predictV3('pts', samples(vals), line)!
      assert.equal(a.pOver, b.pOver)
      assert.equal(b.model, 'baseline-v3')
    }
  })

  it('is more dispersed than Poisson for rebounds, which is why it was adopted', () => {
    const vals = [2, 5, 3, 7, 1, 4, 6, 3, 2, 8, 3, 4]
    const v2 = predict(samples(vals), 8.5)!.pOver
    const v3 = predictV3('reb', samples(vals), 8.5)!.pOver
    assert.ok(v3 > v2, `${v3} should exceed ${v2}: the heavier tail makes a big game likelier`)
  })

  it('over + under + push = 1, and invalid input is rejected', () => {
    const s = samples([3, 5, 2, 4, 6, 3, 4, 5, 2, 3])
    for (const line of [3, 3.5, 4]) {
      const p = predictV3('ast', s, line)!
      assert.ok(Math.abs(p.pOver + p.pUnder + p.pPush - 1) < 1e-12)
    }
    assert.equal(predictV3('ast', s, NaN), null)
    assert.equal(predictV3('ast', s, Infinity), null)
    assert.equal(predictV3('ast', samples([1, 2]), 3.5), null)
  })
})
