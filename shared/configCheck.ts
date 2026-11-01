// Deployment-configuration checks that never see or print a secret value: they work from key NAMES, file contents scanned for secret-looking
// assignments (only the file name and line number are reported), and the migration list. Pure.
export type Level = 'ok' | 'warn' | 'fail'
export interface Finding { level: Level; check: string; detail: string }

export interface ConfigInput {
  wranglerToml: string
  /** Names of variables set in .dev.vars with a non-empty value. Values are never passed in. */
  devVarsSet: string[]
  migrationFiles: string[]
  gitignore: string
  /** Tracked text files to scan for committed secrets. */
  tracked: { path: string; text: string }[]
}

const SECRET_ASSIGNMENT = /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\b\s*[=:]\s*['"]?([A-Za-z0-9_-]{24,})['"]?/

/** Test fixtures mark their fake credentials with this (as `test-key-not-real` does), so the scan can tell them from a real one. */
const NOT_REAL = /not-real/i

export function checkConfig(i: ConfigInput, opts: { production?: boolean } = {}): Finding[] {
  const out: Finding[] = []
  const f = (level: Level, check: string, detail: string) => out.push({ level, check, detail })

  const db = /database_id\s*=\s*"([^"]*)"/.exec(i.wranglerToml)?.[1] ?? ''
  if (!db) f('fail', 'D1 binding', 'wrangler.toml has no database_id')
  else if (/replace|your|changeme|xxxx/i.test(db)) f(opts.production ? 'fail' : 'warn', 'D1 database id', 'wrangler.toml still holds the placeholder database_id; production queries cannot reach a database until it is set (wrangler d1 create ubet)')
  else f('ok', 'D1 database id', 'set')

  const nums = i.migrationFiles.map((m) => /^(\d{4})_/.exec(m)?.[1]).filter((x): x is string => !!x).map(Number).sort((a, b) => a - b)
  const gaps = nums.filter((n, k) => k > 0 && n !== nums[k - 1] + 1)
  if (!nums.length) f('fail', 'migrations', 'no numbered migrations found')
  else if (new Set(nums).size !== nums.length) f('fail', 'migrations', 'two migrations share a number')
  else if (gaps.length || nums[0] !== 1) f('fail', 'migrations', `the numbering has a gap near ${gaps[0] ?? nums[0]}`)
  else f('ok', 'migrations', `${nums.length} sequential migrations (latest ${String(nums[nums.length - 1]).padStart(4, '0')}); apply them to every database before deploying`)

  const has = (n: string) => i.devVarsSet.includes(n)
  f(has('ODDS_API_KEY') ? 'ok' : 'warn', 'odds provider key', has('ODDS_API_KEY') ? 'ODDS_API_KEY is set (value not shown)' : 'ODDS_API_KEY is empty: the props board will say odds are not configured')
  f(has('CAPTURE_TOKEN') ? 'ok' : opts.production ? 'fail' : 'warn', 'access token',
    has('CAPTURE_TOKEN') ? 'CAPTURE_TOKEN is set: writes, personal bets and credit-spending refreshes require it' : 'CAPTURE_TOKEN is not set: writes, personal bets and refreshes work only from localhost. Set it as a secret on a deployed copy (wrangler pages secret put CAPTURE_TOKEN).')

  if (!/^\.dev\.vars\s*$/m.test(i.gitignore)) f('fail', 'secrets file', '.dev.vars is not in .gitignore')
  else f('ok', 'secrets file', '.dev.vars is gitignored')

  const leaks: string[] = []
  for (const file of i.tracked) {
    if (/\.example$|package-lock\.json$/.test(file.path)) continue
    file.text.split('\n').forEach((line, n) => { const v = SECRET_ASSIGNMENT.exec(line)?.[1]; if (v && !NOT_REAL.test(v)) leaks.push(`${file.path}:${n + 1}`) })
  }
  if (leaks.length) f('fail', 'committed secrets', `secret-looking assignments in tracked files (values not shown): ${leaks.slice(0, 5).join(', ')}${leaks.length > 5 ? ` and ${leaks.length - 5} more` : ''}`)
  else f('ok', 'committed secrets', `no secret-looking assignments in ${i.tracked.length} tracked files`)
  return out
}

export const worst = (fs: Finding[]): Level => (fs.some((x) => x.level === 'fail') ? 'fail' : fs.some((x) => x.level === 'warn') ? 'warn' : 'ok')
