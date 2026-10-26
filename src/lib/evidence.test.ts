import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceInfo, summarize } from './evidence.ts'
import { applyAuthority } from '../../shared/engine/authority.ts'
import { makeConfig } from '../../shared/engine/config.ts'
import { NOW, identityArtifact, mkPick, resetFixtureCounter, withMarket } from '../../shared/engine/fixtures.ts'
import { evRank, sortCards, toCards } from './propsBoard.ts'
import { likelyPicks, valuePicks } from './picks.ts'

const ctx = { now: NOW, config: makeConfig(), calibration: identityArtifact(), injuryChecked: true }
const one = (p: ReturnType<typeof mkPick>) => applyAuthority([p], ctx)[0]

test('a pick that is very likely to win can still lose money on average: its label says nothing about safety', () => {
  resetFixtureCounter()
  const likely = one(withMarket(mkPick({ modelProb: 0.7 }), 1.35, 3.1))      // about 70% to win at a price that is too short
  assert.ok(likely.prob > 0.65, `win chance ${likely.prob}`)
  assert.ok(likely.ev < 0, `expected value ${likely.ev}`)
  const s = summarize(likely)
  assert.ok(s.winChance > 0.65 && s.ev < 0)
  for (const word of ['safe', 'risk', 'low-risk', 'guarantee']) assert.equal(new RegExp(word, 'i').test(`${s.evidence.label} ${s.evidence.detail.join(' ')}`.replace('not a guarantee', '')), false, word)
})

test('a pick that is unlikely to win can have positive expected value; nothing marks it "risky" or hides it', () => {
  resetFixtureCounter()
  const longshot = one(withMarket(mkPick({ modelProb: 0.4 }), 3.0, 1.4))
  assert.ok(longshot.prob < 0.4, `win chance ${longshot.prob}`)
  assert.ok(longshot.ev > 0, `expected value ${longshot.ev}`)
  assert.equal(longshot.basis, 'authoritative')
})

test('evidence labels describe the evidence only, for each way a pick can stand', () => {
  resetFixtureCounter()
  const strict = one(withMarket(mkPick({ modelProb: 0.66, oppFactor: 1.08 }), 2.0, 2.0))
  assert.deepEqual([strict.auth!.evidence, evidenceInfo(strict).kind], ['strict', 'strict'])
  const thin = one(withMarket(mkPick({ sample: 12 }), 2.0, 2.0))
  assert.equal(evidenceInfo(thin).kind, 'research'); assert.ok(evidenceInfo(thin).detail.length > 0)
  const injured = one(withMarket(mkPick({ injury: { status: 'out', label: 'Out', note: '' } as never }), 2.0, 2.0))
  assert.equal(evidenceInfo(injured).kind, 'insufficient')
  const fallback = one(mkPick({ model: 'baseline-v2' as never }))
  assert.equal(evidenceInfo(fallback).kind, 'legacy'); assert.match(evidenceInfo(fallback).label, /unvalidated/i)
})

test('value picks and sorting never rank a legacy simple-blend number among authoritative ones', () => {
  resetFixtureCounter()
  const auth = one(withMarket(mkPick({ modelProb: 0.66, oppFactor: 1.08 }), 2.0, 2.0))
  const legacy = { ...one(mkPick({ model: 'baseline-v2' as never })), ev: 0.5 }          // a huge legacy number
  assert.equal(legacy.basis, 'legacy')
  assert.ok(evRank(auth) > evRank(legacy))
  const cards = sortCards(toCards([legacy, auth]), 'ev')
  assert.equal(cards[0].lead.basis, 'authoritative')
  assert.deepEqual(valuePicks([legacy, auth]).map((p) => p.basis), ['authoritative'])
  assert.ok(likelyPicks([legacy, { ...auth, prob: 0.7, sample: 40 }]).length >= 1, 'the likely list still works on win chance')
})
