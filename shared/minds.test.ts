import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, exposureOf, meetsCat, meetsSam, meetsVal, validateProposal, volumeBoard, attachOpponent, MINDS_VERSION, type Decision, type DecideOptions } from './minds.ts'
import { makeConfig } from './engine/config.ts'
import { NOW, identityArtifact, mkPick, resetFixtureCounter, withMarket } from './engine/fixtures.ts'
import { buildCandidate, minutesRanks } from './engine/record.ts'
import type { Pick } from './picks.ts'

const near = (a: number | null, b: number, e = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < e, `${a} vs ${b}`)
const opts = (o: Partial<DecideOptions> = {}): DecideOptions => ({ now: NOW, calibration: identityArtifact(), injuryChecked: true, ...o })
const run = (picks: Pick[], o: Partial<DecideOptions> = {}): Decision => decide(picks, opts(o))
const recordOf = (p: Pick, o: Partial<DecideOptions> = {}) => buildCandidate(p, { now: NOW, config: o.config ?? makeConfig(), calibration: o.calibration === undefined ? identityArtifact() : o.calibration, minutesRank: minutesRanks([p]), injuryChecked: true })

/** A Value Val candidate: a clear model edge that the matchup explains, at a fair market price. */
const valPick = (o: Partial<Pick> = {}) => withMarket(mkPick({ modelProb: 0.66, oppFactor: 1.08, ...o }), 2.0, 2.0)
/** A Safe Sam candidate: a market favourite the model likes a little more. */
const samPick = (o: Partial<Pick> = {}) => withMarket(mkPick({ modelProb: 0.76, ...o }), 1.55, 2.5)
/** A Contrarian Cat candidate: the market rates the side under 50%, the model clearly higher, the matchup says why. */
const catPick = (o: Partial<Pick> = {}) => withMarket(mkPick({ modelProb: 0.54, oppFactor: 1.08, ...o }), 2.3, 1.7)

test('fixtures behave as the tests assume (so a drift in the maths fails here, not mysteriously below)', () => {
  const c = makeConfig()
  const v = recordOf(valPick()), s = recordOf(samPick()), k = recordOf(catPick())
  assert.ok(v.status === 'ELIGIBLE' && meetsVal(v, c), JSON.stringify(v.eligibility))
  assert.ok(s.status === 'ELIGIBLE' && meetsSam(s, c), `sam ${s.probability.conservative} ${s.ev.conservative} ${JSON.stringify(s.eligibility)}`)
  assert.ok(k.status === 'ELIGIBLE' && meetsCat(k, c), `cat ${k.probability.marketFair} ${k.ev.conservative} ${JSON.stringify(k.eligibility)}`)
  assert.ok(!meetsVal(k, c) && !meetsSam(v, c))
})

// ------------------------------------------------------------------ no quotas, fail closed

test('no quotas: a slate with nothing worth betting returns nothing, and an empty slate is fine', () => {
  const dull = Array.from({ length: 40 }, () => mkPick({ modelProb: 0.5 }))
  const d = run(dull)
  assert.equal(d.approved.length, 0)
  assert.equal(d.research.filter((b) => b.kind === 'combo').length, 0)
  const e = run([])
  assert.deepEqual([e.approved.length, e.leans.length, e.research.length, e.volume.length, e.rejected.length], [0, 0, 0, 0, 0])
  assert.equal(e.stats.picks, 0)
})

test('fail closed: no calibration artifact, no injury check, or no quote detail means no approval at all', () => {
  const picks = [valPick(), samPick(), catPick()]
  assert.equal(run(picks).approved.length >= 2, true, 'with everything present they are approved')
  const noCal = run(picks, { calibration: null })
  assert.equal(noCal.approved.length, 0)
  assert.equal(noCal.leans.length, 0)
  assert.ok(noCal.candidates.every((r) => r.probability.conservative === null && r.status !== 'ELIGIBLE'))
  assert.equal(run(picks, { injuryChecked: false }).approved.length, 0)
  const bare = picks.map((p) => { const q = { ...p } as Pick; delete (q as { bookQuotes?: unknown }).bookQuotes; delete (q as { sideQuotes?: unknown }).sideQuotes; return q })
  assert.equal(run(bare).approved.length, 0)
  const stalePicks = [valPick(), samPick()].map((p) => ({ ...p, projectionAgeHours: 30 }))
  assert.equal(run(stalePicks).approved.length, 0)
})

