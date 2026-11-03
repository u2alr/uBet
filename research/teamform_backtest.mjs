// Does the common-opponent comparison (shared/teamForm.ts) pick winners? For every regular-season game with enough history, judge it using only games before it.
//   node --no-warnings research/teamform_backtest.mjs [path to the local D1 folder]
// Compares against always picking the home team. Prints numbers; writes nothing. The figures in shared/teamForm.status.json come from this.
import { DatabaseSync } from 'node:sqlite'
import { readdirSync } from 'node:fs'
import { teamForm, commonLean } from '../shared/teamForm.ts'
import { abbrOfTeamId } from '../shared/teamCodes.ts'

const dir = process.argv[2] ?? '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
let db
for (const f of readdirSync(dir).filter((n) => n.endsWith('.sqlite') && !n.startsWith('metadata'))) {
  const d = new DatabaseSync(`${dir}/${f}`)
  if (d.prepare("select 1 from sqlite_master where name='games'").get()) { db = d; break }
}
if (!db) { console.error('no database with games found'); process.exit(1) }
const rows = db.prepare(`SELECT g.id gid, g.date, pg.team_id, pg.opp, pg.is_home home, MAX(pg.won) won FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE g.game_type = 'regular' GROUP BY g.id, pg.team_id ORDER BY g.date`).all()
const res = rows.map((r) => ({ gid: r.gid, date: r.date, team: abbrOfTeamId(r.team_id), opp: r.opp, home: !!r.home, won: !!r.won })).filter((r) => r.team && r.opp)
const byGame = new Map()
for (const r of res) (byGame.get(r.gid) ?? byGame.set(r.gid, []).get(r.gid)).push(r)
const games = [...byGame.values()].filter((v) => v.length === 2 && v[0].won !== v[1].won)

let judged = 0, n = 0, hit = 0, homeHit = 0, strong = 0, strongHit = 0, h2hN = 0, h2hHit = 0
for (const [a, b] of games) {
  const home = a.home ? a : b, away = a.home ? b : a
  const hist = res.filter((r) => r.date < home.date && (r.team === home.team || r.team === away.team))
  if (hist.length < 30) continue
  judged++
  const f = teamForm(home.team, away.team, hist, home.date)
  const lean = commonLean(f)
  if (lean) {
    n++
    if ((lean === 'a') === home.won) hit++
    if (home.won) homeHit++
    if (Math.abs(f.tally.a - f.tally.b) >= 2) { strong++; if ((lean === 'a') === home.won) strongHit++ }
  }
  if (f.meetings.length) { h2hN++; if ((f.meetings[0].winner === home.team) === home.won) h2hHit++ }
}
const pc = (x, y) => (y ? `${(100 * x / y).toFixed(1)}% of ${y}` : 'n/a')
console.log('games judged', judged, '| common-opponent lean available', n)
console.log('lean picks the winner:', pc(hit, n), '| the home team won in those same games:', pc(homeHit, n))
console.log('lean gap of 2+ opponents:', pc(strongHit, strong))
console.log('last head-to-head winner repeats:', pc(h2hHit, h2hN))
