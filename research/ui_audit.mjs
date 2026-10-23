// Drives the real app in headless Edge and measures the UI: screenshots, console errors, failed requests, horizontal overflow,
// unlabeled controls, images without alt, tiny text, small touch targets, DOM size and load time. Needs `npm run dev` on :5173.
//   node research/ui_audit.mjs            -> research/out/ui_audit.json + research/out/ui_<tab>_<viewport>.png
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out')
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9335', '--window-size=1440,900', '--user-data-dir=' + process.env.TEMP + '/ubet-ui-audit', 'about:blank'], { stdio: 'ignore' })
let t; for (let i = 0; i < 60; i++) { try { t = await (await fetch('http://127.0.0.1:9335/json')).json(); if (t.length) break } catch { /* wait */ } await sleep(250) }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map(); const events = []
// If minds/out/picks_fixture.json exists (made by `DUMP_PICKS=... node minds/run.mjs --dry --cache`), /api/picks is answered from it,
// so the props board can be audited with data while the odds provider is unavailable.
const FIXTURE = path.join(OUT, '..', '..', 'minds', 'out', 'picks_fixture.json')
const fixture = existsSync(FIXTURE) ? readFileSync(FIXTURE).toString('base64') : null
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id) pend.get(d.id)?.(d)
  else if (d.method === 'Fetch.requestPaused') {
    const u = d.params.request.url
    if (fixture && /\/api\/picks(\?|$)/.test(u)) send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: fixture })
    else send('Fetch.continueRequest', { requestId: d.params.requestId })
  } else events.push(d)
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const js = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result?.value
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/picks*' }] }); await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable')

const CHECKS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
  const buttons = [...document.querySelectorAll('button, a[href], [role=button]')].filter(vis)
  const unlabeled = buttons.filter((b) => !name(b) && !b.querySelector('img[alt]:not([alt=""])')).length
  const inputs = [...document.querySelectorAll('input, select, textarea')].filter(vis)
  const unlabeledInputs = inputs.filter((i) => !i.getAttribute('aria-label') && !i.id && !i.closest('label') && !i.getAttribute('placeholder')).length
  const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length
  const smallEls = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 24 || r.height < 24 })
  const small = smallEls.length
  const smallExamples = smallEls.slice(0, 3).map((b) => b.outerHTML.slice(0, 160) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height))
  let tiny = 0
  for (const el of document.querySelectorAll('body *')) { if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; if (!vis(el)) continue; if (parseFloat(getComputedStyle(el).fontSize) < 11) tiny++ }
  const culprits = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && vis(el)).slice(0, 3).map((el) => el.tagName + '.' + String(el.className).slice(0, 80) + ' right=' + Math.round(el.getBoundingClientRect().right))
  const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth
  const heading = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName).join(',')
  return { culprits, smallExamples, buttons: buttons.length, unlabeled, inputs: inputs.length, unlabeledInputs, imgsNoAlt, smallTargets: small, tinyTextNodes: tiny, overflowX, nodes: document.querySelectorAll('*').length, headings: heading.slice(0, 80), h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang, title: document.title, landmarks: ['header','nav','main','footer'].filter((t) => document.querySelector(t)).join(',') }
})()`

const TABS = ['Props', 'Today', 'Slip', 'Minds', 'Results', 'Players']
const VIEWPORTS = [['desktop', 1440, 900, false], ['mobile', 390, 844, true]]
const report = { when: new Date().toISOString(), pages: [] }
for (const [vp, w, h, mobile] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  for (const tab of TABS) {
    events.length = 0
    const t0 = Date.now()
    await send('Page.navigate', { url: `http://localhost:5173/#/${tab}` })
    await sleep(500); await js('location.reload()'); await sleep(4000)
    const loadMs = Date.now() - t0
    const checks = await js(CHECKS)
    const perf = await js(`JSON.stringify({ fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, requests: performance.getEntriesByType('resource').length, transferKB: Math.round(performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || 0), 0) / 1024) })`)
    const consoleErrors = events.filter((e) => (e.method === 'Runtime.exceptionThrown') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')).map((e) => (e.params.entry?.text || e.params.exceptionDetails?.text || '').slice(0, 140))
    const failed = events.filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400).map((e) => `${e.params.response.status} ${e.params.response.url.replace('http://localhost:5173', '').slice(0, 60)}`)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(OUT, `ui_${tab}_${vp}.png`), Buffer.from(shot.result.data, 'base64'))
    report.pages.push({ tab, viewport: vp, loadMs, ...checks, perf: JSON.parse(perf), consoleErrors: [...new Set(consoleErrors)], failedRequests: [...new Set(failed)] })
    console.log(tab.padEnd(8), vp.padEnd(8), `overflowX ${checks.overflowX}  nodes ${checks.nodes}  unlabeled ${checks.unlabeled}+${checks.unlabeledInputs}  small ${checks.smallTargets}  tiny ${checks.tinyTextNodes}  errs ${consoleErrors.length}  failed ${failed.length}`)
  }
}
writeFileSync(path.join(OUT, 'ui_audit.json'), JSON.stringify(report, null, 1))
ws.close(); child.kill()
