import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrateSide, parseCalibration, type CalibrationArtifact } from './calibration.ts'

const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`)
const P = [0.1, 0.3, 0.5, 0.7, 0.9]
/** A calibrator that pulls toward 0.5 (model overconfident), with bounds 0.02 / 0.04 / 0.06 either side at 80/90/95. */
const col = (f: (p: number) => number) => P.map(f)
const cal = (p: number) => 0.5 + 0.8 * (p - 0.5)
const artifact = (status: 'validated' | 'unvalidated' = 'validated'): CalibrationArtifact => ({
  version: '2026-10-20', hash: 'abc123', caveat: 'pseudo-lines', stats: {
    pts: { method: 'platt', status, failedGates: status === 'validated' ? [] : ['final: ECE 0.05 > 0.03'], grid: {
      p: [...P], cal: col(cal),
      lo80: col((p) => cal(p) - 0.02), hi80: col((p) => cal(p) + 0.02), lo90: col((p) => cal(p) - 0.04), hi90: col((p) => cal(p) + 0.04), lo95: col((p) => cal(p) - 0.06), hi95: col((p) => cal(p) + 0.06),
    } },
  },
})

test('over side: exact at grid points, linear between them, bounds by confidence level', () => {
  const r = calibrateSide(artifact(), 'pts', 'over', 0.7, '90')
  assert.equal(r.status, 'validated')
  near(r.calibrated!, cal(0.7)); near(r.lower!, cal(0.7) - 0.04); near(r.upper!, cal(0.7) + 0.04)
  near(calibrateSide(artifact(), 'pts', 'over', 0.6, '90').calibrated!, cal(0.6))        // midway between two grid points on a straight line
  near(calibrateSide(artifact(), 'pts', 'over', 0.7, '80').lower!, cal(0.7) - 0.02)
  near(calibrateSide(artifact(), 'pts', 'over', 0.7, '95').lower!, cal(0.7) - 0.06)
  assert.equal(r.raw, 0.7)
  assert.equal(r.artifactHash, 'abc123')
})

test('under side is the mirror image: calibrated = 1 - f(1 - raw), lower bound = 1 - upper bound of the over', () => {
  const u = calibrateSide(artifact(), 'pts', 'under', 0.7, '90')          // an under with raw 70% is an over at 30%
  near(u.calibrated!, 1 - cal(0.3))
  near(u.lower!, 1 - (cal(0.3) + 0.04))
  near(u.upper!, 1 - (cal(0.3) - 0.04))
  const o = calibrateSide(artifact(), 'pts', 'over', 0.3, '90')
  near(o.calibrated! + u.calibrated!, 1)
  assert.ok(u.lower! < u.calibrated! && u.calibrated! < u.upper!)
})

test('outside the grid the edge value is used and the clamp is reported', () => {
  const lowEdge = calibrateSide(artifact(), 'pts', 'over', 0.02)
  assert.ok(lowEdge.clamped)
  near(lowEdge.calibrated!, cal(0.1))
  assert.equal(calibrateSide(artifact(), 'pts', 'over', 0.5).clamped, false)
  assert.equal(calibrateSide(artifact(), 'pts', 'over', 0.9).clamped, false)
})

test('missing calibration is reported as missing, never replaced by the raw probability', () => {
  const none = calibrateSide(null, 'pts', 'over', 0.6)
  assert.equal(none.status, 'missing'); assert.equal(none.calibrated, null); assert.equal(none.lower, null); assert.equal(none.reason, 'NO_CALIBRATION_ARTIFACT')
  const other = calibrateSide(artifact(), 'blk', 'over', 0.6)
  assert.equal(other.status, 'missing'); assert.equal(other.calibrated, null); assert.equal(other.reason, 'STAT_NOT_CALIBRATED')
})

test('a statistic that failed its gates is calibrated but flagged unvalidated', () => {
  const r = calibrateSide(artifact('unvalidated'), 'pts', 'over', 0.6)
  assert.equal(r.status, 'unvalidated')
  assert.equal(r.reason, 'FAILED_VALIDATION_GATES')
  assert.ok(r.calibrated !== null)
})

test('an out-of-range raw probability is an error, not a guess', () => {
  for (const bad of [-0.1, 1.2, NaN]) assert.throws(() => calibrateSide(artifact(), 'pts', 'over', bad), RangeError)
})

test('artifact validation fails closed on malformed or inconsistent files', () => {
  assert.doesNotThrow(() => parseCalibration(artifact()))
  assert.throws(() => parseCalibration(null), TypeError)
  assert.throws(() => parseCalibration({ version: 'x', hash: 'y' }), TypeError)
  const broken = artifact(); (broken.stats.pts.grid.cal as number[])[2] = 2
  assert.throws(() => parseCalibration(broken), /malformed/)
  const notIncreasing = artifact(); (notIncreasing.stats.pts.grid.p as number[])[2] = 0.2
  assert.throws(() => parseCalibration(notIncreasing), /not increasing/)
  const unbracketed = artifact(); (unbracketed.stats.pts.grid.lo90 as number[])[2] = 0.9
  assert.throws(() => parseCalibration(unbracketed), /bracket/)
  const noStatus = artifact(); (noStatus.stats.pts as { status: string }).status = 'maybe'
  assert.throws(() => parseCalibration(noStatus), /status/)
})
