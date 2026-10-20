// Integrity checks on the local database. Run: npm run check:data   (add --remote-file <path> to check another sqlite copy)
// "must be zero" checks fail the run; "info" checks report known limitations so they stay visible.
import { existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(ROOT, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
if (!existsSync(dir)) { console.error('No local database found. Run npm run db:migrate and sync some players first.'); process.exit(2) }

// the file holding the app's tables (the one with the most player_games rows)
let db, best = -1
for (const f of readdirSync(dir).filter((n) => n.endsWith('.sqlite'))) {
  const d = new DatabaseSync(join(dir, f))
  try { const n = d.prepare('SELECT COUNT(*) AS n FROM player_games').get().n; if (n > best) { best = n; db = d } } catch { d.close() }
}
if (!db) { console.error('No app database with player_games found.'); process.exit(2) }

const one = (sql) => db.prepare(sql).get().n
const rows = []
const must = (name, sql, why) => rows.push({ kind: 'must', name, n: one(sql), why })
const info = (name, sql, why) => rows.push({ kind: 'info', name, n: one(sql), why })

must('player_games with no matching game', 'SELECT COUNT(*) AS n FROM player_games pg LEFT JOIN games g ON g.id = pg.game_id WHERE g.id IS NULL', 'every box score row must belong to a game')
must('player_games with no matching player', 'SELECT COUNT(*) AS n FROM player_games pg LEFT JOIN players p ON p.id = pg.player_id WHERE p.id IS NULL', 'every box score row must belong to a player')
must('games with an unknown game_type', "SELECT COUNT(*) AS n FROM games WHERE game_type NOT IN ('regular','playoffs','preseason')", 'type drives which games count and how much')
must('season label disagrees with the date', `SELECT COUNT(*) AS n FROM games WHERE season != CASE WHEN CAST(strftime('%m', date) AS INT) >= 10 THEN CAST(strftime('%Y', date) AS INT) ELSE CAST(strftime('%Y', date) AS INT) - 1 END`, 'season = start year of the season the date falls in')
must('points that do not equal 2*FGM + 3PM + FTM', 'SELECT COUNT(*) AS n FROM player_games WHERE pts != 2 * fgm + fg3m + ftm AND fga > 0', 'a basketball identity: a mismatch means a corrupted row')
must('made shots above attempts', 'SELECT COUNT(*) AS n FROM player_games WHERE fgm > fga OR fg3m > fg3a OR ftm > fta', 'impossible')
must('three-pointers above field goals', 'SELECT COUNT(*) AS n FROM player_games WHERE fg3m > fgm', 'a three is also a field goal')
must('implausible minutes (<=0 or >70)', 'SELECT COUNT(*) AS n FROM player_games WHERE minutes <= 0 OR minutes > 70', 'DNPs are not stored; overtime caps well below 70')
must('implausible stat lines', 'SELECT COUNT(*) AS n FROM player_games WHERE pts > 100 OR reb > 40 OR ast > 35 OR stl > 12 OR blk > 15 OR pts < 0 OR reb < 0 OR ast < 0', 'beyond any NBA game ever played')
must('games dated in the future with box scores', "SELECT COUNT(*) AS n FROM games g WHERE date > date('now', '+1 day') AND EXISTS (SELECT 1 FROM player_games pg WHERE pg.game_id = g.id)", 'cannot have been played')
must('graded picks with no result value', 'SELECT COUNT(*) AS n FROM predictions WHERE hit IS NOT NULL AND actual IS NULL', 'a grade needs an actual')
must('graded picks whose grade disagrees with the result', `SELECT COUNT(*) AS n FROM predictions WHERE hit IS NOT NULL AND side IS NOT NULL AND hit != CASE WHEN actual = line THEN 2 WHEN (side='over' AND actual > line) OR (side='under' AND actual < line) THEN 1 ELSE 0 END`, 'grading must follow the rule exactly')
must('logged picks with an impossible price or probability', 'SELECT COUNT(*) AS n FROM predictions WHERE side IS NOT NULL AND (price <= 1 OR p_over < 0 OR p_over > 1)', 'prices are decimal odds above 1')
must('projections with a non-positive or non-finite mean/dispersion', 'SELECT COUNT(*) AS n FROM projections WHERE mean < 0 OR mean > 500 OR alpha < 0 OR alpha > 1000 OR mean IS NULL OR alpha IS NULL', 'would be rejected by the probability code')

info('players with no current team', 'SELECT COUNT(*) AS n FROM players WHERE team IS NULL', 'free agents or never matched; they have no picks grouped under a team')
info('players with no position (always unset by the sync)', 'SELECT COUNT(*) AS n FROM players WHERE position IS NULL', 'a known gap: the sync does not store positions')
info('games whose opponent is not an NBA team (id 0)', 'SELECT COUNT(*) AS n FROM games WHERE home_team_id = 0 OR visitor_team_id = 0', 'preseason games against international clubs')
info('players whose latest game is over 60 days older than the newest game in the database', `SELECT COUNT(*) AS n FROM (SELECT pg.player_id, MAX(g.date) AS d FROM player_games pg JOIN games g ON g.id = pg.game_id GROUP BY pg.player_id) WHERE d < date((SELECT MAX(date) FROM games), '-60 days')`, 'injured, retired, or not synced recently: their history is stale')
info('active-team players with fewer than 10 games of history', `SELECT COUNT(*) AS n FROM players p WHERE p.team IS NOT NULL AND (SELECT COUNT(*) FROM player_games pg WHERE pg.player_id = p.id) < 10`, 'too little data for a stable estimate (rookies, or not yet synced)')
info('rostered players with no games at all', 'SELECT COUNT(*) AS n FROM players p WHERE p.team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM player_games pg WHERE pg.player_id = p.id)', 'no history, so no picks')
info('legacy picks (logged before model components were recorded)', 'SELECT COUNT(*) AS n FROM predictions WHERE side IS NOT NULL AND model_prob IS NULL', 'excluded from calibration reports')

let failed = 0
for (const r of rows) {
  const bad = r.kind === 'must' && r.n > 0
  if (bad) failed++
  console.log(`${bad ? 'FAIL' : r.kind === 'must' ? 'ok  ' : 'info'}  ${String(r.n).padStart(6)}  ${r.name}${r.n > 0 || r.kind === 'must' ? '' : ''}${bad || r.kind === 'info' ? `   (${r.why})` : ''}`)
}
const t = db.prepare('SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM games) AS games, (SELECT COUNT(*) FROM player_games) AS rows, (SELECT MIN(date) FROM games) AS first, (SELECT MAX(date) FROM games) AS last').get()
console.log(`\n${t.players} players, ${t.games} games, ${t.rows} box-score rows, ${t.first} to ${t.last}`)
console.log(failed ? `\n${failed} integrity check(s) FAILED` : '\nAll integrity checks passed.')
process.exit(failed ? 1 : 0)