// ------------------------------------------------------------------ specialists and the Chief

test('each specialist approves its own kind of bet, from the engine record, with the full reasoning attached', () => {
  const d = run([valPick(), samPick(), catPick()])
  assert.equal(d.approved.length, 3)
  for (const b of d.approved) {
    assert.equal(b.tier, 'strict'); assert.equal(b.label, 'STRICT'); assert.equal(b.stake, 1); assert.equal(b.research, false); assert.equal(b.experimental, false)
    assert.ok(b.evCons < b.ev && b.pCons < b.prob, 'the conservative numbers are below the decision numbers')
    assert.equal(b.rationale.length, 5)
    assert.match(b.rationale.join(' '), /Proposed by.*Quant.*Market.*Matchup.*Skeptic/s)
    near(b.odds, b.legPrices[0]); near(b.ev, b.records[0].ev.raw!); near(b.evCons, b.records[0].ev.conservative!)
  }
  const proposers = d.approved.flatMap((b) => b.proposedBy)
  assert.deepEqual([...new Set(proposers)].sort(), ['cat', 'sam', 'val'])
  assert.deepEqual(d.run, { version: MINDS_VERSION, configHash: d.run.configHash, calibrationVersion: 'test', calibrationHash: 'testhash', now: NOW })
})

test('the Chief recomputes thresholds exactly: at the threshold qualifies, one part in a trillion below does not', () => {
  const p = valPick()
  const r = recordOf(p)
  const e = r.ev.conservative!, pc = r.probability.conservative!
  const at = (cfg: object) => run([p], { config: makeConfig(cfg) }).approved.length
  assert.equal(at({ val: { minEvConservative: e } }), 1, 'exactly +x% qualifies')
  assert.equal(at({ val: { minEvConservative: e * (1 + 1e-12) } }), 0, 'a hair above does not')
  assert.equal(at({ val: { minProbability: pc } }), 1)
  assert.equal(at({ val: { minProbability: pc * (1 + 1e-12) } }), 0)
  const s = samPick(), sr = recordOf(s)
  const atS = (cfg: object) => run([s], { config: makeConfig(cfg) }).approved.some((b) => b.proposedBy.includes('sam'))
  assert.equal(atS({ sam: { minProbability: sr.probability.conservative! } }), true)
  assert.equal(atS({ sam: { minProbability: sr.probability.conservative! * (1 + 1e-12) } }), false)
  assert.equal(atS({ sam: { minEvConservative: sr.ev.conservative! * (1 + 1e-12) } }), false)
  const k = catPick(), kr = recordOf(k)
  const gap = kr.probability.calibration.calibrated! - kr.probability.marketFair!
  const atK = (cfg: object) => run([k], { config: makeConfig(cfg) }).approved.some((b) => b.proposedBy.includes('cat'))
  assert.equal(atK({ cat: { minGap: gap } }), true)
  assert.equal(atK({ cat: { minGap: gap * (1 + 1e-12) } }), false)
  assert.equal(atK({ cat: { minEvConservative: kr.ev.conservative! * (1 + 1e-12) } }), false)
})

test('a value that displays as the threshold but is below it is not approved', () => {
  const r = recordOf(valPick())
  const e = r.ev.conservative!
  const shown = e.toFixed(3)                                       // what a UI would print
  const cfgJustAbove = makeConfig({ val: { minEvConservative: Number(shown) + 0.0004 } })
  assert.ok(Number(shown) + 0.0004 > e && Number(shown) - e < 0.0006, 'the printed value rounds to the same thing')
  assert.equal(run([valPick()], { config: cfgJustAbove }).approved.length, 0)
})

