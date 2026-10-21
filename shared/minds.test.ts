import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  attachOpponent, buildEvidence, decide, executablePrice, ineligibleReason, legKey, market, matchup, quant, skeptic,
} from './minds.ts'
import type { Pick } from './picks.ts'

let n = 0
/** A pick that passes every data gate and is strong enough for Sam and Val. Override anything. */
const pick = (o: Partial<Pick> = {}): Pick => {
  n++
  return {
    playerId: 1000 + n, player: `P${n}`, team: 'BOS', teamName: 'Boston Celtics', stat: 'pts', side: 'over', line: 20.5 + (n % 9) * 0.5,
    price: 1.9, book: 'DraftKings', prices: [{ book: 'DraftKings', price: 1.9 }, { book: 'FanDuel', price: 1.88 }], oddsId: `o${n}`,
    eventId: `G${n}`, marketBooks: 3, modelProb: 0.7, marketProb: 0.62, prob: 0.64, push: 0, impliedProb: 0.526, ev: 0.1, risk: 'safe',
    model: 'gbm-v1', bigGap: false, projection: 24, hitRate10: 0.7, recent: [], sample: 40, projectionAgeHours: 2, game: 'Boston Celtics @ Detroit Pistons',
    gameDate: '2026-10-21', injury: null, role: { label: 'Starter', min10: 34, trend: 0, games: 60 }, oppFactor: null, ...o,
  } as unknown as Pick
}
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

/** `k` starters on one team in one game, each a different player, minutes falling from 36. */
const team = (eventId: string, abbr: string, name: string, k: number, o: Partial<Pick> = {}): Pick[] =>
  Array.from({ length: k }, (_, i) => pick({ eventId, team: abbr, teamName: name, role: { label: 'Starter', min10: 36 - i, trend: 0, games: 60 }, game: 'Boston Celtics @ Detroit Pistons', ...o }))

// ------------------------------------------------------------------ eligibility

test('data gates: each reason is reported, and a good pick passes', () => {
  assert.equal(ineligibleReason(pick()), null)
  assert.equal(ineligibleReason(pick({ team: null })), 'no_team')
  assert.equal(ineligibleReason(pick({ model: 'baseline-v2' as never })), 'no_fresh_projection')
  assert.equal(ineligibleReason(pick({ projectionAgeHours: 25 })), 'stale_projection')
  assert.equal(ineligibleReason(pick({ projectionAgeHours: null })), 'stale_projection')
  assert.equal(ineligibleReason(pick({ price: 1 })), 'bad_numbers')
  assert.equal(ineligibleReason(pick({ modelProb: NaN })), 'bad_numbers')
  assert.equal(ineligibleReason(pick({ marketProb: null })), 'no_market')
  assert.equal(ineligibleReason(pick({ marketBooks: 1 })), 'too_few_books')
  assert.equal(ineligibleReason(pick({ sample: 9 })), 'thin_history')
  assert.equal(ineligibleReason(pick({ role: null })), 'no_minutes')
  assert.equal(ineligibleReason(pick({ role: { label: 'Rotation', min10: 23.9, trend: 0, games: 40 } })), 'not_a_starter_or_star')
  assert.equal(ineligibleReason(pick({ projectionAgeHours: 24 })), null)           // the limit is inclusive
})

// ------------------------------------------------------------------ Quant

test('Quant: corrects the model for its measured overconfidence, blends with the market, then takes a haircut', () => {
  const p = pick({ stat: 'pts', modelProb: 0.7, marketProb: 0.5, sample: 30, push: 0 })
  const q = quant(p, 1.9)
  near(q.modelCal, 0.5 + 0.851 * 0.2)                            // points slope from the held-out test
  near(q.pBlend, 0.3 * q.modelCal + 0.7 * 0.5)
  near(q.nEff, 30)
  near(q.se, Math.sqrt((q.pBlend * (1 - q.pBlend)) / 30))
  near(q.pCons, q.pBlend - 0.5 * q.se)
  near(q.evHat, q.pBlend * 1.9 - 1)
  near(q.evCons, q.pCons * 1.9 - 1)
  assert.ok(q.evHat > 0 && q.evCons < 0, 'a raw edge of +4.7% disappears once the uncertainty is counted')
})

test('Quant: little history means a bigger haircut; a lot is capped; a stat with no measured slope uses the cautious default', () => {
  const few = quant(pick({ sample: 10 }), 1.9), many = quant(pick({ sample: 200 }), 1.9)
  assert.ok(few.se > many.se)
  near(many.nEff, 40)
  near(quant(pick({ sample: 3 }), 1.9).nEff, 10)
  near(quant(pick({ stat: 'stl' as never, modelProb: 0.7 }), 1.9).modelCal, 0.5 + 0.85 * 0.2)
})

