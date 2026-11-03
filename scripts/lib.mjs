// Small helpers shared by the local scripts (capture_odds.mjs). Reads secrets from the environment or .dev.vars; talks to D1 through wrangler.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function secret(name) {
  if (process.env[name]) return process.env[name]
  try { const m = new RegExp(`^${name}=(.+)$`, 'm').exec(readFileSync(path.join(ROOT, '.dev.vars'), 'utf8')); return m ? m[1].trim() : '' } catch { return '' }
}

export function d1Query(sql, remote) {
  mkdirSync(path.join(ROOT, 'scripts', 'out'), { recursive: true })
  const f = path.join(ROOT, 'scripts', 'out', 'query.sql')
  writeFileSync(f, sql)
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'ubet', remote ? '--remote' : '--local', '--json', '--file', f], { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return JSON.parse(out.slice(out.indexOf('[')))[0].results
}

export function d1Exec(lines, remote, name = 'exec.sql') {
  mkdirSync(path.join(ROOT, 'scripts', 'out'), { recursive: true })
  const f = path.join(ROOT, 'scripts', 'out', name)
  writeFileSync(f, lines.join('\n'))
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'ubet', remote ? '--remote' : '--local', '--file', f], { cwd: ROOT, shell: true, stdio: ['ignore', 'ignore', 'inherit'] })
}
