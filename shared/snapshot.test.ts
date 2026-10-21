import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from './minds.ts'
import { makeConfig } from './engine/config.ts'
import { NOW, identityArtifact, mkPick, withMarket } from './engine/fixtures.ts'
import { replay, revive, serialize, takeSnapshot } from './snapshot.ts'

const picks = () => [withMarket(mkPick({ modelProb: 0.66, oppFactor: 1.08 }), 2.0, 2.0), mkPick({ modelProb: 0.58 }), mkPick({ sample: 12 }), mkPick({ modelProb: 0.5 })]

test('a stored snapshot replays to exactly the decision that was made', () => {
  const config = makeConfig(), calibration = identityArtifact()
  const p = picks()
  const live = decide(p, { now: NOW, config, calibration, injuryChecked: true })
  const snap = revive(serialize(takeSnapshot(p, { version: 'v', now: NOW, injuryChecked: true, config, calibration })))
  assert.equal(JSON.stringify(replay(snap)), JSON.stringify(live))
  assert.ok(live.candidates.length >= 3, 'rejected candidates are in the snapshot too')
})

test('a tampered configuration is detected, and a changed config changes the decision identity', () => {
  const snap = takeSnapshot(picks(), { version: 'v', now: NOW, injuryChecked: true, config: makeConfig(), calibration: identityArtifact() })
  const bad = JSON.parse(serialize(snap)); bad.config.val.minEvConservative = 0
  assert.throws(() => revive(JSON.stringify(bad)), /hash/)
  const other = takeSnapshot(picks(), { version: 'v', now: NOW, injuryChecked: true, config: makeConfig({ val: { minEvConservative: 0.04 } }), calibration: identityArtifact() })
  assert.notEqual(other.configHash, snap.configHash)
})