test('Quant: a refund chance scales the expected value, exactly as the app does everywhere else', () => {
  const noPush = quant(pick({ push: 0 }), 1.9), withPush = quant(pick({ push: 0.1 }), 1.9)
  near(withPush.evHat, 0.9 * noPush.evHat)
  near(withPush.evCons, 0.9 * noPush.evCons)
})

// ------------------------------------------------------------------ Market

test('Market: the price counted is the best, but never more than 3% above the runner-up', () => {
  const ok = executablePrice(pick({ prices: [{ book: 'A', price: 2.0 }, { book: 'B', price: 1.95 }] }))
  assert.equal(ok.execPrice, 2.0)
  assert.equal(ok.corroboratedBy, 'B')
  const outlier = executablePrice(pick({ prices: [{ book: 'A', price: 2.4 }, { book: 'B', price: 1.9 }] }))
  near(outlier.execPrice, 1.9 * 1.03)
  const single = executablePrice(pick({ prices: [{ book: 'A', price: 2.0 }] }))
  assert.equal(single.corroboratedBy, null)
})

test('Market: vetoes a lone price, a stale-looking line, and a price that is rich against the market\'s own fair price', () => {
  const v = (o: Partial<Pick>) => { const p = pick(o); const e = executablePrice(p); return market(p, e.execPrice, e.corroboratedBy).vetoes }
  assert.deepEqual(v({}), [])
  assert.deepEqual(v({ prices: [{ book: 'A', price: 1.9 }] }), ['single_price'])
  assert.ok(v({ prices: [{ book: 'A', price: 2.3 }, { book: 'B', price: 1.9 }] }).includes('stale_line'))
  assert.ok(v({ marketProb: 0.4, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] }).includes('rich_price'))   // 0.4 * 1.9 - 1 = -24%
  assert.equal(market(pick(), 1.9, null).lineMovement, 'unavailable')
})

// ------------------------------------------------------------------ Matchup

test('Matchup: minutes and the opponent corroborate or contradict, in the direction of the bet', () => {
  const m = (o: Partial<Pick>) => matchup(pick(o)).score
  assert.equal(m({ side: 'over', role: { label: 'Starter', min10: 34, trend: 3, games: 40 } }), 1)
  assert.equal(m({ side: 'under', role: { label: 'Starter', min10: 34, trend: 3, games: 40 } }), -1)
  assert.equal(m({ side: 'under', role: { label: 'Starter', min10: 34, trend: -3, games: 40 } }), 1)
  assert.equal(m({ side: 'over', oppFactor: 1.08 }), 1)
  assert.equal(m({ side: 'over', oppFactor: 0.9 }), -1)
  assert.equal(m({ side: 'under', oppFactor: 0.9 }), 1)
  assert.equal(m({ side: 'over', oppFactor: 1.01 }), 0)
  assert.equal(m({ side: 'over', oppFactor: null }), 0)
  assert.equal(m({ side: 'over', oppFactor: 1.08, role: { label: 'Starter', min10: 34, trend: 3, games: 40 } }), 2)
  assert.equal(m({ side: 'over', oppFactor: 1.08, role: { label: 'Starter', min10: 34, trend: -3, games: 40 } }), 0)
})

test('attachOpponent finds the other team in the game and reads its tendency for the stat', () => {
  const table = { DET: { pts: 1.06, ast: 0.93 }, BOS: { pts: 0.97 } }
  const [a] = attachOpponent([pick({ teamName: 'Boston Celtics', stat: 'pts', game: 'Boston Celtics @ Detroit Pistons' })], table)
  assert.equal(a.oppFactor, 1.06)
  const [b] = attachOpponent([pick({ teamName: 'Detroit Pistons', stat: 'pts', game: 'Boston Celtics @ Detroit Pistons' })], table)
  assert.equal(b.oppFactor, 0.97)
  assert.equal(attachOpponent([pick({ teamName: 'Boston Celtics', stat: 'blk' as never })], table)[0].oppFactor, null)
  assert.equal(attachOpponent([pick({ teamName: null })], table)[0].oppFactor, null)
})

// ------------------------------------------------------------------ Skeptic

test('Skeptic: vetoes injuries, thin history, falling minutes, extreme gaps, and recent form that contradicts the bet', () => {
  const s = (o: Partial<Pick>) => skeptic(pick(o))
  assert.deepEqual(s({}).vetoes, [])
  assert.ok(s({ injury: { status: 'questionable', label: 'Questionable', note: '' } }).vetoes.includes('injury_listed'))
  assert.ok(s({ sample: 14 }).vetoes.includes('thin_history'))
  assert.ok(!s({ sample: 15 }).vetoes.includes('thin_history'))
  assert.ok(s({ role: { label: 'Starter', min10: 34, trend: -4, games: 40 } }).vetoes.includes('minutes_dropping'))
  assert.ok(s({ modelProb: 0.9, marketProb: 0.65 }).vetoes.includes('extreme_gap'))
  // Under 6.5, but the last 10 games average 9.4: Castle's case
  const castle = s({ side: 'under', line: 6.5, recent: [12, 6, 9, 10, 10, 11, 5, 9, 13, 9] })
  assert.ok(castle.vetoes.includes('form_contradiction'))
  assert.ok(!s({ side: 'under', line: 6.5, recent: [4, 5, 6, 3, 7, 5, 4, 6, 5, 5] }).vetoes.includes('form_contradiction'))
  assert.ok(s({ side: 'over', line: 20.5, recent: [10, 12, 15, 11, 9, 14, 12, 13] }).vetoes.includes('form_contradiction'))
  assert.ok(!s({ side: 'under', line: 6.5, recent: [12, 6, 9] }).vetoes.includes('form_contradiction'), 'too few games to judge form')
})

