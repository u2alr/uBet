// The research-only layers must not be wired into anything users see or any decision. This test fails if production code starts to depend on them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, '$1:')), '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n)
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : /\.(ts|tsx|mjs)$/.test(n) && !/\.test\./.test(n) ? [p] : []
})

test('no production source imports the research context features, the teammate-out lift or the injury override', () => {
  const production = ['functions', 'shared', 'src', 'scripts'].flatMap((d) => walk(path.join(root, d)))
  assert.ok(production.length > 30)
  const forbidden = /context_features|context_model|human_factors|defense_features|defense_eval|game_features|game_eval|teammate_out|ctx_(g7|g14|min7|miles_prev|tz_shift|road_trip|close_|overlap|ot_recent)|injury[-_]features/
  for (const f of production) assert.doesNotMatch(readFileSync(f, 'utf8'), forbidden, `${path.relative(root, f)} depends on a research-only feature`)
})

test('schedule facts are display-only: no probability, EV or approval code imports them, so there is no second adjustment path', () => {
  const engine = ['shared/picks.ts', 'shared/baseline.ts', ...readdirSync(path.join(root, 'shared', 'engine')).filter((f) => !/\.test\./.test(f)).map((f) => `shared/engine/${f}`)]
  for (const f of engine) assert.doesNotMatch(readFileSync(path.join(root, f), 'utf8'), /from ['"][^'"]*schedule(\.ts)?['"]|humanFactors/, `${f} must not depend on schedule facts`)
  const status = JSON.parse(readFileSync(path.join(root, 'shared', 'humanFactors.status.json'), 'utf8'))
  assert.equal(status.adjustsPredictions, false, 'flip this only together with a validated, calibrated, approved model change')
})

test('defensive matchup context is display-only: no probability, EV or approval code imports it', () => {
  const engine = ['shared/picks.ts', 'shared/baseline.ts', ...readdirSync(path.join(root, 'shared', 'engine')).filter((f) => !/\.test\./.test(f)).map((f) => `shared/engine/${f}`)]
  for (const f of engine) assert.doesNotMatch(readFileSync(path.join(root, f), 'utf8'), /from ['"][^'"]*\/defense(\.ts)?['"]|defense\.status/, `${f} must not depend on defensive matchup context`)
  const status = JSON.parse(readFileSync(path.join(root, 'shared', 'defense.status.json'), 'utf8'))
  assert.equal(status.adjustsPredictions, false, 'flip this only together with a validated, calibrated, approved model change')
})

test('the game-winner view is display-only: no player-prop probability, EV or approval code imports it', () => {
  const engine = ['shared/picks.ts', 'shared/baseline.ts', ...readdirSync(path.join(root, 'shared', 'engine')).filter((f) => !/\.test\./.test(f)).map((f) => `shared/engine/${f}`)]
  for (const f of engine) assert.doesNotMatch(readFileSync(path.join(root, f), 'utf8'), /from ['"][^'"]*\/games(\.ts)?['"]|games\.status/, `${f} must not depend on the game-winner view`)
})

test('the projection job leaves the missing-teammate features alone unless the experimental flag is passed', () => {
  const py = readFileSync(path.join(root, 'research', 'project.py'), 'utf8')
  assert.match(py, /--injury-features/)
  assert.match(py, /if args\.injury_features:/)
})
