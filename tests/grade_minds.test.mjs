// Run: npm run test:db      Tests ingest/grade_minds.sql on an in-memory SQLite database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const GRADE = readFileSync(new URL('../ingest/grade_minds.sql', import.meta.url), 'utf8')
const MIG = readFileSync(new URL('../migrations/0010_minds.sql', import.meta.url), 'utf8')

function fresh() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE games (id INTEGER PRIMARY KEY, date TEXT);
    CREATE TABLE player_games (player_id INTEGER, game_id INTEGER, pts INTEGER, reb INTEGER, ast INTEGER, fg3m INTEGER, stl INTEGER, blk INTEGER);
    INSERT INTO games VALUES (1, '2026-10-01'), (2, '2026-10-02');
    INSERT INTO player_games VALUES (7, 1, 24, 8, 5, 3, 1, 0), (8, 1, 30, 2, 9, 1, 0, 2);
  ` + MIG)
  return db
}
let k = 0
function bet(db, legs, date = '2026-10-01') {
  const id = db.prepare("INSERT INTO mind_bets (bet_key, day, mind, version, kind, odds, prob, ev) VALUES (?,?,?,?,?,?,?,?)")
    .run(`k${++k}`, date, 'sam', 'v', legs.length > 1 ? 'combo' : 'single', 2, 0.5, 0).lastInsertRowid
  legs.forEach(([pid, stat, side, line, price], i) => db.prepare(
    'INSERT INTO mind_legs (bet_id, idx, player_id, player, stat, side, line, price, game_date, prob) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, i, pid, 'P', stat, side, line, price, date, 0.5))
  return Number(id)
}
const st = (db, id) => db.prepare('SELECT status, profit, settled_odds FROM mind_bets WHERE id = ?').get(id)

describe('grading minds', () => {
  it('single win, loss and push', () => {
    const db = fresh()
    const w = bet(db, [[7, 'pts', 'over', 23.5, 1.9]]), l = bet(db, [[7, 'pts', 'under', 23.5, 1.9]]), p = bet(db, [[7, 'pts', 'over', 24, 1.9]])
    db.exec(GRADE)
    assert.equal(st(db, w).status, 'won'); assert.ok(Math.abs(st(db, w).profit - 0.9) < 1e-9)
    assert.equal(st(db, l).status, 'lost'); assert.equal(st(db, l).profit, -1)
    assert.equal(st(db, p).status, 'push'); assert.equal(st(db, p).profit, 0)
  })
  it('combo pays the product, a pushed leg is dropped, one lost leg loses at once', () => {
    const db = fresh()
    const win = bet(db, [[7, 'pts', 'over', 23.5, 1.5], [8, 'ast', 'over', 8.5, 2.0]])
    const drop = bet(db, [[7, 'pts', 'over', 24, 1.5], [8, 'ast', 'over', 8.5, 2.0]])
    const lose = bet(db, [[7, 'pts', 'under', 23.5, 1.5], [8, 'ast', 'over', 8.5, 2.0], [7, 'pts', 'over', 23.5, 3.0]])
    db.exec(GRADE)
    assert.equal(st(db, win).status, 'won'); assert.ok(Math.abs(st(db, win).profit - 2) < 1e-9)
    assert.ok(Math.abs(st(db, drop).settled_odds - 2) < 1e-9); assert.ok(Math.abs(st(db, drop).profit - 1) < 1e-9)
    assert.equal(st(db, lose).status, 'lost')
  })
  it('waits for unplayed games, voids a leg after two days, and is idempotent', () => {
    const db = fresh()
    const future = bet(db, [[7, 'pts', 'over', 10.5, 2]], '2999-01-01')
    const dnp = bet(db, [[99, 'pts', 'over', 10.5, 2]], '2026-10-01')
    db.exec(GRADE); db.exec(GRADE)
    assert.equal(st(db, future).status, 'open')
    assert.equal(st(db, dnp).status, 'void'); assert.equal(st(db, dnp).profit, 0)
    const again = db.prepare('SELECT status, profit FROM mind_bets').all()
    db.exec(GRADE)
    assert.deepEqual(db.prepare('SELECT status, profit FROM mind_bets').all(), again)
  })
})