test('Skeptic: a gap of 15 to 25 points is a review flag, not a veto; a high refund chance is flagged', () => {
  const r = skeptic(pick({ modelProb: 0.78, marketProb: 0.6 }))
  assert.deepEqual(r.vetoes, [])
  assert.ok(r.flags.includes('review_gap'))
  assert.ok(skeptic(pick({ push: 0.1 })).flags.includes('push_risk'))
})

// ------------------------------------------------------------------ the Chief

test('no quotas: a slate with nothing worth betting returns no bets, no parlays and no filler', () => {
  const dull = Array.from({ length: 40 }, () => pick({ modelProb: 0.52, marketProb: 0.5, prob: 0.5, price: 1.9 }))
  const d = decide(dull)
  assert.equal(d.approved.length, 0)
  assert.equal(d.research.length, 0)
  assert.equal(decide([]).approved.length, 0)
})

test('a raw edge that does not survive the uncertainty haircut is not even a candidate', () => {
  const thin = [pick({ modelProb: 0.7, marketProb: 0.5, sample: 30, price: 1.9, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] })]
  const q = quant(thin[0], 1.9)
  assert.ok(q.evHat > 0 && q.evCons < 0)
  assert.equal(decide(thin).stats.candidates, 0)
})

test('a strong, healthy, corroborated pick is approved once, credited to every personality that proposed it, with its reasoning', () => {
  const d = decide([pick()])
  assert.equal(d.approved.length, 1)
  const b = d.approved[0]
  assert.deepEqual(b.proposedBy, ['sam', 'val'])
  assert.equal(b.mind, 'sam')
  assert.equal(b.kind, 'single')
  assert.equal(b.research, false)
  assert.ok(b.evCons >= 0.03 && b.pCons < b.prob)
  assert.equal(b.legPrices[0], 1.9)
  assert.equal(b.rationale.length, 5)
  assert.match(b.rationale.join(' '), /Quant.*Market.*Matchup.*Skeptic/s)
})

test('the Skeptic can veto the Quant: an injured player is rejected, with the reason recorded', () => {
  const d = decide([pick({ injury: { status: 'questionable', label: 'Questionable', note: 'ankle' } })])
  assert.equal(d.approved.length, 0)
  assert.equal(d.rejected.length, 1)
  assert.equal(d.rejected[0].reason, 'injury_listed')
  assert.match(d.rejected[0].detail, /Questionable/)
})

test('recent form that contradicts the model is rejected even though the Quant likes it', () => {
  const d = decide([pick({ side: 'under', line: 6.5, stat: 'ast', recent: [12, 6, 9, 10, 10, 11, 5, 9, 13, 9] })])
  assert.equal(d.approved.length, 0)
  assert.equal(d.rejected[0].reason, 'form_contradiction')
})

test('the Market can reject: a lone price, and a price far above every other book', () => {
  assert.equal(decide([pick({ prices: [{ book: 'A', price: 1.9 }] })]).rejected[0].reason, 'single_price')
  const stale = decide([pick({ price: 2.3, prices: [{ book: 'A', price: 2.3 }, { book: 'B', price: 1.9 }] })])
  assert.ok(stale.rejected.every((r) => r.reason === 'stale_line') && stale.approved.length === 0)
})

test('the Matchup can reject: an opponent that works against the bet', () => {
  const d = decide([pick({ side: 'over', oppFactor: 0.9 })])
  assert.equal(d.approved.length, 0)
  assert.equal(d.rejected[0].reason, 'matchup_contradicted')
})

test('a large model/market gap triggers review: approved only if the matchup explains it, never at 25+ points', () => {
  const gap = { modelProb: 0.74, marketProb: 0.58 }          // 16 points
  assert.equal(decide([pick({ ...gap })]).rejected[0]?.reason, 'unresolved_review')
  assert.equal(decide([pick({ ...gap, oppFactor: 1.08 })]).approved.length, 1)
  assert.equal(decide([pick({ modelProb: 0.9, marketProb: 0.64, oppFactor: 1.08 })]).rejected[0].reason, 'extreme_gap')
})

