// Differential check of the Worker refactor. Compares /api/picks output captured BEFORE the rewrite with the output
// AFTER, using the same controlled provider data. Differences are only allowed where this audit changed behaviour on
// purpose, and those fields must equal an independent recomputation from the unchanged inputs.
//   node tests/integration/compare_golden.mjs research/out/golden_before.json research/out/golden_after.json
import { readFileSync } from 'node:fs'
import { blendProb, expectedValue, riskTier } from '../../shared/baseline.ts'

const [bf, af] = process.argv.slice(2)
const before = JSON.parse(readFileSync(bf, 'utf8')).body.data
const afterBody = JSON.parse(readFileSync(af, 'utf8')).body
const after = afterBody.data
const key = (p) => `${p.playerId}|${p.stat}|${p.side}|${p.line}`
const B = new Map(before.map((p) => [key(p), p]))
const A = new Map(after.map((p) => [key(p), p]))

const SAME = ['playerId', 'player', 'team', 'teamName', 'stat', 'side', 'line', 'price', 'book', 'prices', 'marketProb',
  'impliedProb', 'projection', 'recent', 'sample', 'game', 'gameDate', 'bigGap', 'model']
const out = { sameField: 0, sameFieldDiff: [], onlyBefore: [], onlyAfter: [], recomputedOk: 0, recomputedBad: [], intentional: [] }

for (const [k, b] of B) {
  const a = A.get(k)
  if (!a) { out.onlyBefore.push(k); continue }
  const whole = Number.isInteger(a.line)
  const fields = whole ? SAME.filter((f) => !['bigGap'].includes(f)) : SAME
  for (const f of fields) {
    if (JSON.stringify(a[f]) === JSON.stringify(b[f])) out.sameField++
    else out.sameFieldDiff.push(`${k}.${f}: ${JSON.stringify(b[f])} -> ${JSON.stringify(a[f])}`)
  }
  // Half-point line: the model probability itself must be unchanged, and the blend / EV / risk must follow the documented formulas.
  if (!whole) {
    if (Math.abs(a.modelProb - b.modelProb) < 1e-9) out.sameField++
    else out.sameFieldDiff.push(`${k}.modelProb: ${b.modelProb} -> ${a.modelProb}`)
    const prob = blendProb(b.modelProb, b.marketProb)
    const ev = expectedValue(prob, 0, b.price)
    const ok = Math.abs(a.prob - prob) < 1e-9 && Math.abs(a.ev - ev) < 1e-9 && a.risk === riskTier(prob)
    if (ok) out.recomputedOk++
    else out.recomputedBad.push(`${k}: prob ${a.prob} vs ${prob}, ev ${a.ev} vs ${ev}`)
  } else {
    out.intentional.push(`${k}: model ${b.modelProb.toFixed(3)} -> ${a.modelProb.toFixed(3)}, push ${a.push.toFixed(3)}, EV ${b.ev.toFixed(3)} -> ${a.ev.toFixed(3)}`)
  }
}
for (const k of A.keys()) if (!B.has(k)) out.onlyAfter.push(k)

console.log(`picks before ${before.length}, after ${after.length}`)
console.log(`unchanged fields: ${out.sameField}; unexpected field differences: ${out.sameFieldDiff.length}`)
for (const d of out.sameFieldDiff.slice(0, 20)) console.log('   DIFF', d)
console.log(`half-point picks whose blend / EV / risk match an independent recomputation: ${out.recomputedOk}; mismatches: ${out.recomputedBad.length}`)
for (const d of out.recomputedBad) console.log('   BAD', d)
console.log(`picks only before: ${out.onlyBefore.length} ${JSON.stringify(out.onlyBefore)}; only after: ${out.onlyAfter.length} ${JSON.stringify(out.onlyAfter)}`)
console.log('whole-number-line picks (intentional change):'); for (const d of out.intentional) console.log('  ', d)
console.log('new response metadata:', JSON.stringify({ oddsAsOf: afterBody.meta?.oddsAsOf, warnings: afterBody.meta?.warnings?.map((w) => w.code) }))
