// The minds, version 5 (version 4 plus a small-stake tier of leans): four candidate-generating personalities, four evidence agents, and one strict Chief.
// Pure and deterministic: every probability and price is calculated here in code; nothing is voted on.
// Rules, evidence for each threshold, and what is NOT validated: research/PREREG_MINDS_V4.md and PREREG_MINDS_V5.md.
// Frozen after the first v5 decision. A change is minds-v6.
import { TEAM_NAMES, type Pick } from './picks.ts'
import { blendProb, expectedValue } from './baseline.ts'

export const MINDS_VERSION = 'minds-v5'

export const CHIEF = {
  // ---- eligibility: data complete, fresh, and a starter or star
  minMarketBooks: 2,
  minSample: 10,
  minRoleMinutes: 24,
  starterTopN: 6,
  maxProjectionAgeHours: 24,

  // ---- Quant: conservative probability = blended probability minus haircutZ standard errors
  haircutZ: 0.5,
  minEffectiveGames: 10,
  maxEffectiveGames: 40,
  /** Held-out calibration slopes of the boosted model (research/RESULTS.md): a model "70%" behaves like 50 + slope * 20. */
  calibrationSlope: { pts: 0.851, reb: 0.889, ast: 0.919, fg3m: 0.866 } as Record<string, number>,
  defaultCalibrationSlope: 0.85,

  // ---- Market: executable price, and what the other books say
  /** The price we may count is capped at this multiple of the second-best book, so one stale quote cannot manufacture an edge. */
  priceCorroboration: 1.03,
  /** Best price this far above the runner-up looks stale. */
  staleLineRatio: 1.15,
  /** The executable price must not be rich against the market's own fair price by more than this. */
  minMarketEv: -0.05,

  // ---- Matchup: corroborates or contradicts; it never adds probability (the model already sees opponent and pace)
  minutesTrendEdge: 2,
  opponentEdge: 0.04,

  // ---- Skeptic
  minSampleStrict: 15,
  minutesDropVeto: -4,
  /** Model/market gaps this big are rejected: no independent validated data exists to resolve them. */
  maxGap: 0.25,
  /** From here a gap needs matchup corroboration before the Chief will consider the bet. */
  reviewGap: 0.15,
  formMinGames: 8,
  formContradictionSd: 0.5,

  // ---- Candidate generators
  sam: { minProb: 0.6, minEvCons: 0 },
  val: { minProb: 0.5, minEvCons: 0.03 },
  cat: { minGap: 0.1, maxMarketProb: 0.5, minEvCons: 0.02, minMatchup: 1 },
  lou: { minLegEvCons: 0.02, minLegPCons: 0.45, minLegs: 3, maxLegs: 5, minEvCons: 0.1, maxParlays: 3 },

  // ---- Portfolio: caps, never quotas
  maxBetsPerPlayer: 2,
  maxBetsPerGame: 4,
  maxUnderShare: 0.65,
  underShareFrom: 6,
  maxDailyBets: 12,
  /** How many near misses (raw edge, removed by the haircut) are recorded per day. */
  maxNearMisses: 60,
  /** The closest eligible picks that did not qualify, recorded on every day (including no-bet days) so there is always something to read and grade. Never bets. */
  maxWatchlist: 25,

  // ---- Leans: a second, clearly lesser tier. The model sees an edge that does not survive the uncertainty haircut.
  // Point estimates, not conservative ones, so these are exactly the bets the strict tier turns down. Small stake, tracked apart.
  lean: { minEvHat: 0.02, minProb: 0.5, stake: 0.5, maxPerDay: 8 },
} as const

export type MindId = 'sam' | 'val' | 'lou' | 'cat'
export const MIND_IDS: readonly MindId[] = ['sam', 'val', 'lou', 'cat']
export const MIND_NAMES: Record<MindId, string> = {
  sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat',
}

// ---------------------------------------------------------------------------------------------------------------
// Evidence

