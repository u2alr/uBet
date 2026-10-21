// The minds, version 7: four specialist proposers, one deterministic Chief, one canonical probability and EV engine.
//
//   picks -> candidate records (shared/engine/record.ts: calibration, consensus, price, EV, eligibility)
//         -> specialists PROPOSE (Safe Sam, Value Val, Contrarian Cat, Longshot Lou)
//         -> the Chief VALIDATES each proposal, RECOMPUTES its thresholds from the record, applies the portfolio caps
//         -> strict bets / shadow leans / research-only candidates / paper volume board / structured rejections
//
// The Chief never takes a probability, an EV or an approval from a proposal: it looks the candidate up and decides from the engine's own
// record. A proposal is untrusted input. Nothing here asks an LLM for a number; if one is ever added, it can only submit proposals.
// Rules and evidence: research/PREREG_MINDS_V7.md and AUDIT_ENGINE.md.
import { TEAM_NAMES, type Pick } from './picks.ts'
import { DEFAULT_ENGINE_CONFIG, makeConfig, stableHash, type EngineConfig } from './engine/config.ts'
import type { CalibrationArtifact } from './engine/calibration.ts'
import { binaryExpectedReturn } from './engine/payoff.ts'
import { atLeast, buildCandidate, legKey, minutesRanks, type CandidateRecord, type RecordContext } from './engine/record.ts'
import { reason, type Reason, type ReasonCode } from './engine/reasons.ts'
import { calibrateSide } from './engine/calibration.ts'

export const MINDS_VERSION = 'minds-v7'
export { DEFAULT_ENGINE_CONFIG, makeConfig, stableHash, legKey }
export type { EngineConfig, CandidateRecord }

/** The default configuration, exported under the name the UI and older code know. */
export const CHIEF = DEFAULT_ENGINE_CONFIG

