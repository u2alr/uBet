// Validates the deployment configuration WITHOUT printing any secret: only variable names, file names and pass/fail. Exit code 1 on any failure.
//   node scripts/check_config.mjs                # development: warnings are allowed
//   node scripts/check_config.mjs --production   # a deployed copy: a placeholder database id and a missing CAPTURE_TOKEN fail
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { checkConfig, worst } from '../shared/configCheck.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), 'utf8') : '')
// Names only: the values of .dev.vars are dropped on this line and never leave it.
const devVarsSet = read('.dev.vars').split('\n').map((l) => /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(l.trim())).filter(Boolean).map((m) => m[1])
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n')
  .filter((f) => f && /\.(ts|tsx|mjs|js|json|toml|md|py|sql|yml|yaml)$/.test(f))
  .map((f) => ({ path: f, text: (() => { try { return readFileSync(path.join(root, f), 'utf8') } catch { return '' } })() }))
const findings = checkConfig({ wranglerToml: read('wrangler.toml'), devVarsSet, migrationFiles: readdirSync(path.join(root, 'migrations')), gitignore: read('.gitignore'), tracked },
  { production: process.argv.includes('--production') })
const mark = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' }
for (const f of findings) console.log(`${mark[f.level]}  ${f.check}: ${f.detail}`)
process.exit(worst(findings) === 'fail' ? 1 : 0)
