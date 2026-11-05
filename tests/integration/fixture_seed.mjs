// A small, deterministic league for the integration tests, so they need neither a synced database nor the network. Ten teams, eight players each (the stars the fake odds server
// quotes plus role players), 40 regular-season games per team ending two days ago, and the sync stamp. Same numbers every run: a seeded generator, no clock-dependent randomness
// except the dates, which are relative to today so "recent form" windows always contain games.
import { TEAM_IDS } from '../../shared/teamCodes.ts'

/** [team, home opponent pairing]: each pair plays every other day, alternating who is at home. */
const PAIRS = [['DET', 'BOS'], ['NYK', 'PHI'], ['SAS', 'OKC'], ['LAL', 'GSW'], ['MIA', 'MIN']]
/** The stars the fake odds server quotes, with their real NBA ids (a test addresses Curry by 201939). [name, id, minutes, points, rebounds, assists] */
const STARS = {
  DET: [['Cade Cunningham', 1630595, 36, 26, 5, 9], ['Jalen Duren', 1631105, 30, 17, 11, 3]],
  BOS: [['Jaylen Brown', 1627759, 34, 24, 6, 4]],
  NYK: [['Jalen Brunson', 1628973, 35, 28, 3, 7]],
  SAS: [['Victor Wembanyama', 1641705, 33, 24, 11, 3]],
  LAL: [['Luka Doncic', 1629029, 36, 29, 8, 8]],
  GSW: [['Stephen Curry', 201939, 33, 27, 5, 5]],
}
const GAMES_PER_TEAM = 40

/** mulberry32: a tiny seeded generator. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dayBefore = (n) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export function seedFixture(db) {
  const rand = rng(20261105)
  const insPlayer = db.prepare('INSERT OR REPLACE INTO players (id, name, team, position) VALUES (?, ?, ?, NULL)')
  const insGame = db.prepare("INSERT OR REPLACE INTO games (id, date, season, home_team_id, visitor_team_id, game_type) VALUES (?, ?, 2026, ?, ?, 'regular')")
  const insPg = db.prepare(`INSERT OR REPLACE INTO player_games (player_id, game_id, team_id, minutes, pts, reb, ast, fg3m, stl, blk, fgm, fga, fg3a, ftm, fta, oreb, dreb, tov, pf, plus_minus, opp, is_home, won)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  // Rosters: the named stars first, then role players with falling minutes.
  const roster = new Map()
  let pid = 9_100_000
  for (const [a, b] of PAIRS) for (const team of [a, b]) {
    const list = []
    for (const [name, id, min, pts, reb, ast] of STARS[team] ?? []) list.push({ id, name, min, pts, reb, ast })
    for (let k = list.length; k < 8; k++) list.push({ id: ++pid, name: `Fixture ${team} ${k + 1}`, min: 30 - k * 3, pts: 14 - k, reb: 5, ast: 3 })
    roster.set(team, list)
    for (const p of list) insPlayer.run(p.id, p.name, team)
  }
  db.exec('BEGIN')
  let gid = 29_900_000
  for (const [a, b] of PAIRS) {
    for (let g = 0; g < GAMES_PER_TEAM; g++) {
      const home = g % 2 ? a : b, away = g % 2 ? b : a
      const date = dayBefore(2 + (GAMES_PER_TEAM - 1 - g) * 2 + 0)      // oldest first, the newest two days ago
      const homeWon = rand() < 0.5
      const id = ++gid
      insGame.run(id, date, TEAM_IDS[home], TEAM_IDS[away])
      for (const [team, opp, isHome] of [[home, away, 1], [away, home, 0]]) {
        const won = (isHome === 1) === homeWon ? 1 : 0
        for (const p of roster.get(team)) {
          const minutes = Math.max(6, Math.round((p.min + (rand() - 0.5) * 6) * 10) / 10)
          const pts = Math.max(0, Math.round(p.pts * (0.7 + rand() * 0.6)))
          const reb = Math.max(0, Math.round(p.reb * (0.6 + rand() * 0.8)))
          const ast = Math.max(0, Math.round(p.ast * (0.6 + rand() * 0.8)))
          const fg3m = Math.round(rand() * 3)
          const fga = Math.max(pts > 0 ? 2 : 0, Math.round(pts / 2.2))
          const fgm = Math.min(fga, Math.round(pts / 2.4))
          insPg.run(p.id, id, TEAM_IDS[team], minutes, pts, reb, ast, fg3m, Math.round(rand() * 2), Math.round(rand() * 2), fgm, fga, Math.min(fga, fg3m + 2), Math.round(pts / 8), Math.round(pts / 6),
            Math.round(reb / 4), reb - Math.round(reb / 4), Math.round(rand() * 3), Math.round(rand() * 4), Math.round((rand() - 0.5) * 20), opp, isHome, won)
        }
      }
    }
  }
  db.exec('COMMIT')
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_sync', ?)").run(new Date().toISOString())
}
