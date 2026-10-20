// Run: npm run test:ingest   Guards the local ingestion scripts, which no other test exercises.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, it } from 'node:test'
import { isSafePlayerName } from '../ingest/playername.mjs'

const venv = new URL('../ingest/.venv/Scripts/python.exe', import.meta.url)
const python = existsSync(venv) ? venv.pathname.replace(/^\/(\w):/, '$1:') : 'python'

describe('the sync helper only accepts real player names', () => {
  it('accepts ordinary names, accents, apostrophes, suffixes and hyphens inside a name', () => {
    for (const n of ["Stephen Curry", "Nikola Jokić", "Shaquille O'Neal", "Jaren Jackson Jr.", "Karl-Anthony Towns", "Luka Dončić"])
      assert.ok(isSafePlayerName(n), n)
  })
  it('rejects anything argparse would read as an option (--remote switched a local sync to production D1)', () => {
    for (const n of ['--remote', '-h', '--all-active', '--grade-only', ' --remote', '', 'A', 'x'.repeat(61), '; rm -rf', 'a$(b)', null, undefined, 5])
      assert.ok(!isSafePlayerName(n), String(n))
  })
})

describe('ingest/sync.py', () => {
  it('compiles (a stray newline inside a string literal once shipped and broke every sync)', () => {
    execFileSync(python, ['-m', 'py_compile', 'ingest/sync.py', 'research/project.py'], { cwd: new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:') })
  })
  it('stamps last_sync only after a clean, complete run', () => {
    const out = execFileSync(python, ['tests/test_sync_flush.py'], { cwd: new URL('..', import.meta.url).pathname.replace(/^\/(\w):/, '$1:'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.ok(out !== undefined)
  })
})