test('Contrarian Cat only proposes where the market rates the side under 50% and the matchup explains the disagreement', () => {
  const cat = { modelProb: 0.58, marketProb: 0.45, price: 2.4, prices: [{ book: 'A', price: 2.4 }, { book: 'B', price: 2.35 }], side: 'over' as const }
  const without = decide([pick({ ...cat })])
  assert.equal(without.approved.length, 0)
  assert.equal(without.rejected[0].reason, 'cat_uncorroborated')
  const withMatchup = decide([pick({ ...cat, oppFactor: 1.08 })])
  assert.equal(withMatchup.approved.length, 1)
  assert.ok(withMatchup.approved[0].proposedBy.includes('cat'))
  assert.equal(decide([pick({ ...cat, marketProb: 0.52, oppFactor: 1.08 })]).approved.filter((b) => b.proposedBy.includes('cat')).length, 0)
})

test('portfolio: one bet per player and stat, at most 2 per player, 4 per game', () => {
  const star = Array.from({ length: 5 }, (_, i) => pick({ playerId: 1, player: 'Star', eventId: 'G1', stat: (['pts', 'reb', 'ast', 'fg3m', 'pts'] as const)[i], line: 10.5 + i, role: { label: 'Starter', min10: 38, trend: 0, games: 60 } }))
  const d = decide(star)
  assert.ok(d.approved.length <= 2)
  assert.ok(d.rejected.some((r) => r.reason === 'player_cap' || r.reason === 'duplicate_exposure'))

  const oneGame = Array.from({ length: 6 }, (_, i) => pick({ eventId: 'G7', role: { label: 'Starter', min10: 36 - i, trend: 0, games: 60 } }))
  const g = decide(oneGame)
  assert.equal(g.approved.length, 4)
  assert.equal(g.rejected.filter((r) => r.reason === 'game_cap').length, 2)
})

test('portfolio: a daily limit and an all-Under share cap drop bets; they never add any', () => {
  const many = Array.from({ length: 5 }, (_, g) => team(`E${g}`, 'BOS', 'Boston Celtics', 6, { eventId: `E${g}` })).flat()
  const d = decide(many)
  assert.ok(d.approved.length <= 12)
  assert.ok(d.approved.length > 0)
  assert.ok(d.rejected.some((r) => r.reason === 'daily_cap' || r.reason === 'game_cap'))
  const unders = Array.from({ length: 5 }, (_, g) => team(`U${g}`, 'BOS', 'Boston Celtics', 4, { eventId: `U${g}`, side: 'under' })).flat()
  const u = decide(unders)
  assert.ok(u.rejected.some((r) => r.reason === 'under_share_cap'))
  assert.equal(u.approved.length, 5, 'the share cap starts to bite from the sixth bet of an all-Under card')
  const mixed = [...unders, ...Array.from({ length: 4 }, (_, g) => team(`O${g}`, 'BOS', 'Boston Celtics', 4, { eventId: `O${g}`, side: 'over' })).flat()]
  const m = decide(mixed)
  const share = m.approved.filter((b) => b.legs[0].side === 'under').length / m.approved.length
  assert.ok(share <= 0.75, `under share ${share}`)
  assert.ok(m.approved.some((b) => b.legs[0].side === 'over'))
})

test('every rejected candidate is recorded with a reason, and totals add up', () => {
  const mix = [pick(), pick({ injury: { status: 'out', label: 'Out', note: '' } }), pick({ prices: [{ book: 'A', price: 1.9 }] }), pick({ team: null })]
  const d = decide(mix)
  assert.equal(d.stats.picks, 4)
  assert.equal(d.stats.ineligible.no_team, 1)
  assert.equal(d.stats.candidates, 3)
  assert.equal(d.approved.length + d.rejected.length, 3)
  assert.ok(d.rejected.every((r) => r.reason.length > 0 && r.detail.length > 0 && r.proposedBy.length > 0))
})

// ------------------------------------------------------------------ parlays

const leg = (eventId: string, o: Partial<Pick> = {}) => pick({ eventId, modelProb: 0.7, marketProb: 0.62, line: 10.5, ...o })

test('parlays: research-only, different games, built only from individually qualified legs, assessed on conservative joint probability', () => {
  const legs = ['A', 'B', 'C', 'D'].map((g) => leg(g, { price: 1.95, prices: [{ book: 'X', price: 1.95 }, { book: 'Y', price: 1.94 }] }))
  const d = decide(legs)
  assert.ok(d.research.length >= 1)
  const p = d.research[0]
  assert.equal(p.research, true)
  assert.equal(p.kind, 'combo')
  assert.ok(p.legs.length >= 3 && p.legs.length <= 5)
  assert.equal(new Set(p.legs.map((l) => l.eventId)).size, p.legs.length, 'no two legs from one game')
  near(p.pCons, p.legEvidence.reduce((a, e) => a * e.quant.pCons, 1))
  near(p.odds, p.legPrices.reduce((a, x) => a * x, 1))
  assert.ok(p.evCons >= 0.1)
  assert.ok(d.approved.every((b) => !b.research))
})

