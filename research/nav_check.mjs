// Drives the real app in headless Edge and checks that browser back/forward moves between pages. Needs `npm run dev` on :5173.
import { spawn } from 'node:child_process'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9334', '--window-size=1400,900', '--user-data-dir=' + process.env.TEMP + '/ubet-nav', 'about:blank'], { stdio: 'ignore' })
let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch('http://127.0.0.1:9334/json')).json(); if (t.length) break } catch {} await sleep(250) }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d) }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const js = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.result.value
const state = () => js(`({ hash: location.hash, active: [...document.querySelectorAll('nav button')].find((b) => b.className.includes('bg-neutral-800'))?.textContent?.replace(/\d+$/, '') })`)
const click = (name) => js(`[...document.querySelectorAll('nav button')].find((b) => b.textContent.startsWith('${name}')).click()`)
let ok = true
const expect = (label, got, want) => { const pass = JSON.stringify(got) === JSON.stringify(want); ok &&= pass; console.log(pass ? 'PASS' : 'FAIL', label, pass ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }

await send('Page.navigate', { url: 'http://localhost:5173/' }); await sleep(2500)
expect('starts on Today', (await state()).active, 'Today')
await click('Minds'); await sleep(400)
expect('Minds click changes the address', await state(), { hash: '#/Minds', active: 'Minds' })
await click('Results'); await sleep(400)
await js('history.back()'); await sleep(500)
expect('back goes to Minds', await state(), { hash: '#/Minds', active: 'Minds' })
await js('history.back()'); await sleep(500)
expect('back again goes to the start', (await state()).active, 'Today')
await js('history.forward()'); await sleep(500)
expect('forward returns to Minds', (await state()).active, 'Minds')
// a player page, then back
await js('location.assign("#/Players/1631114")'); await sleep(2500)
expect('a player address opens that player', await js('document.body.innerText.includes("Jalen Williams")'), true)
await js('history.back()'); await sleep(800)
expect('back from a player returns to the page before it', await state(), { hash: '#/Minds', active: 'Minds' })
// a deep link works on a fresh load
await send('Page.navigate', { url: 'http://localhost:5173/#/Players/1631114' }); await sleep(3000)
expect('deep link to a player works on first load', await js('document.body.innerText.includes("Jalen Williams")'), true)
// opening a game from the list, then back
await send('Page.navigate', { url: 'http://localhost:5173/#/Today' }); await sleep(3500)
await js(`document.querySelector('ul li button').click()`); await sleep(1500)
expect('opening a game puts it in the address', (await js('location.hash')).startsWith('#/Today/game/'), true)
await js('history.back()'); await sleep(800)
expect('back from a game returns to the games list', await js('location.hash'), '#/Today')
// choosing a player from search, then back to the search page
await send('Page.navigate', { url: 'http://localhost:5173/#/Players' }); await sleep(2000)
await js(`(async () => { const i = document.querySelector('input[placeholder^="Search"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Jalen Williams'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); await new Promise((r) => setTimeout(r, 1200)); document.querySelector('ul button').click() })()`); await sleep(2500)
expect('picking a search result puts the player in the address', await js('location.hash'), '#/Players/1631114')
await js('history.back()'); await sleep(800)
expect('back from a picked player returns to the search page', await js('location.hash'), '#/Players')
// a bad hash does not break the page
await send('Page.navigate', { url: 'http://localhost:5173/#/garbage/%00' }); await sleep(2000)
expect('a garbage address shows the home page', (await state()).active, 'Today')
ws.close(); child.kill()
console.log(ok ? 'ALL PASSED' : 'SOME FAILED'); process.exit(ok ? 0 : 1)
