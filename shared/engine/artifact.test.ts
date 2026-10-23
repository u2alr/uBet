import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCalibration } from './calibration.ts'

const art = parseCalibration(JSON.parse(readFileSync(new URL('../calibration.json', import.meta.url), 'utf8')))

test('the shipped calibration artifact parses, covers all five statistics, and has real (non-zero) uncertainty', () => {
  assert.deepEqual(Object.keys(art.stats).sort(), ['ast', 'fg3m', 'pra', 'pts', 'reb'])
  for (const s of Object.values(art.stats)) {
    const i = s.grid.p.indexOf(0.6)
    assert.ok(s.grid.lo90[i] < s.grid.cal[i], 'the 90% lower bound sits below the calibrated value')
    assert.ok(s.grid.lo95[i] <= s.grid.lo90[i] && s.grid.lo90[i] <= s.grid.lo80[i])
  }
})

test('statistics that failed a pre-registered gate stay unvalidated', () => {
  for (const [stat, s] of Object.entries(art.stats)) assert.equal(s.status === 'validated', s.failedGates.length === 0, stat)
})