test('parlays: never two legs from the same game, never a weak leg, and none if the product does not clear the floor', () => {
  const sameGame = Array.from({ length: 6 }, (_, i) => leg('ONE', { role: { label: 'Starter', min10: 36 - i, trend: 0, games: 60 } }))
  assert.equal(decide(sameGame).research.length, 0)
  const weak = ['A', 'B', 'C'].map((g) => leg(g, { modelProb: 0.55, marketProb: 0.52 }))
  assert.equal(decide(weak).research.length, 0)
  const refund = ['A', 'B', 'C'].map((g) => leg(g, { push: 0.1 }))
  assert.equal(decide(refund).research.length, 0, 'whole-number lines are left out of parlays')
})

test('parlays: never topped up, and never more than 3 a day', () => {
  const many = Array.from({ length: 30 }, (_, i) => leg(`G${i}`, { price: 1.95, prices: [{ book: 'X', price: 1.95 }, { book: 'Y', price: 1.94 }] }))
  const d = decide(many)
  assert.equal(d.research.length, 3, 'six parlays are possible; three is the cap')
  const used = d.research.flatMap((p) => p.legs.map(legKey))
  assert.equal(new Set(used).size, used.length, 'no leg is used twice')
  assert.equal(decide(many.slice(0, 2)).research.length, 0, 'two legs are not a parlay here')
})

test('buildEvidence ties the four views together on one executable price', () => {
  const e = buildEvidence(pick({ prices: [{ book: 'A', price: 2.4 }, { book: 'B', price: 1.9 }] }))
  near(e.market.execPrice, 1.9 * 1.03)
  near(e.quant.evHat, e.quant.pBlend * e.market.execPrice - 1)
})

test('the daily limit of 12 bets binds, and the best conservative value is kept', () => {
  const many = Array.from({ length: 30 }, (_, i) => leg(`G${i}`, { role: { label: 'Starter', min10: 34, trend: 0, games: 60 }, modelProb: 0.66 + (i % 10) * 0.005 }))
  const d = decide(many)
  assert.equal(d.approved.length, 12)
  const kept = d.approved.map((b) => b.evCons)
  assert.deepEqual([...kept].sort((a, b) => b - a), kept, 'approved in order of conservative value')
  assert.equal(d.rejected.filter((r) => r.reason === 'daily_cap').length, 18)
})

test('only the six best players of a team by minutes are considered', () => {
  const nine = Array.from({ length: 9 }, (_, i) => pick({ eventId: 'GX', team: 'BOS', role: { label: 'Starter', min10: 36 - i, trend: 0, games: 60 } }))
  const d = decide(nine)
  assert.equal(d.stats.eligible, 6)
  assert.equal(d.stats.ineligible.not_a_starter_or_star, 3)
})

test('parlays: the floor is +10% conservative value for the whole parlay, so three thin legs do not make one', () => {
  const thin = ['A', 'B', 'C'].map((g) => leg(g, { price: 1.725, prices: [{ book: 'X', price: 1.725 }, { book: 'Y', price: 1.72 }] }))
  const evLeg = quant(thin[0], 1.725).evCons
  assert.ok(evLeg > 0.025 && evLeg < 0.035, `leg value ${evLeg}`)          // each leg is individually fine...
  assert.equal(decide(thin).research.length, 0)                              // ...but 1.03^3 is only about +9%
  const richer = ['A', 'B', 'C'].map((g) => leg(g, { price: 1.79, prices: [{ book: 'X', price: 1.79 }, { book: 'Y', price: 1.78 }] }))
  assert.equal(decide(richer).research.length, 1)
})

test('parlay legs need a conservative chance of 45%, however good the price looks', () => {
  const longshots = ['A', 'B', 'C'].map((g) => pick({ eventId: g, modelProb: 0.52, marketProb: 0.45, price: 2.6, prices: [{ book: 'X', price: 2.6 }, { book: 'Y', price: 2.58 }] }))
  const q = quant(longshots[0], 2.6)
  assert.ok(q.pCons < 0.45 && q.evCons > 0.02, `pCons ${q.pCons} ev ${q.evCons}`)
  assert.equal(decide(longshots).research.length, 0)
})

test('Safe Sam does not propose a likely bet that has negative conservative value', () => {
  const short = pick({ price: 1.45, prices: [{ book: 'A', price: 1.45 }, { book: 'B', price: 1.44 }] })   // 63% at 1.45 loses money
  const q = quant(short, 1.45)
  assert.ok(q.pBlend >= 0.6 && q.evCons < 0, `pBlend ${q.pBlend} ev ${q.evCons}`)
  assert.equal(decide([short]).stats.candidates, 0)
})

test('Contrarian Cat needs a gap of 10 points, however good the matchup looks', () => {
  const small = pick({ modelProb: 0.52, marketProb: 0.45, price: 2.6, prices: [{ book: 'A', price: 2.6 }, { book: 'B', price: 2.58 }], oppFactor: 1.1 })
  assert.ok(quant(small, 2.6).evCons > 0.02)
  assert.equal(decide([small]).approved.filter((b) => b.proposedBy.includes('cat')).length, 0)
})

