// Capture the Worker's /api/picks output for the fake provider's controlled data.
//   node tests/integration/golden.mjs <out.json>
import { writeFileSync } from 'node:fs'
import { api, start, upstreamReset, upstreamStats } from './harness.mjs'

const out = process.argv[2]
if (!out) throw new Error('usage: golden.mjs <out.json>')
const app = await start()
try {
  await upstreamReset()
  const picks = await api('/picks')
  const stats = await upstreamStats()
  writeFileSync(out, JSON.stringify({ status: picks.status, body: picks.body, upstream: stats }, null, 1))
  const d = picks.body.data ?? []
  console.log(`status ${picks.status}; ${d.length} picks; upstream calls: ${JSON.stringify(stats)}`)
} finally {
  await app.stop()
}
