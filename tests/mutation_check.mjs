// Do the tests have teeth? Plant one deliberate bug at a time into a COPY of shared/ and run the unit tests.
// A mutant is "killed" if some test fails. A survivor means a real bug of that shape would go unnoticed.
//   npm run test:mutation
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// [file, text to find (must occur exactly once), replacement, what the bug is]
const MUTANTS = [
  ['baseline.ts', 'const over = Math.min(Math.max(1 - cdfAt(d, k), 0), 1)', 'const over = Math.min(Math.max(cdfAt(d, k), 0), 1)', 'over uses the wrong tail'],
  ['baseline.ts', 'whole ? cdfAt(d, k - 1) : 1 - over', '1 - over', 'the original bug: under = 1 - over, so a tie goes to the Under'],
  ['baseline.ts', 'const push = whole ? Math.max(0, 1 - over - under) : 0', 'const push = 0', 'ties never produce a refund probability'],
  ['baseline.ts', '!Number.isFinite(line) || line < 0 || line > LIMITS.maxLine || !validDist(d)', 'line < 0 || line > LIMITS.maxLine || !validDist(d)', 'NaN and Infinity lines are accepted'],
  ['baseline.ts', 'line > LIMITS.maxLine', 'line > 1e12', 'absurdly large lines are accepted'],
  ['baseline.ts', 'if (v === line) continue', '', 'hit rate counts ties as misses'],
  ['baseline.ts', "side === 'over' ? v > line : v < line", 'v > line', 'hit rate ignores which side was bet'],
  ['baseline.ts', 'const w = Math.abs(model - marketProb) > BIG_GAP ? w0 / 2 : w0', 'const w = w0', 'a model that disagrees wildly is trusted fully'],
  ['baseline.ts', 'return (1 - push) * (winProb * price - 1)', 'return winProb * price - 1', 'a refund does not reduce the stake at risk'],
  ['baseline.ts', "if (type === 'playoffs') return upcoming === 'playoffs' ? 1.2 : 0.6", "if (type === 'playoffs') return upcoming === 'playoffs' ? 0.6 : 1.2", 'playoff game weights swapped'],
  ['baseline.ts', 'return 0.3\n}', 'return 1\n}', 'preseason games count as much as real ones'],
  ['baseline.ts', 'const RECENCY = 0.93', 'const RECENCY = 0.99', 'recency weighting nearly disabled'],
  ['baseline.ts', 'return z > 0 ? 1 - p : p', 'return z > 0 ? p : 1 - p', 'normal CDF is mirrored'],
  ['baseline.ts', "export function predict(samples: Sample[], line: number, upcoming: GameType = 'regular'): Prediction | null {\n  if (samples.length < 5 ||",
    "export function predict(samples: Sample[], line: number, upcoming: GameType = 'regular'): Prediction | null {\n  if (samples.length < 2 ||", 'minimum sample size lowered (v2)'],
  ['baseline.ts', "upcoming: GameType = 'regular'): Prediction | null {\n  if (samples.length < 5 || samples.some((s) => !Number.isFinite(s.value) || s.value < 0)) return null\n  const { mean, sd, nEff } = weightedStats(samples, upcoming)\n  const spread = Math.max(sd * (1 + 1 / Math.max(nEff, 1)), 0.5)\n  const out",
    "upcoming: GameType = 'regular'): Prediction | null {\n  if (samples.length < 2 || samples.some((s) => !Number.isFinite(s.value) || s.value < 0)) return null\n  const { mean, sd, nEff } = weightedStats(samples, upcoming)\n  const spread = Math.max(sd * (1 + 1 / Math.max(nEff, 1)), 0.5)\n  const out", 'minimum sample size lowered (v3)'],
  ['picks.ts', 'now - made <= maxAgeMs && now - made >= -3600_000', 'true', 'stale or future-dated projections are used'],
  ['picks.ts', 'a + devigPair(v.o!, v.u!)', 'a + 1 / v.o!', 'the market probability keeps the bookmaker margin'],
  ['picks.ts', 'const modelProb = win / (win + lose)', 'const modelProb = win', 'model probability ignores the refund (unconditional)'],
  ['picks.ts', 'ev: expectedValue(prob, outcome.push, top.price)', 'ev: prob * top.price - 1', 'EV ignores the refund chance'],
  ['picks.ts', 'hitRate(played, L.point, 10, side)', 'hitRate(played, L.point, 10)', 'under picks report the over hit rate'],
  ['picks.ts', 'if (!validQuote(out)) { invalidQuotes++; continue }', '', 'malformed provider quotes are used'],
  ['picks.ts', '(m === 4 && d >= 16) || m === 5 || m === 6', '(m === 4 && d >= 8) || m === 5 || m === 6', 'playoff window starts too early'],
  ['baseline.ts', 'return alphas[i - 1] + t * (alphas[i] - alphas[i - 1])', 'return alphas[i]', 'v3 dispersion not interpolated'],
  ['baseline.ts', "const bucket: Bucket = mean < 2 ? 'lt2' : mean < 6 ? 'mid' : 'hi'", "const bucket: Bucket = mean < 3 ? 'lt2' : mean < 6 ? 'mid' : 'hi'", 'v3 bucket boundary moved'],
  ['baseline.ts', "if (kind === 'nbc') return { kind: 'nb', mu: Math.max(mean, 1e-3), alpha: DISPERSION[stat].constant }", "if (kind === 'nbc') return { kind: 'nb', mu: Math.max(mean, 1e-3), alpha: alphaAt(stat, mean) }", 'v3 constant-dispersion cells use the mean-dependent value'],
  ['picks.ts', "input.fallback === 'v3' ?", "input.fallback !== 'v3' ?", 'fallback switch inverted'],
  ['picks.ts', 'const top = sorted[0]', 'const top = sorted[sorted.length - 1]', 'the WORST price is offered as the best'],
  ['picks.ts', 'const pr = proj.get(`${L.pl.id}|${gameDate}|${L.stat}`)', 'const pr = proj.get(`${L.pl.id}|${gameDate}|pts`)', 'projections matched to the wrong statistic'],
  ['picks.ts', 'if (win + lose <= 0) continue', '', 'a line that always ties produces a pick'],
  ['picks.ts', 'if (oldest > MAX_ODDS_AGE_HOURS) {', 'if (oldest > 1e9) {', 'odds of any age are shown (fail-closed rule disabled)'],
]

let killed = 0
const survivors = []
for (const [file, find, replace, what] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'ubet-mut-'))
  try {
    cpSync(join(ROOT, 'shared'), join(dir, 'shared'), { recursive: true })
    const target = join(dir, 'shared', file)
    const src = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
    const hits = src.split(find).length - 1
    if (hits !== 1) { console.log(`SETUP ERROR  "${find.slice(0, 60)}" occurs ${hits} times in ${file}`); process.exitCode = 2; continue }
    writeFileSync(target, src.replace(find, replace))
    const r = spawnSync('node', ['--no-warnings', '--test', join(dir, 'shared', 'baseline.test.ts'), join(dir, 'shared', 'picks.test.ts')],
      { encoding: 'utf8', timeout: 90_000 })
    const dead = r.status !== 0
    console.log(`${dead ? 'killed  ' : 'SURVIVED'}  ${file.padEnd(12)} ${what}`)
    if (dead) killed++
    else survivors.push(`${file}: ${what}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
console.log(`\n${killed} of ${MUTANTS.length} planted bugs were caught by the tests.`)
if (survivors.length) { console.log('NOT caught:'); for (const s of survivors) console.log('  -', s); process.exitCode = 1 }