test('parlays: at most 5 legs, and a weak leg is not added just because it nudges the product up', () => {
  const six = Array.from({ length: 7 }, (_, i) => leg(`S${i}`, { price: 1.9, prices: [{ book: 'X', price: 1.9 }, { book: 'Y', price: 1.89 }] }))
  assert.ok(decide(six).research.every((p) => p.legs.length <= 5))
  assert.equal(decide(six).research[0].legs.length, 5)
  const strong = ['A', 'B', 'C', 'D'].map((g) => leg(g, { price: 1.85, prices: [{ book: 'X', price: 1.85 }, { book: 'Y', price: 1.84 }] }))
  const weak = leg('E', { price: 1.69, prices: [{ book: 'X', price: 1.69 }, { book: 'Y', price: 1.68 }] })
  const wq = quant(weak, 1.69).evCons
  assert.ok(wq > 0 && wq < 0.02, `weak leg value ${wq}`)
  const d = decide([...strong, weak])
  assert.equal(d.research.length, 1)
  assert.equal(d.research[0].legs.length, 4, 'the +1% leg is below the +2% leg floor')
})

test('a raw edge removed by the uncertainty haircut becomes a lean: smaller stake, its own tier, the reasoning says so', () => {
  const thin = pick({ modelProb: 0.66, marketProb: 0.54, sample: 30, price: 1.9, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] })
  const d = decide([thin])
  assert.equal(d.approved.length, 0, 'not a strict bet')
  assert.equal(d.leans.length, 1)
  const l = d.leans[0]
  assert.equal(l.tier, 'lean')
  assert.equal(l.stake, 0.5)
  assert.equal(l.research, false)
  assert.ok(l.ev >= 0.02 && l.evCons < 0.03)
  assert.match(l.rationale[0], /^LEAN, suggested stake 0\.5 unit/)
  assert.equal(d.approved.concat(d.leans).filter((b) => b.tier === 'strict').length, 0)
  // a pick with no raw edge at all is neither a lean nor worth recording
  const none = decide([pick({ modelProb: 0.5, marketProb: 0.5, price: 1.9 })])
  assert.equal(none.leans.length, 0)
})

test('leans: never a vetoed pick, never below +2% raw value or 50% chance, never a strict bet twice, at most 8 a day, one per player', () => {
  const edge = { modelProb: 0.66, marketProb: 0.54, sample: 30, price: 1.9, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] }
  assert.equal(decide([pick({ ...edge, injury: { status: 'questionable', label: 'Questionable', note: '' } })]).leans.length, 0)
  assert.equal(decide([pick({ ...edge, modelProb: 0.55, marketProb: 0.52 })]).leans.length, 0, 'raw value under +2%')
  const strong = decide([pick()])
  assert.equal(strong.approved.length, 1)
  assert.equal(strong.leans.length, 0, 'a strict bet is not repeated as a lean')
  const many = Array.from({ length: 30 }, (_, i) => pick({ ...edge, eventId: `L${i}` }))
  assert.equal(decide(many).leans.length, 8)
  const longshot = pick({ modelProb: 0.5, marketProb: 0.45, price: 2.6, prices: [{ book: 'A', price: 2.6 }, { book: 'B', price: 2.58 }] })
  const lq = quant(longshot, 2.6)
  assert.ok(lq.evHat > 0.15 && lq.pBlend < 0.5, `evHat ${lq.evHat} pBlend ${lq.pBlend}`)
  assert.equal(decide([longshot]).leans.length, 0, 'a big payout at under 50% is a longshot, not a lean')
  const withStrict = decide([pick({ playerId: 77, player: 'Both', eventId: 'LB', line: 10.5 }), pick({ playerId: 77, player: 'Both', eventId: 'LB', line: 11.5, modelProb: 0.66, marketProb: 0.54, sample: 30 })])
  assert.equal(withStrict.approved.length, 1)
  assert.equal(withStrict.leans.length, 0, 'a player with a strict bet gets no lean')
  const oneStar = Array.from({ length: 4 }, (_, i) => pick({ ...edge, playerId: 5, player: 'Star', eventId: 'LS', line: 10.5 + i, stat: (['pts', 'reb', 'ast', 'fg3m'] as const)[i] }))
  assert.equal(decide(oneStar).leans.length, 1, 'one lean per player')
})

test('leans credit the personalities whose point-estimate thresholds they meet', () => {
  const lean = decide([pick({ modelProb: 0.66, marketProb: 0.54, sample: 30, price: 1.9, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] })]).leans[0]
  assert.deepEqual(lean.proposedBy, ['val'])
  const safe = decide([pick({ modelProb: 0.72, marketProb: 0.6, sample: 20, price: 1.75, prices: [{ book: 'A', price: 1.75 }, { book: 'B', price: 1.74 }] })])
  const all = [...safe.approved, ...safe.leans]
  assert.ok(all.length === 1 && all[0].proposedBy.includes('sam'))
})