export type MindId = 'sam' | 'val' | 'lou' | 'cat'
export const MIND_IDS: readonly MindId[] = ['sam', 'val', 'lou', 'cat']
export const MIND_NAMES: Record<MindId, string> = { sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat' }

export type Tier = 'strict' | 'lean' | 'research' | 'volume'
export type Label = 'STRICT' | 'SHADOW_ONLY' | 'RESEARCH_ONLY' | 'PAPER_VOLUME'
const LABEL: Record<Tier, Label> = { strict: 'STRICT', lean: 'SHADOW_ONLY', research: 'RESEARCH_ONLY', volume: 'PAPER_VOLUME' }

export interface Bet {
  /** The specialist that proposed it first; `proposedBy` lists every one that did. */
  mind: MindId
  proposedBy: MindId[]
  kind: 'single' | 'combo'
  legs: Pick[]
  /** The canonical engine record behind each leg. Everything below is read from them. */
  records: CandidateRecord[]
  /** Executable price per leg, in leg order: the price the bet is graded at. */
  legPrices: number[]
  odds: number
  /** Win chance at the decision probability (what the bet "says"). */
  prob: number
  /** Win chance at the conservative probability. */
  pCons: number
  ev: number
  evCons: number
  tier: Tier
  label: Label
  /** Parlays: an independence-based estimate, labelled as an experimental baseline and never as a validated one. */
  experimental: boolean
  /** True for anything not part of the strict staked portfolio (kept for older readers). */
  research: boolean
  /** Reporting stake in units: 1 for strict; the hypothetical grading stake for leans and the paper tiers. Only strict bets are real recommendations. */
  stake: number
  rationale: string[]
}

export interface Rejection {
  proposedBy: MindId[]
  pick: Pick
  /** The first reason, kept for older readers. */
  reason: ReasonCode
  detail: string
  reasons: Reason[]
  pCons: number
  evCons: number
  stage: 'eligibility' | 'proposal' | 'threshold' | 'portfolio' | 'watchlist'
}

export interface CapLog { cap: string; candidate: string; detail: string }
export interface Exposure { byPlayer: Record<string, number>; byGame: Record<string, number>; byTeam: Record<string, number>; byMarket: Record<string, number>; bySide: Record<string, number> }

export interface Decision {
  approved: Bet[]
  leans: Bet[]
  /** Research-only singles (valid but unvalidated or thin-history) followed by research-only parlays. */
  research: Bet[]
  volume: Bet[]
  rejected: Rejection[]
  /** Every record the engine built for a candidate that reached the evidence stage, rejected ones included. The audit trail. */
  candidates: CandidateRecord[]
  /** Which caps removed which candidates. */
  capLog: CapLog[]
  exposure: Exposure
  stats: {
    picks: number; evaluated: number; byStatus: Record<string, number>; byReason: Record<string, number>
    candidates: number; approved: number; leans: number; research: number; volume: number; volumeByGame: Record<string, number>; rejected: number
  }
  run: { version: string; configHash: string; calibrationVersion: string | null; calibrationHash: string | null; now: number }
}

export interface DecideOptions {
  now: number
  config?: EngineConfig
  calibration: CalibrationArtifact | null
  /** True when the injury list was fetched this run. Defaults to what the picks say. */
  injuryChecked?: boolean
  /** Proposals from outside the deterministic specialists (for example an LLM). Validated like any other. */
  extraProposals?: unknown[]
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
const signed = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`

// ---------------------------------------------------------------------------------------------------------------
// Proposals: untrusted input, validated before use

export interface Proposal { mind: MindId; keys: string[] }
const PROPOSAL_FIELDS = new Set(['mind', 'keys'])

export interface ProposalCheck { ok: boolean; proposal?: Proposal; reasons: Reason[] }

/** Schema check of one proposal from any source. Unknown fields (an attempted override) are ignored and noted, never obeyed. */
export function validateProposal(x: unknown, known: ReadonlySet<string>): ProposalCheck {
  const reasons: Reason[] = []
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, reasons: [reason('INVALID_PROPOSAL', 'a proposal must be an object')] }
  const o = x as Record<string, unknown>
  if (typeof o.mind !== 'string' || !(MIND_IDS as readonly string[]).includes(o.mind)) return { ok: false, reasons: [reason('INVALID_PROPOSAL', `unknown specialist ${JSON.stringify(o.mind)}`)] }
  if (!Array.isArray(o.keys) || !o.keys.length || o.keys.some((k) => typeof k !== 'string')) return { ok: false, reasons: [reason('INVALID_PROPOSAL', 'keys must be a non-empty array of candidate keys')] }
  for (const k of Object.keys(o)) if (!PROPOSAL_FIELDS.has(k)) reasons.push(reason('PROPOSAL_FIELD_IGNORED', `"${k}" is not something a proposal may set; the engine's own record decides`))
  const keys = o.keys as string[]
  const missing = keys.filter((k) => !known.has(k))
  if (missing.length) return { ok: false, reasons: [...reasons, reason('UNKNOWN_CANDIDATE', `no engine record for ${missing.join(', ')}`)] }
  return { ok: true, proposal: { mind: o.mind as MindId, keys }, reasons }
}

// ---------------------------------------------------------------------------------------------------------------
// The specialists' own thresholds, evaluated ONLY from the canonical record. Used twice: to propose, and again by the Chief.

const clean = (r: CandidateRecord) => r.status === 'ELIGIBLE'
const evC = (r: CandidateRecord) => r.ev.conservative
const pC = (r: CandidateRecord) => r.probability.conservative

export function meetsSam(r: CandidateRecord, c: EngineConfig): boolean { return clean(r) && atLeast(pC(r), c.sam.minProbability) && atLeast(evC(r), c.sam.minEvConservative) }
export function meetsVal(r: CandidateRecord, c: EngineConfig): boolean { return clean(r) && atLeast(pC(r), c.val.minProbability) && atLeast(evC(r), c.val.minEvConservative) }
export function meetsCat(r: CandidateRecord, c: EngineConfig): boolean {
  const fair = r.probability.marketFair, cal = r.probability.calibration.calibrated
  return clean(r) && fair !== null && cal !== null && fair < c.cat.maxMarketProbability && atLeast(cal - fair, c.cat.minGap) && cal - fair < c.eligibility.extremeGap
    && atLeast(evC(r), c.cat.minEvConservative) && r.review.matchup.explanation !== null && r.review.matchup.score >= c.cat.minMatchupScore
}
const SPECIALIST: Record<Exclude<MindId, 'lou'>, (r: CandidateRecord, c: EngineConfig) => boolean> = { sam: meetsSam, val: meetsVal, cat: meetsCat }
const BELOW: Record<Exclude<MindId, 'lou'>, ReasonCode> = { sam: 'BELOW_SAM_THRESHOLD', val: 'BELOW_VAL_THRESHOLD', cat: 'BELOW_CAT_THRESHOLD' }

const width = (r: CandidateRecord) => (r.probability.conservative !== null && r.probability.decision !== null ? r.probability.decision - r.probability.conservative : Infinity)

/** Specialist rankings (secondary criteria as specified); output order only. The Chief applies the caps in its own global order. */
const RANK: Record<Exclude<MindId, 'lou'>, (a: CandidateRecord, b: CandidateRecord) => number> = {
  sam: (a, b) => pC(b)! - pC(a)! || evC(b)! - evC(a)! || width(a) - width(b),
  val: (a, b) => evC(b)! - evC(a)! || width(a) - width(b) || (b.price.price! / b.price.best!) - (a.price.price! / a.price.best!),
  cat: (a, b) => (b.probability.calibration.calibrated! - b.probability.marketFair!) - (a.probability.calibration.calibrated! - a.probability.marketFair!) || evC(b)! - evC(a)!,
}

export function specialistProposals(records: CandidateRecord[], c: EngineConfig): Proposal[] {
  const out: Proposal[] = []
  for (const mind of ['sam', 'val', 'cat'] as const) {
    const ok = records.filter((r) => SPECIALIST[mind](r, c)).sort(RANK[mind])
    for (const r of ok) out.push({ mind, keys: [r.key] })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Bets

function rationaleFor(r: CandidateRecord, proposers: MindId[], c: EngineConfig): string[] {
  const p = r.probability
  const why: Record<MindId, string> = {
    sam: `Safe Sam: conservative win chance ${pct(p.conservative ?? 0, 1)} (needs ${pct(c.sam.minProbability)}+) with non-negative conservative value`,
    val: `Value Val: conservative expected return ${signed(r.ev.conservative ?? 0)} (needs ${signed(c.val.minEvConservative, 0)}+) at a conservative win chance of ${pct(p.conservative ?? 0, 1)}`,
    cat: `Contrarian Cat: the market rates this side ${pct(p.marketFair ?? 0, 1)}, the calibrated model ${pct(p.calibration.calibrated ?? 0, 1)}; reason: ${r.review.matchup.explanation}`,
    lou: 'Longshot Lou: qualifies as a parlay leg',
  }
  return [
    `Proposed by ${proposers.map((x) => why[x]).join('; ')}.`,
    `Quant: raw model ${pct(p.raw, 1)}, calibrated ${pct(p.calibration.calibrated ?? 0, 1)} (${p.calibration.method}, ${p.calibration.status}, artifact ${p.calibration.artifactVersion}); decision probability ${pct(p.decision ?? 0, 1)}, conservative ${pct(p.conservative ?? 0, 1)} (${p.uncertainty.confidence}). Expected return ${signed(r.ev.raw ?? 0)}, conservative ${signed(r.ev.conservative ?? 0)} at ${r.price.price?.toFixed(2)}.`,
    `Market: ${p.independentBooks} independent fresh books; fair ${pct(p.marketFair ?? 0, 1)} (lower ${pct(p.marketFairLower ?? 0, 1)}), implied with margin ${pct(p.marketImpliedWithMargin ?? 0, 1)}. Best ${r.price.best?.toFixed(2)}${r.price.corroboratedBy ? `, counted at ${r.price.price?.toFixed(2)} because ${r.price.corroboratedBy} corroborates` : ''}, as of ${r.price.asOf}. Line movement unavailable.`,
    `Matchup: ${r.review.matchup.notes.join('; ')}.`,
    `Skeptic: ${r.eligibility.flags.filter((f) => f.code !== 'LINE_MOVEMENT_UNAVAILABLE' && f.code !== 'TIMESTAMP_FROM_FEED_ONLY').map((f) => `${f.code} (${f.detail})`).join('; ') || 'no vetoes'}.`,
  ]
}

function singleBet(pick: Pick, r: CandidateRecord, proposers: MindId[], tier: Tier, c: EngineConfig, extra: string[] = []): Bet {
  const price = r.price.price!
  return {
    mind: proposers[0], proposedBy: proposers, kind: 'single', legs: [pick], records: [r], legPrices: [price], odds: price,
    prob: r.probability.decision ?? r.probability.raw, pCons: r.probability.conservative ?? r.probability.raw, ev: r.ev.raw ?? 0, evCons: r.ev.conservative ?? 0,
    tier, label: LABEL[tier], experimental: false, research: tier !== 'strict', stake: tier === 'strict' ? c.portfolio.unitStake : tier === 'lean' ? c.lean.hypotheticalStake : c.portfolio.unitStake,
    rationale: [...extra, ...rationaleFor(r, proposers, c)],
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The Chief

export function decide(allPicks: Pick[], opts: DecideOptions): Decision {
  const c = opts.config ?? makeConfig()
  const injuryChecked = opts.injuryChecked ?? allPicks.some((p) => p.injuryChecked === true)
  const ctx: RecordContext = { now: opts.now, config: c, calibration: opts.calibration, minutesRank: minutesRanks(allPicks), injuryChecked }
  const capLog: CapLog[] = []
  const rejected: Rejection[] = []
  const byPick = new Map<string, Pick>()

  // 1. Candidate records for every pick that has the basic ingredients (a fresh model projection and a minutes role); the rest are counted.
  const records: CandidateRecord[] = []
  let notEvaluated = 0
  for (const p of allPicks) {
    if (p.model !== 'gbm-v1' || !p.role || p.team == null) { notEvaluated++; continue }
    const r = buildCandidate(p, ctx)
    records.push(r); byPick.set(r.key, p)
  }
  const byKey = new Map(records.map((r) => [r.key, r]))
  const byStatus: Record<string, number> = { NOT_EVALUATED: notEvaluated }
  const byReason: Record<string, number> = {}
  for (const r of records) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    for (const x of [...r.eligibility.hard, ...r.eligibility.research]) byReason[x.code] = (byReason[x.code] ?? 0) + 1
  }
  const rej = (r: CandidateRecord, who: MindId[], reasons: Reason[], stage: Rejection['stage']) =>
    rejected.push({ proposedBy: who, pick: byPick.get(r.key)!, reason: reasons[0].code, detail: reasons[0].detail, reasons, pCons: r.probability.conservative ?? 0, evCons: r.ev.conservative ?? 0, stage })

  // 2. Proposals: the specialists' own, plus any from outside. Each is validated; the Chief reads only the keys.
  const known = new Set(byKey.keys())
  const raw: unknown[] = [...specialistProposals(records, c), ...(opts.extraProposals ?? [])]
  const proposers = new Map<string, Set<MindId>>()
  for (const x of raw) {
    const chk = validateProposal(x, known)
    if (!chk.ok) { capLog.push({ cap: 'proposal_validation', candidate: (JSON.stringify(x) ?? String(x)).slice(0, 80), detail: chk.reasons.map((q) => q.code).join(',') }); continue }
    for (const q of chk.reasons) capLog.push({ cap: 'proposal_validation', candidate: chk.proposal!.keys.join(','), detail: `${q.code}: ${q.detail}` })
    if (chk.proposal!.mind === 'lou') continue                                  // parlays are built by the Chief from its own legs, not accepted as free-form proposals
    for (const k of chk.proposal!.keys) (proposers.get(k) ?? proposers.set(k, new Set()).get(k)!).add(chk.proposal!.mind)
  }

  // 3. Recompute every claim from the record. A proposal for a candidate that fails a hard gate, or that does not meet the proposer's
  //    own threshold on the engine's numbers, is rejected here whatever the proposal said.
  const survivors: { r: CandidateRecord; who: MindId[] }[] = []
  for (const [key, set] of proposers) {
    const r = byKey.get(key)!
    const who = [...set]
    if (r.status !== 'ELIGIBLE') { rej(r, who, [...r.eligibility.hard, ...r.eligibility.research], 'eligibility'); continue }
    const valid = who.filter((m) => m !== 'lou' && SPECIALIST[m](r, c))
    if (!valid.length) { rej(r, who, who.map((m) => reason(BELOW[m as Exclude<MindId, 'lou'>], `does not meet ${MIND_NAMES[m]}'s thresholds on the engine's numbers`)), 'threshold'); continue }
    survivors.push({ r, who: valid })
  }

  // 4. Portfolio: global order is conservative value, then conservative probability. A cap only ever removes a candidate.
  const ordered = survivors.sort((a, b) => b.r.ev.conservative! - a.r.ev.conservative! || b.r.probability.conservative! - a.r.probability.conservative! || (a.r.key < b.r.key ? -1 : 1))
  const approved: Bet[] = []
  const playerStat = new Set<string>()
  const players = new Map<number, number>(), games = new Map<string, number>()
  let unders = 0
  for (const { r, who } of ordered) {
    const pk = byPick.get(r.key)!
    const drop = (code: ReasonCode, detail: string, cap: string) => { rej(r, who, [reason(code, detail)], 'portfolio'); capLog.push({ cap, candidate: r.key, detail }) }
    if (playerStat.has(`${pk.playerId}|${pk.stat}`)) { drop('PLAYER_STAT_CAP', `a better ${pk.stat} line on ${pk.player} is already chosen`, 'maxStrictPerPlayerStat'); continue }
    if ((players.get(pk.playerId) ?? 0) >= c.portfolio.maxStrictPerPlayer) { drop('PLAYER_CAP', `already ${c.portfolio.maxStrictPerPlayer} strict bets on ${pk.player}`, 'maxStrictPerPlayer'); continue }
    if ((games.get(pk.eventId) ?? 0) >= c.portfolio.maxStrictPerGame) { drop('GAME_CAP', `already ${c.portfolio.maxStrictPerGame} strict bets in ${pk.game}`, 'maxStrictPerGame'); continue }
    if (approved.length >= c.portfolio.maxStrictPerDay) { drop('DAILY_CAP', `the day's limit of ${c.portfolio.maxStrictPerDay} strict bets is reached`, 'maxStrictPerDay'); continue }
    if (pk.side === 'under' && approved.length + 1 >= c.portfolio.underShareFrom && (unders + 1) / (approved.length + 1) > c.portfolio.maxUnderShare) { drop('UNDER_SHARE_CAP', `Unders would exceed ${pct(c.portfolio.maxUnderShare)} of the strict bets`, 'maxUnderShare'); continue }
    playerStat.add(`${pk.playerId}|${pk.stat}`); players.set(pk.playerId, (players.get(pk.playerId) ?? 0) + 1); games.set(pk.eventId, (games.get(pk.eventId) ?? 0) + 1)
    if (pk.side === 'under') unders++
    approved.push(singleBet(pk, r, who, 'strict', c))
  }
  const strictKeys = new Set(approved.map((b) => b.records[0].key))
  const capped = new Set(rejected.filter((x) => x.stage === 'portfolio').map((x) => legKey(x.pick)))

  // 5. Leans (SHADOW_ONLY): eligible candidates that failed strict approval specifically on the conservative threshold. A candidate the caps
  //    removed, or that any specialist approved, never becomes a lean.
  const leans: Bet[] = []
  const leanPlayers = new Set<number>(approved.map((b) => b.legs[0].playerId))
  const leanCandidates = records
    .filter((r) => r.status === 'ELIGIBLE' && !strictKeys.has(r.key) && !capped.has(r.key) && !proposers.has(r.key)
      && atLeast(r.ev.raw, c.lean.minRawEv) && atLeast(r.probability.decision, c.lean.minRawProbability))
    .sort((a, b) => b.ev.raw! - a.ev.raw! || (a.key < b.key ? -1 : 1))
  for (const r of leanCandidates) {
    const pk = byPick.get(r.key)!
    if (leans.length >= c.lean.maxPerDay) { capLog.push({ cap: 'lean.maxPerDay', candidate: r.key, detail: `the day's limit of ${c.lean.maxPerDay} leans is reached` }); continue }
    if (leanPlayers.has(pk.playerId)) { capLog.push({ cap: 'lean.maxPerPlayer', candidate: r.key, detail: `${pk.player} already has a bet or lean` }); continue }
    leanPlayers.add(pk.playerId)
    const who: MindId[] = []
    if (atLeast(r.probability.decision, c.sam.minProbability) && atLeast(r.ev.raw, 0)) who.push('sam')
    if (atLeast(r.probability.decision, c.val.minProbability) && atLeast(r.ev.raw, c.val.minEvConservative)) who.push('val')
    if (!who.length) who.push('val')
    leans.push(singleBet(pk, r, who, 'lean', c, [`SHADOW_ONLY: expected return ${signed(r.ev.raw!)} on the raw decision probability, ${signed(r.ev.conservative ?? 0)} on the conservative one. It failed strict approval because of the conservative threshold, and nothing else. Not a recommendation; tracked to test whether this tier has any predictive value.`]))
  }

  // 6. Research-only singles: valid data that is not good enough to approve (thin history, unvalidated calibration). Never staked.
  const research: Bet[] = []
  const researchPlayers = new Set<number>()
  for (const r of records.filter((x) => x.status === 'RESEARCH_ONLY' && atLeast(x.ev.raw, c.lean.minRawEv) && atLeast(x.probability.decision, c.lean.minRawProbability)).sort((a, b) => b.ev.raw! - a.ev.raw! || (a.key < b.key ? -1 : 1))) {
    const pk = byPick.get(r.key)!
    if (research.length >= c.lean.maxPerDay || researchPlayers.has(pk.playerId)) continue
    researchPlayers.add(pk.playerId)
    research.push(singleBet(pk, r, ['val'], 'research', c, [`RESEARCH_ONLY: ${r.eligibility.research.map((x) => `${x.code} (${x.detail})`).join('; ')}.`]))
  }
  research.push(...buildParlays(records, byPick, c))

  // 7. Watchlist: the best eligible candidates nobody proposed and that are not leans. Information, not bets.
  const used = new Set([...strictKeys, ...leans.map((b) => b.records[0].key), ...proposers.keys()])
  for (const r of records.filter((x) => x.status === 'ELIGIBLE' && !used.has(x.key) && x.ev.conservative !== null).sort((a, b) => b.ev.conservative! - a.ev.conservative! || (a.key < b.key ? -1 : 1)).slice(0, 25))
    rej(r, [], [reason('FAILS_CONSERVATIVE_THRESHOLD', `closest to qualifying: conservative expected return ${signed(r.ev.conservative!)} (Value Val needs ${signed(c.val.minEvConservative, 0)}), conservative win chance ${pct(r.probability.conservative ?? 0)} (Safe Sam needs ${pct(c.sam.minProbability)})`)], 'watchlist')

  const vol = volumeBoard(allPicks, c, opts.calibration, opts.now)
  const exposure = exposureOf(approved)
  return {
    approved, leans, research, volume: vol.bets, rejected, candidates: records, capLog, exposure,
    stats: { picks: allPicks.length, evaluated: records.length, byStatus, byReason, candidates: proposers.size, approved: approved.length, leans: leans.length, research: research.length, volume: vol.bets.length, volumeByGame: vol.byGame, rejected: rejected.length },
    run: { version: MINDS_VERSION, configHash: stableHash(c), calibrationVersion: opts.calibration?.version ?? null, calibrationHash: opts.calibration?.hash ?? null, now: opts.now },
  }
}

/** Where the strict portfolio's risk is concentrated: by player, game, team, market type and side. Correlated bets are shared exposure. */
export function exposureOf(bets: Bet[]): Exposure {
  const e: Exposure = { byPlayer: {}, byGame: {}, byTeam: {}, byMarket: {}, bySide: {} }
  const inc = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
  for (const b of bets) for (const l of b.legs) { inc(e.byPlayer, l.player); inc(e.byGame, l.game); inc(e.byTeam, l.team ?? '?'); inc(e.byMarket, l.stat); inc(e.bySide, l.side) }
  return e
}

// ---------------------------------------------------------------------------------------------------------------
// Parlays (Longshot Lou): RESEARCH_ONLY. The joint probability assumes independence between games, which is not validated.

function buildParlays(records: CandidateRecord[], byPick: Map<string, Pick>, c: EngineConfig): Bet[] {
  const legs = records
    .filter((r) => r.status === 'ELIGIBLE' && byPick.get(r.key)!.push === 0 && atLeast(r.ev.conservative, c.lou.minLegEv) && atLeast(r.probability.conservative, c.lou.minLegProbability))
    .sort((a, b) => b.ev.conservative! - a.ev.conservative! || (a.key < b.key ? -1 : 1))
  const used = new Set<string>()
  const out: Bet[] = []
  for (let n = 0; n < c.lou.maxParlaysPerDay; n++) {
    let best: CandidateRecord[] | null = null, bestEv = -Infinity
    const chosen: CandidateRecord[] = []
    const games = new Set<string>(), players = new Set<number>()
    for (const r of legs.filter((x) => !used.has(x.key))) {
      if (chosen.length >= c.lou.maxLegs) break
      const pk = byPick.get(r.key)!
      if (games.has(pk.eventId) || players.has(pk.playerId)) continue            // same-game legs are correlated; the product rule would be wrong
      chosen.push(r); games.add(pk.eventId); players.add(pk.playerId)
      if (chosen.length >= c.lou.minLegs) {
        const ev = chosen.reduce((a, x) => a * x.probability.conservative! * x.price.price!, 1) - 1
        if (ev > bestEv) { bestEv = ev; best = [...chosen] }
      }
    }
    if (!best || !atLeast(bestEv, c.lou.minParlayEv)) break
    best.forEach((r) => used.add(r.key))
    const odds = best.reduce((a, r) => a * r.price.price!, 1)
    const prob = best.reduce((a, r) => a * r.probability.decision!, 1)
    const pCons = best.reduce((a, r) => a * r.probability.conservative!, 1)
    out.push({
      mind: 'lou', proposedBy: ['lou'], kind: 'combo', legs: best.map((r) => byPick.get(r.key)!), records: best, legPrices: best.map((r) => r.price.price!), odds,
      prob, pCons, ev: prob * odds - 1, evCons: pCons * odds - 1, tier: 'research', label: 'RESEARCH_ONLY', experimental: true, research: true, stake: c.portfolio.unitStake,
      rationale: [
        `RESEARCH_ONLY. Longshot Lou: ${best.length} legs from ${best.length} different games, each individually clearing ${signed(c.lou.minLegEv, 0)} conservative return and a ${pct(c.lou.minLegProbability)} conservative chance with passing eligibility.`,
        `EXPERIMENTAL independence baseline: joint chance ${pct(pCons, 2)} is the product of the legs' conservative chances, paying ${odds.toFixed(2)}x, expected return ${signed(pCons * odds - 1)} (floor ${signed(c.lou.minParlayEv, 0)}). Independence between games is assumed, not validated, and a product of lower bounds is not itself a valid lower bound. Do not treat this as a validated expected return or as an approved bet.`,
      ],
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Paper volume board: many lines per game for GRADING, not betting. It uses the same calibration and payoff maths, but has no market check.

export function volumeBoard(allPicks: Pick[], c: EngineConfig, calibration: CalibrationArtifact | null, now: number): { bets: Bet[]; byGame: Record<string, number> } {
  const v = c.volume
  const ranks = minutesRanks(allPicks.filter((p) => p.model === 'gbm-v1' && p.projectionAgeHours != null && p.projectionAgeHours <= c.eligibility.maxProjectionAgeHours && !p.injury && p.role && p.role.min10 >= v.minMinutes && (p.role.trend == null || p.role.trend > c.eligibility.minutesDeclineVeto)))
  type Row = { p: Pick; prob: number; ev: number; price: number }
  const byGame = new Map<string, Row[]>()
  for (const p of allPicks) {
    if (p.team == null || p.model !== 'gbm-v1' || p.projectionAgeHours == null || p.projectionAgeHours > c.eligibility.maxProjectionAgeHours || p.injury || !p.role) continue
    if (p.role.min10 < v.minMinutes || (p.role.trend != null && p.role.trend <= c.eligibility.minutesDeclineVeto) || p.sample < c.eligibility.minGamesResearch) continue
    if (!Number.isFinite(p.modelProb) || !Number.isFinite(p.price) || p.price < v.minPrice || p.price > v.maxPrice) continue
    const rank = ranks.get(`${p.eventId}|${p.team}|${p.playerId}`)
    if (rank === undefined || rank > v.topN) continue
    const cal = calibrateSide(calibration, p.stat, p.side, p.modelProb, c.probability.confidenceLevel)
    const prob = cal.calibrated ?? p.modelProb                                   // labelled paper: an uncalibrated statistic still gets a line to grade
    ;(byGame.get(p.eventId) ?? byGame.set(p.eventId, []).get(p.eventId)!).push({ p, prob, price: p.price, ev: binaryExpectedReturn(prob, p.push, p.price) })
  }
  const bets: Bet[] = []
  const counts: Record<string, number> = {}
  for (const rows of byGame.values()) {
    const perLine = new Map<string, Row>()
    for (const x of rows) { const k = `${x.p.playerId}|${x.p.stat}|${x.p.line}`; const cur = perLine.get(k); if (!cur || x.ev > cur.ev) perLine.set(k, x) }
    const perStat = new Map<string, Row[]>()
    for (const x of perLine.values()) { const k = `${x.p.playerId}|${x.p.stat}`; (perStat.get(k) ?? perStat.set(k, []).get(k)!).push(x) }
    const top = [...perStat.values()].flatMap((l) => l.sort((a, b) => b.ev - a.ev).slice(0, v.linesPerStat)).sort((a, b) => b.ev - a.ev).slice(0, v.perGame)
    counts[rows[0].p.game] = top.length
    for (const x of top) {
      const rec = { key: legKey(x.p), price: { price: x.price } } as unknown as CandidateRecord
      bets.push({
        mind: 'val', proposedBy: [], kind: 'single', legs: [x.p], records: [rec], legPrices: [x.price], odds: x.price, prob: x.prob, pCons: x.prob, ev: x.ev, evCons: x.ev,
        tier: 'volume', label: 'PAPER_VOLUME', experimental: true, research: true, stake: c.portfolio.unitStake,
        rationale: [`PAPER_VOLUME (never staked): ranked by the model's own value ${signed(x.ev)} at ${x.price.toFixed(2)}, with no market check. Most lines on this board have no edge and a book's margin makes the average one lose; it is here to be graded, not to be bet.`],
      })
    }
  }
  void now
  return { bets, byGame: counts }
}

// ---------------------------------------------------------------------------------------------------------------
// Opponent tendency (Matchup input), unchanged in meaning

export function attachOpponent<P extends Pick>(picks: P[], table: Record<string, Record<string, number>>): P[] {
  const byName = new Map(Object.entries(TEAM_NAMES).map(([abbr, name]) => [name, abbr]))
  return picks.map((p) => {
    const [away, home] = p.game.split(' @ ')
    const oppName = p.teamName === away ? home : p.teamName === home ? away : null
    const opp = oppName ? byName.get(oppName) : undefined
    return { ...p, oppFactor: opp ? table[opp]?.[p.stat] ?? null : null }
  })
}
