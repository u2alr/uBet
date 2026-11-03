import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openingLine, ownLine, priceLine } from './ownLines.ts'

test('the opening line is the half-point closest to a coin flip, and sits next to the projection', () => {
  const p = { stat: 'pts', mean: 24.3, alpha: 0.05 }
  const line = openingLine(p)!
  assert.ok(Math.abs(line - p.mean) <= 1.5, `line ${line} should be near the mean ${p.mean}`)
  assert.equal(line % 1, 0.5)
  const o = priceLine(p, line)!
  assert.ok(Math.abs(o.over - 0.5) < 0.1)
})

test('over and under add to one on a half-point line, and fair odds are the inverse of the chance', () => {
  const o = priceLine({ stat: 'reb', mean: 8, alpha: 0.1 }, 8.5)!
  assert.ok(Math.abs(o.over + o.under - 1) < 0.002)
  assert.equal(o.push, 0)
  assert.ok(Math.abs(o.fairOver! * o.over - 1) < 0.02)
})

test('a whole-number line can be refunded, so over, under and push add to one', () => {
  const o = priceLine({ stat: 'pts', mean: 20, alpha: 0.05 }, 20)!
  assert.ok(o.push > 0.02)
  assert.ok(Math.abs(o.over + o.under + o.push - 1) < 0.003)
})

test('raising the line makes the over less likely, so the ladder only ever pays more for it', () => {
  const l = ownLine({ stat: 'ast', mean: 6.2, alpha: 0.12 })!
  assert.equal(l.ladder.length, 5)
  for (let i = 1; i < l.ladder.length; i++) {
    assert.ok(l.ladder[i].over <= l.ladder[i - 1].over)
    assert.ok(l.ladder[i].fairOver! >= l.ladder[i - 1].fairOver!)
  }
})

test('an unusable projection gives nothing rather than a made-up line', () => {
  assert.equal(ownLine({ stat: 'pts', mean: 0, alpha: 0.1 }), null)
  assert.equal(ownLine({ stat: 'pts', mean: Number.NaN, alpha: 0.1 }), null)
  assert.equal(ownLine({ stat: 'pts', mean: 10, alpha: -1 }), null)
})