test('at most 60 near misses are recorded a day', () => {
  const many = Array.from({ length: 100 }, (_, i) => pick({ eventId: `N${i}`, modelProb: 0.66, marketProb: 0.54, sample: 30, price: 1.9, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] }))
  const d = decide(many)
  assert.equal(d.rejected.filter((r) => r.reason === 'uncertainty_haircut').length, 60)
})

test('a no-bet day still lists the closest candidates as a watchlist: never bets, best first, vetoed picks excluded', () => {
  const slate = Array.from({ length: 40 }, (_, i) => pick({ eventId: `W${i}`, modelProb: 0.52 + i * 0.002, marketProb: 0.52, price: 1.9, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] }))
  const injured = pick({ eventId: 'WX', modelProb: 0.6, marketProb: 0.52, injury: { status: 'questionable', label: 'Questionable', note: '' } })
  const d = decide([...slate, injured])
  assert.equal(d.approved.length, 0)
  assert.equal(d.research.length, 0)
  const watch = d.rejected.filter((r) => r.reason === 'watchlist')
  assert.equal(watch.length, 25)
  assert.deepEqual(watch.map((r) => r.evCons), [...watch.map((r) => r.evCons)].sort((a, b) => b - a), 'closest first')
  assert.ok(watch.every((r) => r.pick.player !== injured.player), 'a vetoed pick is not "close"')
  assert.match(watch[0].detail, /closest to qualifying/)
  assert.equal(decide([]).rejected.length, 0)
})

test('a candidate that is already rejected or approved is not repeated on the watchlist', () => {
  const d = decide([pick(), pick({ prices: [{ book: 'A', price: 1.9 }] }), pick({ modelProb: 0.5, marketProb: 0.5 })])
  assert.equal(d.approved.length, 1)
  const keys = d.rejected.map((r) => `${r.pick.playerId}|${r.pick.line}|${r.pick.side}`)
  assert.equal(new Set(keys).size, keys.length)
})

test('leans obey the same all-Under share cap, counted together with the strict bets', () => {
  const edge = { modelProb: 0.66, marketProb: 0.54, sample: 30, price: 1.9, prices: [{ book: 'A', price: 1.9 }, { book: 'B', price: 1.9 }] }
  const unders = Array.from({ length: 20 }, (_, i) => pick({ ...edge, eventId: `LU${i}`, side: 'under' }))
  assert.equal(decide(unders).leans.length, 5, 'the sixth all-Under bet of a card is not taken')
  const mixed = [...unders, ...Array.from({ length: 6 }, (_, i) => pick({ ...edge, eventId: `LO${i}`, side: 'over', modelProb: 0.655 }))]
  const d = decide(mixed)
  assert.ok(d.leans.some((b) => b.legs[0].side === 'over'))
})

// ------------------------------------------------------------------ the paper volume board

import { volumeBoard } from './minds.ts'

/** `k` players on one team in one game, each with all four statistics, at most one line each, no market (one-sided quotes). */
const board = (eventId: string, k: number, o: Partial<Pick> = {}): Pick[] =>
  Array.from({ length: k }, (_, i) => (['pts', 'reb', 'ast', 'fg3m'] as const).map((stat) =>
    pick({ eventId, team: 'BOS', teamName: 'Boston Celtics', stat, marketProb: null, marketBooks: 1, prices: [{ book: 'A', price: 1.9 }], modelProb: 0.58, game: 'Boston Celtics @ Detroit Pistons',
      role: { label: 'Starter', min10: 36 - i, trend: 0, games: 60 }, ...o, playerId: 9000 + eventId.charCodeAt(0) * 10 + i, player: `V${eventId}${i}` }))).flat()

test('volume board: paper only, every starter\'s statistics even with no market, up to 40 a game, best raw value first', () => {
  const b = volumeBoard(board('V1', 8))
  assert.equal(b.bets.length, 32, '8 players x 4 statistics, one line each')
  assert.ok(b.bets.every((x) => x.tier === 'volume' && x.research === false))
  assert.match(b.bets[0].rationale[0], /^VOLUME BOARD \(paper, never staked\)/)
  const ev = b.bets.map((x) => x.ev)
  assert.deepEqual([...ev].sort((x, y) => y - x), ev, 'best first')
  assert.equal(Object.values(b.byGame)[0], 32)
  assert.equal(volumeBoard(board('V2', 14, {})).bets.length, 40, 'only the best 10 by minutes, so at most 40 a game')
})