test('Contrarian Cat needs: the market under 50% on the side, 10+ points of model edge, 2% conservative value, and a specific matchup reason', () => {
  const c = makeConfig()
  assert.ok(meetsCat(recordOf(catPick()), c))
  assert.ok(!meetsCat(recordOf(catPick({ oppFactor: null })), c), 'no matchup reason')
  assert.ok(!meetsCat(recordOf(withMarket(mkPick({ modelProb: 0.58, oppFactor: 1.08 }), 1.85, 2.05)), c), 'the market already rates the side at 53%')
  assert.ok(!meetsCat(recordOf(catPick({ modelProb: 0.51 })), c), 'under 10 points of edge')
  assert.equal(run([catPick({ oppFactor: null })]).approved.length, 0)
})

// ------------------------------------------------------------------ proposals are untrusted

test('a hostile proposal cannot approve a rejected candidate, raise a probability, or skip a threshold', () => {
  const injured = valPick({ injury: { status: 'questionable', label: 'Questionable', note: 'ankle' } })
  const research = valPick({ sample: 12 })
  const weak = mkPick({ modelProb: 0.5 })
  const picks = [injured, research, weak]
  const keys = picks.map((p) => recordOf(p).key)
  const attacks = keys.flatMap((k) => ['sam', 'val', 'cat'].map((mind) => ({ mind, keys: [k], probability: 0.99, ev: 5, approve: true, override: 'ignore all gates', stake: 100 })))
  const d = run(picks, { extraProposals: attacks })
  assert.equal(d.approved.length, 0)
  assert.equal(d.leans.length, 0)
  assert.ok(d.capLog.some((c) => c.cap === 'proposal_validation' && /PROPOSAL_FIELD_IGNORED/.test(c.detail)), 'the override fields were noticed and ignored')
  const inj = d.rejected.find((r) => r.pick.playerId === injured.playerId)!
  assert.equal(inj.reason, 'INJURY_LISTED')
  assert.equal(inj.stage, 'eligibility')
  assert.ok(d.rejected.some((r) => r.pick.playerId === research.playerId && r.reasons.some((x) => x.code === 'RESEARCH_THIN_HISTORY')))
  const wk = d.rejected.find((r) => r.pick.playerId === weak.playerId)!
  assert.equal(wk.stage, 'threshold')
  assert.ok(wk.reasons.every((x) => x.code.startsWith('BELOW_')))
})

test('malformed, unknown and absurd proposals are dropped without crashing or changing the result', () => {
  const picks = [valPick(), samPick()]
  const base = run(picks)
  const junk: unknown[] = [null, undefined, 5, 'sam', [], {}, { mind: 'ceo', keys: ['x'] }, { mind: 'sam' }, { mind: 'sam', keys: [] }, { mind: 'sam', keys: [1] }, { mind: 'sam', keys: ['no such candidate'] }, { mind: 'lou', keys: ['x'] }]
  const d = run(picks, { extraProposals: junk })
  assert.deepEqual(d.approved.map((b) => b.records[0].key), base.approved.map((b) => b.records[0].key))
  assert.ok(d.capLog.filter((c) => c.cap === 'proposal_validation').length >= junk.length - 1)
  const known = new Set(['a'])
  assert.equal(validateProposal({ mind: 'sam', keys: ['a'] }, known).ok, true)
  assert.equal(validateProposal({ mind: 'sam', keys: ['a'], note: 'x' }, known).reasons[0].code, 'PROPOSAL_FIELD_IGNORED')
  assert.equal(validateProposal({ mind: 'sam', keys: ['b'] }, known).reasons.at(-1)!.code, 'UNKNOWN_CANDIDATE')
})

test('a proposal cannot lower a specialist threshold below what the engine says', () => {
  const p = mkPick({ modelProb: 0.6 })                              // decent, but not a Value Val bet
  const k = recordOf(p).key
  const d = run([p], { extraProposals: [{ mind: 'val', keys: [k] }, { mind: 'sam', keys: [k] }, { mind: 'cat', keys: [k] }] })
  assert.equal(d.approved.length, 0)
  assert.deepEqual(d.rejected.find((r) => r.stage === 'threshold')!.reasons.map((x) => x.code).sort(), ['BELOW_CAT_THRESHOLD', 'BELOW_SAM_THRESHOLD', 'BELOW_VAL_THRESHOLD'])
})