export interface QuantView {
  modelCal: number
  pBlend: number
  nEff: number
  se: number
  pCons: number
  /** Expected profit per unit at the executable price, using the blended (not conservative) probability. */
  evHat: number
  /** The same, using the conservative probability. This is the number every threshold uses. */
  evCons: number
}
export interface MarketView {
  execPrice: number
  bestPrice: number
  corroboratedBy: string | null
  consensus: number | null
  /** Expected profit if the market's own no-margin probability were the truth: how rich the price is. */
  marketEv: number
  vetoes: string[]
  lineMovement: 'unavailable'
}
export interface MatchupView { score: number; notes: string[] }
export interface SkepticView { vetoes: string[]; flags: string[]; notes: string[] }
export interface Evidence { pick: Pick; quant: QuantView; market: MarketView; matchup: MatchupView; skeptic: SkepticView }

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) }
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
export const legKey = (p: Pick) => `${p.playerId}|${p.stat}|${p.line}|${p.side}`
const groupKey = (p: Pick) => `${p.eventId}|${p.team}`

/** Why a pick is not even considered. Anything here is a data problem, not a judgement about the bet. */
export function ineligibleReason(p: Pick): string | null {
  const c = CHIEF
  if (p.team == null) return 'no_team'
  if (p.model !== 'gbm-v1') return 'no_fresh_projection'
  if (p.projectionAgeHours == null || p.projectionAgeHours > c.maxProjectionAgeHours) return 'stale_projection'
  if (!Number.isFinite(p.modelProb) || !Number.isFinite(p.price) || p.price <= 1) return 'bad_numbers'
  if (p.marketProb == null || !Number.isFinite(p.marketProb)) return 'no_market'
  if (p.marketBooks < c.minMarketBooks) return 'too_few_books'
  if (p.sample < c.minSample) return 'thin_history'
  if (p.role == null) return 'no_minutes'
  if (p.role.min10 < c.minRoleMinutes) return 'not_a_starter_or_star'
  return null
}

/** The price we may count: the best, but never more than 3% above the runner-up (a lone outlier is probably stale). */
export function executablePrice(p: Pick): { execPrice: number; corroboratedBy: string | null } {
  const prices = [...p.prices].sort((a, b) => b.price - a.price)
  const best = prices[0]?.price ?? p.price
  if (prices.length < 2) return { execPrice: best, corroboratedBy: null }
  return { execPrice: Math.min(best, prices[1].price * CHIEF.priceCorroboration), corroboratedBy: prices[1].book }
}

export function quant(p: Pick, execPrice: number): QuantView {
  const c = CHIEF
  const slope = c.calibrationSlope[p.stat] ?? c.defaultCalibrationSlope
  const modelCal = clamp(0.5 + slope * (p.modelProb - 0.5), 0, 1)
  const pBlend = blendProb(modelCal, p.marketProb)
  const nEff = clamp(p.sample, c.minEffectiveGames, c.maxEffectiveGames)
  const se = Math.sqrt((pBlend * (1 - pBlend)) / nEff)
  const pCons = clamp(pBlend - c.haircutZ * se, 0, 1)
  return { modelCal, pBlend, nEff, se, pCons, evHat: expectedValue(pBlend, p.push, execPrice), evCons: expectedValue(pCons, p.push, execPrice) }
}

export function market(p: Pick, execPrice: number, corroboratedBy: string | null): MarketView {
  const c = CHIEF
  const prices = [...p.prices].sort((a, b) => b.price - a.price)
  const vetoes: string[] = []
  if (prices.length < 2) vetoes.push('single_price')
  else if (prices[0].price > prices[1].price * c.staleLineRatio) vetoes.push('stale_line')
  const marketEv = p.marketProb == null ? -1 : expectedValue(p.marketProb, p.push, execPrice)
  if (marketEv < c.minMarketEv) vetoes.push('rich_price')
  return { execPrice, bestPrice: prices[0]?.price ?? p.price, corroboratedBy, consensus: p.marketProb, marketEv, vetoes, lineMovement: 'unavailable' }
}