test('volume board: one line per player and statistic, and it is the better one', () => {
  const many = ['A', 'B', 'C', 'D', 'E'].flatMap((g) => board(g, 8))
  assert.ok(volumeBoard(many).bets.length <= 5 * 40)
  const wide = Array.from({ length: 8 }, (_, i) => (['pts', 'reb', 'ast', 'fg3m'] as const).flatMap((stat) =>
    Array.from({ length: 3 }, (_, k) => pick({ eventId: 'W1', team: 'BOS', stat, line: 5.5 + k, marketProb: null, marketBooks: 1, prices: [{ book: 'A', price: 1.9 }], role: { label: 'Starter', min10: 36 - i, trend: 0, games: 60 }, playerId: 8000 + i, player: `W${i}`, game: 'Boston Celtics @ Detroit Pistons' }))))
    .flat()
  const b = volumeBoard(wide)
  assert.equal(b.bets.length, 32, 'a ladder of three lines is one bet, not three')
  const sides = [pick({ eventId: 'S1', playerId: 31, player: 'Pair', stat: 'pts', side: 'over', line: 20.5, modelProb: 0.45, marketProb: null, marketBooks: 1, prices: [{ book: 'A', price: 1.9 }] }),
    pick({ eventId: 'S1', playerId: 31, player: 'Pair', stat: 'pts', side: 'under', line: 20.5, modelProb: 0.55, marketProb: null, marketBooks: 1, prices: [{ book: 'A', price: 1.9 }] })]
  const pair = volumeBoard(sides).bets
  assert.equal(pair.length, 1)
  assert.equal(pair[0].legs[0].side, 'under', 'the side with the better value is kept')
  const keys = b.bets.map((x) => `${x.legs[0].playerId}|${x.legs[0].stat}`)
  assert.equal(new Set(keys).size, keys.length)
  const dense = volumeBoard(Array.from({ length: 6 }, (_, g) => board(`D${g}`, 8)).flat().filter((_, i) => i % 1 === 0))
  assert.ok(Object.values(dense.byGame).every((n) => n <= 40))
})

test('volume board: leaves out injured players, falling minutes, stale projections and non-rotation players', () => {
  const base = board('X1', 3)
  assert.equal(volumeBoard(base).bets.length, 12)
  assert.equal(volumeBoard(board('X2', 3, { injury: { status: 'questionable', label: 'Questionable', note: '' } })).bets.length, 0)
  assert.equal(volumeBoard(board('X3', 3, { role: { label: 'Starter', min10: 30, trend: -5, games: 60 } })).bets.length, 0)
  assert.equal(volumeBoard(board('X4', 3, { projectionAgeHours: 30 })).bets.length, 0)
  assert.equal(volumeBoard(board('X5', 3, { role: { label: 'Bench', min10: 17, trend: 0, games: 60 } })).bets.length, 0)
  assert.equal(volumeBoard(board('X6', 3, { sample: 9 })).bets.length, 0)
  assert.equal(volumeBoard(board('X7', 3, { model: 'baseline-v2' as never })).bets.length, 0)
  assert.equal(volumeBoard([]).bets.length, 0)
})

test('volume board never touches the strict or lean tiers', () => {
  const picks = [...board('Y1', 6), pick()]
  const d = decide(picks)
  assert.equal(d.approved.length, 1)
  assert.ok(d.volume.length >= 24)
  assert.ok([...d.approved, ...d.leans].every((b) => b.tier === 'strict' || b.tier === 'lean'))
  assert.equal(d.stats.volume, d.volume.length)
})

test('volume board: only main-line prices; a far alternate or a stale 30x quote never tops the ranking', () => {
  const ok = pick({ eventId: 'M1', playerId: 61, player: 'Main', stat: 'pts', line: 24.5, price: 1.9, prices: [{ book: 'A', price: 1.9 }], marketProb: null, marketBooks: 1 })
  const tail = pick({ eventId: 'M1', playerId: 61, player: 'Main', stat: 'pts', line: 34.5, price: 9.0, prices: [{ book: 'A', price: 9.0 }], marketProb: null, marketBooks: 1, modelProb: 0.4 })
  const junk = pick({ eventId: 'M1', playerId: 61, player: 'Main', stat: 'reb', line: 4.5, price: 31, prices: [{ book: 'A', price: 31 }], marketProb: null, marketBooks: 1 })
  const short = pick({ eventId: 'M1', playerId: 61, player: 'Main', stat: 'ast', line: 4.5, price: 1.2, prices: [{ book: 'A', price: 1.2 }], marketProb: null, marketBooks: 1 })
  const b = volumeBoard([ok, tail, junk, short]).bets
  assert.equal(b.length, 1)
  assert.equal(b[0].legs[0].line, 24.5)
  assert.ok(b.every((x) => x.ev < 1), 'no absurd values')
  for (const price of [1.49, 2.61]) assert.equal(volumeBoard([pick({ eventId: 'M2', price, prices: [{ book: 'A', price }], marketProb: null, marketBooks: 1 })]).bets.length, 0)
  for (const price of [1.5, 2.6]) assert.equal(volumeBoard([pick({ eventId: 'M3', price, prices: [{ book: 'A', price }], marketProb: null, marketBooks: 1 })]).bets.length, 1)
})
