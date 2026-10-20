// Run: npm run test:db      Tests ingest/grade.sql on an in-memory SQLite database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const GRADE = readFileSync(new URL('../ingest/grade.sql', import.meta.url), 'utf8')

function fresh() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE games (id INTEGER PRIMARY KEY, date TEXT);
    CREATE TABLE player_games (player_id INTEGER, game_id INTEGER, pts INTEGER, reb INTEGER, ast INTEGER, fg3m INTEGER, stl INTEGER, blk INTEGER);
    CREATE TABLE predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER, stat TEXT, line REAL, side TEXT,
      game_date TEXT, price REAL, actual REAL, hit INTEGER);
    INSERT INTO games VALUES (1, '2026-10-20'), (2, '2026-10-21');
    INSERT INTO player_games VALUES (7, 1, 24, 8, 5, 3, 1, 0), (8, 1, 30, 2, 9, 1, 0, 2), (7, 2, 10, 1, 1, 0, 0, 0);
  `)
  return db
}
const add = (db, row) => db.prepare('INSERT INTO predictions (player_id, stat, line, side, game_date, price) VALUES (?,?,?,?,?,?)').run(...row)
const grade = (db) => db.exec(GRADE)
const all = (db) => db.prepare('SELECT stat, line, side, actual, hit FROM predictions ORDER BY id').all()

describe('grading', () => {
  it('over / under / push / loss are graded correctly on a half-point and a whole-number line', () => {
    const db = fresh()
    add(db, [7, 'pts', 23.5, 'over', '2026-10-20', 1.9])   // 24 > 23.5 -> win
    add(db, [7, 'pts', 23.5, 'under', '2026-10-20', 1.9])  // loss
    add(db, [7, 'pts', 24, 'over', '2026-10-20', 1.9])     // tie -> push
    add(db, [7, 'pts', 24, 'under', '2026-10-20', 1.9])    // tie -> push
    add(db, [7, 'reb', 9, 'under', '2026-10-20', 1.9])     // 8 < 9 -> win
    grade(db)
    assert.deepEqual(all(db).map((r) => r.hit), [1, 0, 2, 2, 1])
  })

  it('reads the right statistic for each market', () => {
    const db = fresh()
    for (const stat of ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk']) add(db, [7, stat, 100, 'under', '2026-10-20', 2])
    grade(db)
    assert.deepEqual(all(db).map((r) => r.actual), [24, 8, 5, 3, 1, 0])
  })

  it('uses the game on the pick date, not another game by the same player', () => {
    const db = fresh()
    add(db, [7, 'pts', 20.5, 'over', '2026-10-21', 1.9]) // that night he scored 10
    grade(db)
    assert.deepEqual(all(db).map((r) => [r.actual, r.hit]), [[10, 0]])
  })

  it('a player who did not play stays ungraded (a void bet), and manual rows without a side are never graded', () => {
    const db = fresh()
    add(db, [99, 'pts', 10.5, 'over', '2026-10-20', 1.9])  // no box score row
    add(db, [7, 'pts', 10.5, null, '2026-10-20', null])    // manual log: no side
    grade(db)
    assert.deepEqual(all(db).map((r) => r.hit), [null, null])
  })

  it('is idempotent: a graded pick is never re-graded, even if the box score later changes', () => {
    const db = fresh()
    add(db, [7, 'pts', 23.5, 'over', '2026-10-20', 1.9])
    grade(db)
    db.exec('UPDATE player_games SET pts = 0 WHERE player_id = 7 AND game_id = 1')
    grade(db)
    grade(db)
    assert.deepEqual(all(db).map((r) => [r.actual, r.hit]), [[24, 1]])
  })

  it('picks for games not yet in the database wait', () => {
    const db = fresh()
    add(db, [7, 'pts', 23.5, 'over', '2026-12-31', 1.9])
    grade(db)
    assert.deepEqual(all(db).map((r) => r.hit), [null])
  })
})