// ------------------------------------------------------------------ portfolio

test('portfolio: one bet per player and stat, two per player, four per game, twelve a day, and a cap only removes', () => {
  resetFixtureCounter()
  const star = Array.from({ length: 3 }, (_, i) => valPick({ playerId: 5, player: 'Star', eventId: 'G1', stat: (['pts', 'reb', 'ast'] as const)[i], line: 10.5 + i, role: { label: 'Starter', min10: 38, trend: 0, games: 60 } }))
  const d1 = run(star)
  assert.ok(d1.approved.length <= 2)
  assert.ok(d1.rejected.some((r) => r.reason === 'PLAYER_CAP'))
  assert.ok(d1.capLog.some((c) => c.cap === 'maxStrictPerPlayer'))
  const sameStat = [valPick({ playerId: 6, player: 'Dup', eventId: 'G2', stat: 'pts', line: 10.5 }), valPick({ playerId: 6, player: 'Dup', eventId: 'G2', stat: 'pts', line: 11.5, modelProb: 0.665 })]
  const d2 = run(sameStat)
  assert.equal(d2.approved.length, 1)
  assert.ok(d2.rejected.some((r) => r.reason === 'PLAYER_STAT_CAP'))
  const oneGame = Array.from({ length: 6 }, (_, i) => valPick({ eventId: 'G7', role: { label: 'Starter', min10: 36 - i * 0.5, trend: 0, games: 60 } }))
  const d3 = run(oneGame)
  assert.equal(d3.approved.length, 4)
  assert.equal(d3.rejected.filter((r) => r.reason === 'GAME_CAP').length, 2)
  const many = Array.from({ length: 20 }, (_, i) => valPick({ eventId: `D${i}` }))
  const d4 = run(many)
  assert.equal(d4.approved.length, 12)
  assert.equal(d4.rejected.filter((r) => r.reason === 'DAILY_CAP').length, 8)
  assert.ok(d4.candidates.length >= 20)
})

test('portfolio: Unders are at most 65% once there are six or more, and the cap applies to strict bets only', () => {
  const unders = Array.from({ length: 12 }, (_, i) => valPick({ side: 'under', oppFactor: 0.92, eventId: `U${i}` }))
  assert.equal(run(unders).approved.length, 5, 'the sixth all-Under strict bet would be 100% Unders')
  const mixed = [...unders, ...Array.from({ length: 6 }, (_, i) => valPick({ side: 'over', eventId: `O${i}` }))]
  const d = run(mixed)
  const share = d.approved.filter((b) => b.legs[0].side === 'under').length / d.approved.length
  assert.ok(share <= 0.65 + 1 / d.approved.length, `under share ${share}`)
  assert.ok(d.approved.some((b) => b.legs[0].side === 'over'))
})

test('exposure is tracked by player, game, team, market and side', () => {
  const d = run([valPick({ eventId: 'E1', stat: 'pts' }), valPick({ eventId: 'E1', stat: 'reb' }), valPick({ eventId: 'E2', stat: 'pts', side: 'under', oppFactor: 0.92 })])
  const e = exposureOf(d.approved)
  assert.equal(Object.values(e.byGame).reduce((a, b) => a + b, 0), d.approved.length)
  assert.equal(e.byTeam.BOS, d.approved.length)
  assert.equal(e.byMarket.pts, 2)
  assert.equal(e.bySide.under, 1)
  assert.deepEqual(d.exposure, e)
})

test('every cap is validated: the stricter rule must win', () => {
  assert.throws(() => makeConfig({ portfolio: { maxStrictPerPlayerStat: 3, maxStrictPerPlayer: 2 } }), RangeError)
  assert.throws(() => makeConfig({ portfolio: { maxStrictPerDay: 0 } }), RangeError)
})

// ------------------------------------------------------------------ leans: a shadow portfolio

const leanPick = (o: Partial<Pick> = {}) => mkPick({ modelProb: 0.58, ...o })          // a modest edge: raw value positive, conservative value is not

