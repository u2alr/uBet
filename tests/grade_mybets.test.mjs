// Run: npm run test:db      Tests ingest/grade_mybets.sql on an in-memory SQLite database.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const GRADE = readFileSync(new URL('../ingest/grade_mybets.sql', import.meta.url), 'utf8')
const MIG = readFileSync(new URL('../migrations/0016_my_bets.sql', import.meta.url), 'utf8')

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
function bet(db, stake, legs, date = '2026-10-01') {
  const id = db.prepare('INSERT INTO my_bets (stake) VALUES (?)').run(stake).lastInsertRowid
  legs.forEach(([pid, stat, side, line, price], i) => db.prepare(
    'INSERT INTO my_bet_legs (bet_id, idx, player_id, player, stat, side, line, price, game_date) VALUES (?,?,?,?,?,?,?,?,?)').run(id, i, pid, 'P', stat, side, line, price, date))
  return Number(id)
}
const st = (db, id) => db.prepare('SELECT status, profit, settled_odds FROM my_bets WHERE id = ?').get(id)

describe('grading the bets actually placed', () => {
  it('a winning single pays stake times (odds - 1) at the odds actually taken; a losing single loses the stake', () => {
    const db = fresh()
    const w = bet(db, 20, [[7, 'pts', 'over', 23.5, 1.9]]), l = bet(db, 20, [[7, 'pts', 'under', 23.5, 1.9]])
    db.exec(GRADE)
    assert.equal(st(db, w).status, 'won'); assert.ok(Math.abs(st(db, w).profit - 18) < 1e-9)
    assert.deepEqual([st(db, l).status, st(db, l).profit], ['lost', -20])
  })
  it('a parlay needs every leg: one lost leg loses it; all won multiplies the prices', () => {
    const db = fresh()
    const lost = bet(db, 10, [[7, 'pts', 'over', 23.5, 1.9], [8, 'pts', 'under', 29.5, 1.9]])
    const won = bet(db, 10, [[7, 'pts', 'over', 23.5, 2], [8, 'pts', 'over', 29.5, 1.5], [7, 'reb', 'over', 7.5, 2]])
    db.exec(GRADE)
    assert.deepEqual([st(db, lost).status, st(db, lost).profit], ['lost', -10])
    assert.equal(st(db, won).status, 'won'); assert.ok(Math.abs(st(db, won).settled_odds - 6) < 1e-9); assert.ok(Math.abs(st(db, won).profit - 50) < 1e-9)
  })
  it('a pushed leg is dropped from a parlay and the price recomputed; a lone push returns the stake', () => {
    const db = fresh()
    const parlay = bet(db, 10, [[7, 'pts', 'over', 24, 3], [8, 'pts', 'over', 29.5, 2]])    // first leg lands exactly on 24
    const single = bet(db, 10, [[7, 'pts', 'over', 24, 3]])
    db.exec(GRADE)
    assert.equal(st(db, parlay).status, 'won'); assert.ok(Math.abs(st(db, parlay).settled_odds - 2) < 1e-9); assert.ok(Math.abs(st(db, parlay).profit - 10) < 1e-9)
    assert.deepEqual([st(db, single).status, st(db, single).profit], ['push', 0])
  })
  it('a bet stays open while any leg has no box score yet, and a leg of a player who did not play is void once the date has passed', () => {
    const db = fresh()
    const open = bet(db, 10, [[7, 'pts', 'over', 23.5, 2], [8, 'pts', 'over', 20.5, 2]], '2099-01-01')   // a game that has not been played
    const dnp = bet(db, 10, [[99, 'pts', 'over', 10.5, 2]], '2026-10-01')                               // player 99 has no row on a date other games reached
    db.exec(GRADE)
    assert.equal(st(db, open).status, 'open'); assert.equal(st(db, open).profit, null)
    assert.deepEqual([st(db, dnp).status, st(db, dnp).profit], ['void', 0])
  })
  it('PRA is points plus rebounds plus assists, and grading twice changes nothing', () => {
    const db = fresh()
    const b = bet(db, 10, [[7, 'pra', 'over', 36.5, 2]])          // 24 + 8 + 5 = 37
    db.exec(GRADE); const once = st(db, b); db.exec(GRADE)
    assert.equal(once.status, 'won'); assert.deepEqual(st(db, b), once)
  })
})
