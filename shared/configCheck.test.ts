import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkConfig, worst, type ConfigInput } from './configCheck.ts'

const good = (): ConfigInput => ({
  wranglerToml: 'name = "ubet"\n[[d1_databases]]\ndatabase_id = "3f2a9b1c-1111-4222-8333-444455556666"\n',
  devVarsSet: ['ODDS_API_KEY', 'CAPTURE_TOKEN'], migrationFiles: ['0001_init.sql', '0002_x.sql', '0003_y.sql'], gitignore: 'node_modules\n.dev.vars\n', tracked: [{ path: 'a.ts', text: 'const x = 1' }],
})
const by = (fs: ReturnType<typeof checkConfig>, check: string) => fs.find((f) => f.check === check)!

test('a clean configuration passes everything', () => {
  const fs = checkConfig(good(), { production: true })
  assert.equal(worst(fs), 'ok'); assert.ok(fs.every((f) => f.level === 'ok'))
})

test('the placeholder database id warns in development and fails for production', () => {
  const i = good(); i.wranglerToml = 'database_id = "REPLACE_AFTER_wrangler_d1_create"'
  assert.equal(by(checkConfig(i), 'D1 database id').level, 'warn')
  assert.equal(by(checkConfig(i, { production: true }), 'D1 database id').level, 'fail')
})

test('a missing access token is a warning on a developer machine and a failure on a deployed copy; a missing odds key only warns', () => {
  const i = good(); i.devVarsSet = []
  assert.equal(by(checkConfig(i), 'access token').level, 'warn')
  assert.equal(by(checkConfig(i, { production: true }), 'access token').level, 'fail')
  assert.equal(by(checkConfig(i, { production: true }), 'odds provider key').level, 'warn')
})

test('migration numbering must be sequential and unique', () => {
  const gap = good(); gap.migrationFiles = ['0001_a.sql', '0003_b.sql']
  assert.equal(by(checkConfig(gap), 'migrations').level, 'fail')
  const dup = good(); dup.migrationFiles = ['0001_a.sql', '0001_b.sql']
  assert.equal(by(checkConfig(dup), 'migrations').level, 'fail')
  const none = good(); none.migrationFiles = []
  assert.equal(by(checkConfig(none), 'migrations').level, 'fail')
})

test('a secret-looking assignment in a tracked file fails, is located by file and line, and its value is never in the output', () => {
  const i = good()
  const secret = 'abcdef0123456789abcdef0123456789'
  i.tracked.push({ path: 'src/oops.ts', text: `const a = 1\nconst ODDS_API_KEY = "${secret}"\n` }, { path: '.dev.vars.example', text: `ODDS_API_KEY=${secret}` })
  const fs = checkConfig(i)
  const f = by(fs, 'committed secrets')
  assert.equal(f.level, 'fail'); assert.match(f.detail, /src\/oops\.ts:2/)
  assert.equal(JSON.stringify(fs).includes(secret), false, 'a secret value must never appear in a finding')
  assert.doesNotMatch(f.detail, /\.example/, 'the example file is allowed to show the shape')
})

test('.dev.vars must be gitignored', () => {
  const i = good(); i.gitignore = 'node_modules\n'
  assert.equal(by(checkConfig(i), 'secrets file').level, 'fail')
})

test('a fake credential marked "not-real" is not reported, but the marker in a comment does not excuse a real-looking value', () => {
  const fake = 'integration-token-not-real-0123456789', real = 'abcdef0123456789abcdef0123456789'
  const i = good()
  i.tracked.push({ path: 'tests/fixture.mjs', text: `const CAPTURE_TOKEN = '${fake}'` })
  assert.equal(by(checkConfig(i), 'committed secrets').level, 'ok')
  i.tracked.push({ path: 'src/oops.ts', text: `const CAPTURE_TOKEN = '${real}' // not-real` })
  assert.equal(by(checkConfig(i), 'committed secrets').level, 'fail')
})