test('leans fail strict approval ONLY because of the conservative threshold, and are labelled SHADOW_ONLY', () => {
  const p = leanPick()
  const r = recordOf(p)
  assert.ok(r.ev.raw! >= 0.02 && r.probability.decision! >= 0.5 && r.ev.conservative! < 0.03, `raw ${r.ev.raw} cons ${r.ev.conservative}`)
  const d = run([p])
  assert.equal(d.approved.length, 0)
  assert.equal(d.leans.length, 1)
  const l = d.leans[0]
  assert.equal(l.tier, 'lean'); assert.equal(l.label, 'SHADOW_ONLY'); assert.equal(l.research, true); assert.equal(l.stake, 0.5)
  assert.match(l.rationale[0], /^SHADOW_ONLY/)
  assert.ok(l.ev >= 0.02 && l.evCons < l.ev)
})

test('a candidate with any hard problem is never a lean, whatever its raw value', () => {
  for (const o of [{ injury: { status: 'questionable' as const, label: 'Questionable', note: '' } }, { projectionAgeHours: 30 }, { identity: 'unverified' as const }, { sample: 9 }, { side: 'under' as const, line: 6.5, recent: [12, 6, 9, 10, 10, 11, 5, 9, 13, 9] }]) {
    const d = run([leanPick(o as Partial<Pick>)])
    assert.equal(d.leans.length, 0, JSON.stringify(Object.keys(o)))
  }
  assert.equal(run([leanPick()], { injuryChecked: false }).leans.length, 0)
})

test('a lean needs raw value of +2% and a 50% chance: below either, it is only a watchlist line', () => {
  const thin = withMarket(mkPick({ modelProb: 0.53 }), 1.95, 1.95)
  const r = recordOf(thin)
  assert.ok(r.ev.raw! < 0.02, `raw ${r.ev.raw}`)
  assert.equal(run([thin]).leans.length, 0)
  const longshot = withMarket(mkPick({ modelProb: 0.5 }), 2.8, 1.45)
  assert.equal(run([longshot]).leans.length, 0)
})

test('leans are never strict bets in disguise: a strict bet on a player rules out a lean on him, and caps never create one', () => {
  const player = { playerId: 77, player: 'Both' }
  const strict = valPick({ ...player, eventId: 'LB', stat: 'pts', line: 10.5 })
  const lean = leanPick({ ...player, eventId: 'LB', stat: 'reb', line: 4.5 })
  const d = run([strict, lean])
  assert.equal(d.approved.length, 1)
  assert.equal(d.leans.length, 0)
  const capped = Array.from({ length: 6 }, (_, i) => valPick({ eventId: 'GC', role: { label: 'Starter', min10: 36 - i * 0.5, trend: 0, games: 60 } }))
  const dc = run(capped)
  assert.equal(dc.approved.length, 4)
  assert.equal(dc.leans.length, 0, 'the two the game cap removed are not leans')
})

test('leans: one per player and at most eight a day', () => {
  const many = Array.from({ length: 20 }, (_, i) => leanPick({ eventId: `L${i}` }))
  const d = run(many)
  assert.equal(d.leans.length, 8)
  assert.ok(d.capLog.some((c) => c.cap === 'lean.maxPerDay'))
  const oneStar = Array.from({ length: 3 }, (_, i) => leanPick({ playerId: 55, player: 'Solo', eventId: 'LS', stat: (['pts', 'reb', 'ast'] as const)[i], line: 5.5 + i }))
  assert.equal(run(oneStar).leans.length, 1)
})

// ------------------------------------------------------------------ research-only