export function matchup(p: Pick): MatchupView {
  const c = CHIEF
  const dir = p.side === 'over' ? 1 : -1
  let score = 0
  const notes: string[] = []
  const t = p.role?.trend ?? null
  if (t != null && Math.abs(t) >= c.minutesTrendEdge) {
    const s = Math.sign(t) * dir
    score += s
    notes.push(`minutes ${t > 0 ? 'up' : 'down'} ${Math.abs(t).toFixed(1)} lately, which ${s > 0 ? 'supports' : 'works against'} the ${p.side}`)
  } else notes.push('minutes steady')
  const f = p.oppFactor ?? null
  if (f != null && Math.abs(f - 1) >= c.opponentEdge) {
    const s = Math.sign(f - 1) * dir
    score += s
    notes.push(`opponent allows ${pct(Math.abs(f - 1))} ${f > 1 ? 'more' : 'less'} than average, which ${s > 0 ? 'supports' : 'works against'} the ${p.side}`)
  } else if (f != null) notes.push('opponent about average for this stat')
  else notes.push('opponent tendency unavailable')
  return { score, notes }
}

export function skeptic(p: Pick): SkepticView {
  const c = CHIEF
  const vetoes: string[] = [], flags: string[] = [], notes: string[] = []
  if (p.injury) { vetoes.push('injury_listed'); notes.push(`listed ${p.injury.label}`) }
  if (p.sample < c.minSampleStrict) { vetoes.push('thin_history'); notes.push(`only ${p.sample} games of history`) }
  if (p.role?.trend != null && p.role.trend <= c.minutesDropVeto) { vetoes.push('minutes_dropping'); notes.push(`minutes down ${Math.abs(p.role.trend).toFixed(1)} lately`) }
  const gap = p.marketProb == null ? 0 : Math.abs(p.modelProb - p.marketProb)
  if (gap >= c.maxGap) { vetoes.push('extreme_gap'); notes.push(`model and market ${pct(gap)} apart: usually news the model cannot see`) }
  else if (gap >= c.reviewGap) { flags.push('review_gap'); notes.push(`model and market ${pct(gap)} apart: needs corroboration`) }
  if (p.recent.length >= c.formMinGames) {
    const m = mean(p.recent), s = Math.max(sd(p.recent), 0.5)
    const against = p.side === 'under' ? m > p.line + c.formContradictionSd * s : m < p.line - c.formContradictionSd * s
    if (against) { vetoes.push('form_contradiction'); notes.push(`recent games average ${m.toFixed(1)} against a ${p.side} ${p.line}`) }
  }
  if (p.push > 0.08) flags.push('push_risk')
  return { vetoes, flags, notes }
}

export function buildEvidence(p: Pick): Evidence {
  const { execPrice, corroboratedBy } = executablePrice(p)
  return { pick: p, quant: quant(p, execPrice), market: market(p, execPrice, corroboratedBy), matchup: matchup(p), skeptic: skeptic(p) }
}

