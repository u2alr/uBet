// Measures page smoothness in headless Edge over the DevTools protocol: DOM size, long frames while scrolling, and
// style/layout work. Usage: node research/perf.mjs [url-hash-free paths...]  (dev server must be on :5173)
import { spawn } from 'node:child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-agent=${UA}`, '--window-size=1500,900', '--user-data-dir=' + process.env.TEMP + '/ubet-perf', 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break } catch {} await sleep(250) }
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result.value

await send('Page.enable'); await send('Performance.enable')

const tab = (name) => `[...document.querySelectorAll('nav button')].find((b) => b.textContent.startsWith('${name}'))?.click()`

// Frame times for a window of time right after an action (the animations are what we are testing, not scrolling).
async function animate(label, setup, action, ms = 1500) {
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.PORT || 5173) + '/' })
  await sleep(1500)
  await evalJs(setup); await sleep(4000)
  const before = Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]))
  const frames = await evalJs(`new Promise((resolve) => {
    const t = []; let last = performance.now(); const end = last + ${ms};
    ${action};
    function f(now) { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else resolve(t) }
    requestAnimationFrame(f) })`)
  const after = Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]))
  const sorted = [...frames].sort((a, b) => a - b)
  const d = (k) => ((after[k] - before[k]) * 1000).toFixed(0)
  console.log(`${label.padEnd(22)} frames=${frames.length} median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms max=${Math.max(...frames).toFixed(0)}ms slow(>20ms)=${frames.filter((x) => x > 20).length} | script=${d('ScriptDuration')}ms layout=${d('LayoutDuration')}ms style=${d('RecalcStyleDuration')}ms (layouts=${(after.LayoutCount - before.LayoutCount)}, restyles=${(after.RecalcStyleCount - before.RecalcStyleCount)})`)
}
const openPlayer = `(async () => { const i = document.querySelector('input[placeholder^="Search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Jalen Williams'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); await new Promise((r) => setTimeout(r, 1200)); [...document.querySelectorAll('ul button')][0]?.click() })()`


// CPU profile of an action: where does the main thread spend its time?
async function profile(label, setup, action, ms = 2500) {
  await send('Page.navigate', { url: 'http://localhost:' + (process.env.PORT || 5173) + '/' })
  await sleep(1500)
  await evalJs(setup); await sleep(3000)
  await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start')
  await evalJs(`${action}; new Promise((r) => setTimeout(r, ${ms}))`)
  const { result } = await send('Profiler.stop')
  const nodes = new Map(result.profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  const dt = result.profile.timeDeltas
  result.profile.samples.forEach((sid, i) => { const n = nodes.get(sid); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + dt[i] / 1000) })
  const top = [...self].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`--- ${label}: top self-time (ms)`)
  for (const [k, v] of top) console.log(String(v.toFixed(0)).padStart(6), k)
}
if (process.env.PROFILE) {
  await profile('Minds tab', 'void 0', tab('Minds'))
  await profile('open player', tab('Players'), openPlayer)
} else {
  await animate('Minds tab open', 'void 0', tab('Minds'), 2500)
  await animate('open player card', tab('Players'), openPlayer.replace('(async', 'void (async'), 3000)
  await animate('Players tab fade', 'void 0', tab('Players'))
}
ws.close(); child.kill()
process.exit(0)