test('thin history (10 to 14 games) and unvalidated calibration are research-only, never strict, never leans', () => {
  const thin = valPick({ sample: 12 })
  const d = run([thin])
  assert.equal(d.approved.length, 0); assert.equal(d.leans.length, 0)
  assert.equal(d.research.length, 1)
  assert.equal(d.research[0].tier, 'research'); assert.equal(d.research[0].label, 'RESEARCH_ONLY'); assert.match(d.research[0].rationale[0], /RESEARCH_THIN_HISTORY/)
  const bad = run([valPick()], { calibration: identityArtifact({ status: 'unvalidated' }) })
  assert.equal(bad.approved.length, 0)
  assert.equal(bad.research.length, 1)
  assert.match(bad.research[0].rationale[0], /CALIBRATION_UNVALIDATED/)
  const mixed = run([valPick({ stat: 'pts' }), valPick({ stat: 'reb' })], { calibration: identityArtifact({ stats: ['pts', 'reb'] }) })
  assert.equal(mixed.approved.length, 2)
})

test('parlays: RESEARCH_ONLY and experimental, distinct games, qualified legs only, never staked, never "approved"', () => {
  const legs = ['A', 'B', 'C', 'D'].map((g) => valPick({ eventId: g, modelProb: 0.66 }))
  const d = run(legs, { config: makeConfig({ lou: { minParlayEv: 0.05 } }) })
  const p = d.research.find((b) => b.kind === 'combo')
  assert.ok(p, 'a parlay is built from the legs that qualify')
  assert.equal(p!.tier, 'research'); assert.equal(p!.label, 'RESEARCH_ONLY'); assert.equal(p!.experimental, true); assert.equal(p!.research, true)
  assert.ok(p!.legs.length >= 3 && p!.legs.length <= 5)
  assert.equal(new Set(p!.legs.map((l) => l.eventId)).size, p!.legs.length)
  near(p!.pCons, p!.records.reduce((a, r) => a * r.probability.conservative!, 1))
  near(p!.odds, p!.legPrices.reduce((a, x) => a * x, 1))
  assert.match(p!.rationale.join(' '), /EXPERIMENTAL independence baseline[\s\S]*not validated/)
  assert.ok(d.approved.every((b) => b.kind === 'single'))
  assert.ok(d.leans.every((b) => b.kind === 'single'))
})

test('parlays: same-game legs, weak legs, whole-number lines and a thin product are all refused; at most 3, never topped up', () => {
  const sameGame = Array.from({ length: 6 }, (_, i) => valPick({ eventId: 'ONE', role: { label: 'Starter', min10: 36 - i * 0.5, trend: 0, games: 60 } }))
  assert.equal(run(sameGame).research.filter((b) => b.kind === 'combo').length, 0)
  const weak = ['A', 'B', 'C'].map((g) => mkPick({ eventId: g, modelProb: 0.55 }))
  assert.equal(run(weak).research.filter((b) => b.kind === 'combo').length, 0)
  const refund = ['A', 'B', 'C'].map((g) => valPick({ eventId: g, push: 0.1 }))
  assert.equal(run(refund).research.filter((b) => b.kind === 'combo').length, 0, 'whole-number lines are left out')
  const strong = ['A', 'B', 'C'].map((g) => valPick({ eventId: g }))
  assert.equal(run(strong, { config: makeConfig({ lou: { minParlayEv: 5 } }) }).research.filter((b) => b.kind === 'combo').length, 0, 'the product must clear the floor')
  const many = Array.from({ length: 30 }, (_, i) => valPick({ eventId: `G${i}` }))
  const d = run(many, { config: makeConfig({ lou: { minParlayEv: 0.05 } }) })
  const parlays = d.research.filter((b) => b.kind === 'combo')
  assert.ok(parlays.length >= 1 && parlays.length <= 3)
  const used = parlays.flatMap((b) => b.records.map((r) => r.key))
  assert.equal(new Set(used).size, used.length)
  assert.equal(run(many.slice(0, 2)).research.filter((b) => b.kind === 'combo').length, 0)
})

// ------------------------------------------------------------------ the audit trail

test('every record that reached the evidence stage is kept, rejected ones included, with structured reasons', () => {
  const picks = [valPick(), valPick({ injury: { status: 'out', label: 'Out', note: '' } }), mkPick({ team: null }), mkPick({ model: 'baseline-v2' as never })]
  const d = run(picks)
  assert.equal(d.stats.picks, 4)
  assert.equal(d.stats.evaluated, 2)
  assert.equal(d.stats.byStatus.NOT_EVALUATED, 2)
  assert.equal(d.candidates.length, 2)
  assert.equal(d.stats.byStatus.REJECTED, 1)
  assert.ok(d.candidates.every((r) => r.eligibility && r.probability && r.price && r.ev && r.status))
  assert.equal(d.stats.byReason.INJURY_LISTED, 1)
  assert.ok(d.rejected.every((r) => r.reasons.length > 0 && typeof r.reasons[0].code === 'string' && r.detail.length > 0))
})