/** Fill in how generous the opponent is, from a team -> stat -> (allowed / league average) table. */
export function attachOpponent<P extends Pick>(picks: P[], table: Record<string, Record<string, number>>): P[] {
  const byName = new Map(Object.entries(TEAM_NAMES).map(([abbr, name]) => [name, abbr]))
  return picks.map((p) => {
    const [away, home] = p.game.split(' @ ')
    const oppName = p.teamName === away ? home : p.teamName === home ? away : null
    const opp = oppName ? byName.get(oppName) : undefined
    return { ...p, oppFactor: opp ? table[opp]?.[p.stat] ?? null : null }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Decisions

export interface Bet {
  /** The personality that proposed it first; `proposedBy` lists every one that did. */
  mind: MindId
  proposedBy: MindId[]
  kind: 'single' | 'combo'
  legs: Pick[]
  /** Executable price per leg, in leg order: the price the bet is graded at. */
  legPrices: number[]
  legEvidence: Evidence[]
  odds: number
  /** Win chance at the blended probability (what the bet "says"). */
  prob: number
  /** Win chance at the conservative probability. */
  pCons: number
  ev: number
  evCons: number
  /** Parlays are research-only: tracked and graded, but not part of the staked portfolio. */
  research: boolean
  /** strict: the Chief's staked bets. lean: a smaller stake on a weaker edge. research: parlays, never staked. */
  tier: 'strict' | 'lean' | 'research'
  /** Suggested stake in units. */
  stake: number
  rationale: string[]
}
export interface Rejection {
  proposedBy: MindId[]
  pick: Pick
  reason: string
  detail: string
  pCons: number
  evCons: number
}
export interface Decision {
  approved: Bet[]
  /** Smaller-stake bets on edges too weak for the strict tier. Tracked and graded separately. */
  leans: Bet[]
  research: Bet[]
  rejected: Rejection[]
  stats: { picks: number; eligible: number; ineligible: Record<string, number>; candidates: number; approved: number; leans: number; research: number; rejected: number }
}

/** What the Chief checks after the proposer's own thresholds. First failure wins. */
function chiefCheck(e: Evidence): { reason: string; detail: string } | null {
  if (e.skeptic.vetoes.length) return { reason: e.skeptic.vetoes[0], detail: e.skeptic.notes.join('; ') || e.skeptic.vetoes[0] }
  if (e.market.vetoes.length) {
    const v = e.market.vetoes[0]
    return { reason: v, detail: v === 'rich_price' ? `price is ${pct(-e.market.marketEv, 1)} below the market's fair price` : v === 'stale_line' ? 'the best price is far above every other book: likely stale' : 'only one book offers this price' }
  }
  if (e.matchup.score < 0) return { reason: 'matchup_contradicted', detail: e.matchup.notes.join('; ') }
  if (e.skeptic.flags.includes('review_gap') && e.matchup.score < 1) return { reason: 'unresolved_review', detail: `${e.skeptic.notes.join('; ')}; the matchup does not corroborate it` }
  return null
}

function rationaleFor(e: Evidence, proposers: MindId[]): string[] {
  const { pick: p, quant: q, market: m } = e
  const why: Record<MindId, string> = {
    sam: `Safe Sam: win chance ${pct(q.pBlend)} (needs ${pct(CHIEF.sam.minProb)}+) with non-negative value`,
    val: `Value Val: conservative EV ${q.evCons >= 0 ? '+' : ''}${pct(q.evCons, 1)} (needs +${pct(CHIEF.val.minEvCons)}+)`,
    cat: `Contrarian Cat: the market rates this side ${pct(p.marketProb ?? 0)}, the model ${pct(p.modelProb)}`,
    lou: 'Longshot Lou: qualifies as a parlay leg',
  }
  return [
    `Proposed by ${proposers.map((x) => why[x]).join('; ')}.`,
    `Quant: model ${pct(p.modelProb)} corrected to ${pct(q.modelCal)} for known overconfidence, blended with the market to ${pct(q.pBlend)}; ${q.nEff} games of evidence give a conservative ${pct(q.pCons)}. At ${m.execPrice.toFixed(2)} that is ${q.evHat >= 0 ? '+' : ''}${pct(q.evHat, 1)} expected, ${q.evCons >= 0 ? '+' : ''}${pct(q.evCons, 1)} conservative.`,
    `Market: best ${m.bestPrice.toFixed(2)}${m.corroboratedBy ? `, counted at ${m.execPrice.toFixed(2)} because ${m.corroboratedBy} is close` : ''}; market-implied chance ${pct(m.consensus ?? 0)}, so the price is ${m.marketEv >= 0 ? 'above' : `${pct(-m.marketEv, 1)} below`} fair by the market's own measure. Line movement unavailable.`,
    `Matchup: ${e.matchup.notes.join('; ')}.`,
    `Skeptic: ${e.skeptic.notes.length ? e.skeptic.notes.join('; ') : 'no vetoes'}${e.skeptic.flags.length ? ` (flags: ${e.skeptic.flags.join(', ')})` : ''}.`,
  ]
}

function singleBet(e: Evidence, proposers: MindId[]): Bet {
  return {
    mind: proposers[0], proposedBy: proposers, kind: 'single', legs: [e.pick], legPrices: [e.market.execPrice], legEvidence: [e],
    odds: e.market.execPrice, prob: e.quant.pBlend, pCons: e.quant.pCons, ev: e.quant.evHat, evCons: e.quant.evCons, research: false, tier: 'strict', stake: 1,
    rationale: rationaleFor(e, proposers),
  }
}

/** A lean: credited to whichever personalities' point-estimate thresholds it meets (Value Val if none), at a smaller stake. */
function leanBet(e: Evidence): Bet {
  const c = CHIEF
  const p = e.pick, q = e.quant
  const who: MindId[] = []
  if (q.pBlend >= c.sam.minProb && q.evHat >= 0) who.push('sam')
  if (q.pBlend >= c.val.minProb && q.evHat >= c.val.minEvCons) who.push('val')
  if (p.marketProb != null && p.marketProb < c.cat.maxMarketProb && p.modelProb - p.marketProb >= c.cat.minGap && q.evHat >= c.cat.minEvCons && e.matchup.score >= c.cat.minMatchup) who.push('cat')
  if (!who.length) who.push('val')
  const bet = singleBet(e, who)
  return {
    ...bet, tier: 'lean', stake: c.lean.stake,
    rationale: [`LEAN, suggested stake ${c.lean.stake} unit: the model sees ${q.evHat >= 0 ? '+' : ''}${pct(q.evHat, 1)} expected value, but it is ${pct(q.evCons, 1)} once the uncertainty from ${q.nEff} games is counted, so it did not earn a full bet. Treat it as a lower-confidence play.`, ...bet.rationale],
  }
}

/** The proposers whose own thresholds this evidence meets. */
function proposers(e: Evidence): { who: MindId[]; failed: Partial<Record<MindId, { reason: string; detail: string }>> } {
  const c = CHIEF
  const p = e.pick, q = e.quant
  const who: MindId[] = []
  const failed: Partial<Record<MindId, { reason: string; detail: string }>> = {}
  if (q.pBlend >= c.sam.minProb && q.evCons >= c.sam.minEvCons) who.push('sam')
  if (q.pBlend >= c.val.minProb && q.evCons >= c.val.minEvCons) who.push('val')
  if (p.marketProb != null && p.marketProb < c.cat.maxMarketProb && p.modelProb - p.marketProb >= c.cat.minGap && q.evCons >= c.cat.minEvCons) {
    if (e.matchup.score >= c.cat.minMatchup) who.push('cat')
    else failed.cat = { reason: 'cat_uncorroborated', detail: `the market disagrees by ${pct(p.modelProb - p.marketProb)} and nothing in the matchup explains it` }
  }
  return { who, failed }
}

export function decide(allPicks: Pick[]): Decision {
  const c = CHIEF
  const ineligible: Record<string, number> = {}
  const eligible: Pick[] = []
  for (const p of allPicks) {
    const r = ineligibleReason(p)
    if (r) ineligible[r] = (ineligible[r] ?? 0) + 1
    else eligible.push(p)
  }
  // Starters and stars: a team's top N by minutes among the eligible, per game.
  const minutes = new Map<string, Map<number, number>>()
  for (const p of eligible) {
    const g = minutes.get(groupKey(p)) ?? minutes.set(groupKey(p), new Map()).get(groupKey(p))!
    g.set(p.playerId, p.role!.min10)
  }
  const starters = new Set<string>()
  for (const [g, m] of minutes) [...m].sort((a, b) => b[1] - a[1]).slice(0, c.starterTopN).forEach(([id]) => starters.add(`${g}|${id}`))
  const pool = eligible.filter((p) => starters.has(`${groupKey(p)}|${p.playerId}`))
  ineligible.not_a_starter_or_star = (ineligible.not_a_starter_or_star ?? 0) + (eligible.length - pool.length)
  if (!ineligible.not_a_starter_or_star) delete ineligible.not_a_starter_or_star

  const evidence = pool.map(buildEvidence)
  const rejected: Rejection[] = []
  const rej = (e: Evidence, who: MindId[], r: { reason: string; detail: string }) =>
    rejected.push({ proposedBy: who, pick: e.pick, reason: r.reason, detail: r.detail, pCons: e.quant.pCons, evCons: e.quant.evCons })

  // 1. Candidates: each personality's own thresholds. 2. The Chief's checks.
  const survivors = new Map<string, { e: Evidence; who: MindId[] }>()
  let candidates = 0
  for (const e of evidence) {
    const { who, failed } = proposers(e)
    for (const [m, r] of Object.entries(failed)) rej(e, [m as MindId], r!)
    if (!who.length) continue
    candidates++
    const verdict = chiefCheck(e)
    if (verdict) { rej(e, who, verdict); continue }
    survivors.set(legKey(e.pick), { e, who })
  }

  // 3. Portfolio: one bet per player+stat, then caps in order of conservative value. Caps drop bets; nothing is added.
  const ranked = [...survivors.values()].sort((a, b) => b.e.quant.evCons - a.e.quant.evCons || b.e.quant.pCons - a.e.quant.pCons)
  const approved: Bet[] = []
  const seenStat = new Set<string>()
  const players = new Map<number, number>(), games = new Map<string, number>()
  let unders = 0
  for (const { e, who } of ranked) {
    const p = e.pick
    const stat = `${p.playerId}|${p.stat}`
    const drop = (reason: string, detail: string) => rej(e, who, { reason, detail })
    if (seenStat.has(stat)) { drop('duplicate_exposure', 'a better line on the same player and stat is already chosen'); continue }
    if ((players.get(p.playerId) ?? 0) >= c.maxBetsPerPlayer) { drop('player_cap', `already ${c.maxBetsPerPlayer} bets on ${p.player}`); continue }
    if ((games.get(p.eventId) ?? 0) >= c.maxBetsPerGame) { drop('game_cap', `already ${c.maxBetsPerGame} bets in this game: they share pace and blowout risk`); continue }
    if (approved.length >= c.maxDailyBets) { drop('daily_cap', `the day's limit of ${c.maxDailyBets} bets is reached`); continue }
    const under = p.side === 'under'
    if (under && approved.length + 1 >= c.underShareFrom && (unders + 1) / (approved.length + 1) > c.maxUnderShare) { drop('under_share_cap', 'too much of the card would rest on the model leaning Under'); continue }
    seenStat.add(stat); players.set(p.playerId, (players.get(p.playerId) ?? 0) + 1); games.set(p.eventId, (games.get(p.eventId) ?? 0) + 1)
    if (under) unders++
    approved.push(singleBet(e, who))
  }

  // 3b. Leans: what the strict tier turned down because the uncertainty haircut removed the edge. One bet per player in all,
  // the same per-game cap, a small stake, and their own record, so they can be compared with the strict tier.
  const leans: Bet[] = []
  for (const e of evidence.filter((x) => !chiefCheck(x) && x.quant.pBlend >= c.lean.minProb && x.quant.evHat >= c.lean.minEvHat).sort((a, b) => b.quant.evHat - a.quant.evHat)) {
    const p = e.pick
    if (leans.length >= c.lean.maxPerDay) break
    if ((players.get(p.playerId) ?? 0) >= 1) continue   // one bet per player in all: a strict bet on him rules out a lean on him
    if ((games.get(p.eventId) ?? 0) >= c.maxBetsPerGame) continue
    const under = p.side === 'under'
    const total = approved.length + leans.length
    if (under && total + 1 >= c.underShareFrom && (unders + 1) / (total + 1) > c.maxUnderShare) continue
    players.set(p.playerId, 1); games.set(p.eventId, (games.get(p.eventId) ?? 0) + 1)
    if (under) unders++
    leans.push(leanBet(e))
  }

  // Near misses: a raw edge that the haircut removed and that did not fit the lean list (caps). Recorded, never bet.
  const leanKeys = new Set(leans.map((b) => legKey(b.legs[0])))
  const candidateKeys = new Set(rejected.map((r) => legKey(r.pick)).concat([...survivors.keys()], [...leanKeys]))
  const near = evidence
    .filter((e) => !candidateKeys.has(legKey(e.pick)) && !chiefCheck(e) && e.quant.pBlend >= c.val.minProb && e.quant.evHat >= c.val.minEvCons)
    .sort((a, b) => b.quant.evHat - a.quant.evHat).slice(0, c.maxNearMisses)
  for (const e of near) rej(e, ['val'], { reason: 'uncertainty_haircut', detail: `raw expected value ${pct(e.quant.evHat, 1)}, but ${pct(e.quant.evCons, 1)} once the uncertainty from ${e.quant.nEff} games is counted` })

  // Watchlist: the best of the rest. Not candidates, not bets: they show how far the slate was from qualifying, and grading
  // them later shows whether the thresholds are too strict. Ranked by conservative value; anything the Chief would veto is excluded.
  const seen = new Set([...rejected.map((r) => legKey(r.pick)), ...survivors.keys(), ...leanKeys])
  const watch = evidence
    .filter((e) => !seen.has(legKey(e.pick)) && !chiefCheck(e))
    .sort((a, b) => b.quant.evCons - a.quant.evCons).slice(0, c.maxWatchlist)
  for (const e of watch) rej(e, [], { reason: 'watchlist', detail: `closest to qualifying: conservative value ${e.quant.evCons >= 0 ? '+' : ''}${pct(e.quant.evCons, 1)} (Value Val needs +${pct(c.val.minEvCons)}), win chance ${pct(e.quant.pBlend)} (Safe Sam needs ${pct(c.sam.minProb)})` })

  // 4. Parlays (research only): individually qualified legs, different games, product of conservative chances.
  const research = buildParlays(evidence.filter((e) => !chiefCheck(e) && e.pick.push === 0 && e.quant.evCons >= c.lou.minLegEvCons && e.quant.pCons >= c.lou.minLegPCons))

  return {
    approved, leans, research, rejected,
    stats: { picks: allPicks.length, eligible: pool.length, ineligible, candidates, approved: approved.length, leans: leans.length, research: research.length, rejected: rejected.length },
  }
}

function buildParlays(legs: Evidence[]): Bet[] {
  const c = CHIEF
  const sorted = [...legs].sort((a, b) => b.quant.evCons - a.quant.evCons)
  const used = new Set<string>()
  const out: Bet[] = []
  for (let n = 0; n < c.lou.maxParlays; n++) {
    let best: Evidence[] | null = null, bestEv = -Infinity
    const free = sorted.filter((e) => !used.has(legKey(e.pick)))
    const chosen: Evidence[] = []
    const games = new Set<string>(), players = new Set<number>()
    for (const e of free) {
      if (chosen.length >= c.lou.maxLegs) break
      if (games.has(e.pick.eventId) || players.has(e.pick.playerId)) continue   // same-game legs are correlated; the product rule does not hold
      chosen.push(e); games.add(e.pick.eventId); players.add(e.pick.playerId)
      if (chosen.length >= c.lou.minLegs) {
        const ev = chosen.reduce((a, x) => a * x.quant.pCons * x.market.execPrice, 1) - 1
        if (ev > bestEv) { bestEv = ev; best = [...chosen] }
      }
    }
    if (!best || bestEv < c.lou.minEvCons) break
    best.forEach((e) => used.add(legKey(e.pick)))
    const odds = best.reduce((a, e) => a * e.market.execPrice, 1)
    const prob = best.reduce((a, e) => a * e.quant.pBlend, 1)
    const pCons = best.reduce((a, e) => a * e.quant.pCons, 1)
    out.push({
      mind: 'lou', proposedBy: ['lou'], kind: 'combo', legs: best.map((e) => e.pick), legPrices: best.map((e) => e.market.execPrice), legEvidence: best,
      odds, prob, pCons, ev: prob * odds - 1, evCons: pCons * odds - 1, research: true, tier: 'research', stake: 1,
      rationale: [
        `Longshot Lou: ${best.length} legs from ${best.length} different games, each individually clearing +${pct(c.lou.minLegEvCons)} conservative value and ${pct(c.lou.minLegPCons)} conservative chance.`,
        `Joint chance ${pct(pCons, 1)} (conservative) at ${odds.toFixed(2)}x is ${pct(pCons * odds - 1, 1)} expected; the floor is +${pct(c.lou.minEvCons)}.`,
        'The legs are assumed independent because they are from different games. That assumption is not validated, so this parlay is research-only and not staked.',
      ],
    })
  }
  return out
}