test('the same inputs always give the same decision, and inputs are never mutated', () => {
  const picks = [valPick(), samPick(), catPick(), leanPick(), valPick({ sample: 12 })]
  const before = JSON.stringify(picks)
  const a = run(picks), b = run(picks)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  assert.equal(JSON.stringify(picks), before)
})

// ------------------------------------------------------------------ paper volume board

const vpick = (o: Partial<Pick> = {}) => mkPick({ marketBooks: 1, bookQuotes: undefined, sideQuotes: undefined, ...o })

test('volume board: paper only, up to 3 lines per player and statistic, best 40 per game, main-line prices only, no market needed', () => {
  const cfg = makeConfig()
  const ladder = Array.from({ length: 10 }, (_, i) => (['pts', 'reb', 'ast', 'fg3m'] as const).flatMap((stat) => Array.from({ length: 5 }, (_, k) =>
    vpick({ eventId: 'V1', team: 'BOS', stat, line: 5.5 + k, modelProb: 0.5 + 0.01 * k, price: 1.9, role: { label: 'Starter', min10: 36 - i, trend: 0, games: 60 }, playerId: 8000 + i, player: `V${i}`, game: 'Boston Celtics @ Detroit Pistons' })))).flat()
  const v = volumeBoard(ladder, cfg, identityArtifact(), NOW)
  assert.equal(v.bets.length, 40)
  assert.ok(v.bets.every((b) => b.tier === 'volume' && b.label === 'PAPER_VOLUME' && b.research && b.experimental))
  assert.deepEqual(v.bets.map((b) => b.ev), [...v.bets.map((b) => b.ev)].sort((a, b) => b - a))
  const perStat = new Map<string, number>()
  for (const b of v.bets) perStat.set(`${b.legs[0].playerId}|${b.legs[0].stat}`, (perStat.get(`${b.legs[0].playerId}|${b.legs[0].stat}`) ?? 0) + 1)
  assert.ok([...perStat.values()].every((n) => n <= 3))
  const odd = [vpick({ eventId: 'V2', price: 9, stat: 'pts' }), vpick({ eventId: 'V2', price: 31, stat: 'reb' }), vpick({ eventId: 'V2', price: 1.2, stat: 'ast' })]
  assert.equal(volumeBoard(odd, cfg, identityArtifact(), NOW).bets.length, 0, 'far alternates and stale quotes never appear')
  assert.equal(volumeBoard([vpick({ injury: { status: 'out', label: 'Out', note: '' } }), vpick({ projectionAgeHours: 30 }), vpick({ role: { label: 'Bench', min10: 17, trend: 0, games: 40 } })], cfg, identityArtifact(), NOW).bets.length, 0)
  assert.equal(run([vpick(), valPick()]).volume.length >= 1, true)
  assert.ok(run([valPick()]).approved.every((b) => b.tier === 'strict'), 'the board never touches the strict tier')
})

test('opponent tendency attaches by team, in both directions, and is null when unknown', () => {
  const table = { DET: { pts: 1.06 }, BOS: { pts: 0.97 } }
  assert.equal(attachOpponent([mkPick({ teamName: 'Boston Celtics', stat: 'pts' })], table)[0].oppFactor, 1.06)
  assert.equal(attachOpponent([mkPick({ teamName: 'Detroit Pistons', stat: 'pts' })], table)[0].oppFactor, 0.97)
  assert.equal(attachOpponent([mkPick({ teamName: 'Boston Celtics', stat: 'blk' as never })], table)[0].oppFactor, null)
  assert.equal(attachOpponent([mkPick({ teamName: null })], table)[0].oppFactor, null)
})
