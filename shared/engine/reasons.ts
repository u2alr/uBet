// Machine-readable reason codes. Every rejection, flag and research-only classification uses one of these, with a detail string
// for humans. The code is what gets stored, counted and audited; the sentence is only a convenience.

export type ReasonClass = 'hard' | 'research' | 'flag' | 'threshold' | 'portfolio'

export const REASON_CLASS = {
  // ---- data and eligibility: any of these rejects a candidate from strict approval
  NO_TEAM: 'hard', NO_FRESH_PROJECTION: 'hard', STALE_PROJECTION: 'hard', INVALID_NUMBERS: 'hard',
  NO_MINUTES_DATA: 'hard', LOW_MINUTES: 'hard', NOT_TOP_BY_MINUTES: 'hard', MINUTES_DECLINE: 'hard',
  THIN_HISTORY: 'hard', INJURY_LISTED: 'hard', INJURY_STATUS_UNVERIFIED: 'hard', IDENTITY_UNVERIFIED: 'hard',
  TOO_FEW_INDEPENDENT_BOOKS: 'hard', NO_USABLE_QUOTES: 'hard', BOOKS_DISAGREE: 'hard',
  NO_FRESH_QUOTE: 'hard', UNVERIFIED_PRICE: 'hard', STALE_LINE_SUSPECT: 'hard', RICH_PRICE: 'hard',
  EXTREME_GAP: 'hard', UNEXPLAINED_GAP: 'hard', FORM_CONTRADICTION: 'hard', MATCHUP_CONTRADICTED: 'hard',
  // ---- valid data that is not good enough for strict approval: recorded as research-only
  RESEARCH_THIN_HISTORY: 'research', CALIBRATION_MISSING: 'research', CALIBRATION_UNVALIDATED: 'research',
  // ---- informational: never rejects on its own
  GAP_NEEDS_MATCHUP: 'flag', PUSH_RISK: 'flag', CALIBRATION_CLAMPED: 'flag', TIMESTAMP_FROM_FEED_ONLY: 'flag', LINE_MOVEMENT_UNAVAILABLE: 'flag',
  // ---- threshold outcomes
  FAILS_CONSERVATIVE_THRESHOLD: 'threshold', BELOW_SAM_THRESHOLD: 'threshold', BELOW_VAL_THRESHOLD: 'threshold', BELOW_CAT_THRESHOLD: 'threshold',
  CAT_NO_SPECIFIC_REASON: 'threshold', PARLAY_BELOW_EV_FLOOR: 'threshold', PARLAY_LEG_BELOW_FLOOR: 'threshold', NOT_A_LEAN: 'threshold',
  // ---- portfolio caps: they only ever remove a candidate
  DUPLICATE_EXPOSURE: 'portfolio', PLAYER_STAT_CAP: 'portfolio', PLAYER_CAP: 'portfolio', GAME_CAP: 'portfolio',
  DAILY_CAP: 'portfolio', UNDER_SHARE_CAP: 'portfolio', LEAN_CAP: 'portfolio',
  // ---- the Chief's own checks on what the specialists submitted
  INVALID_PROPOSAL: 'hard', PROPOSAL_FIELD_IGNORED: 'flag', UNKNOWN_CANDIDATE: 'hard',
} as const satisfies Record<string, ReasonClass>

export type ReasonCode = keyof typeof REASON_CLASS

export interface Reason { code: ReasonCode; detail: string }

export const reason = (code: ReasonCode, detail: string): Reason => ({ code, detail })
export const classOf = (code: ReasonCode): ReasonClass => REASON_CLASS[code]
export const isReasonCode = (x: unknown): x is ReasonCode => typeof x === 'string' && Object.prototype.hasOwnProperty.call(REASON_CLASS, x)

/** Plain-language label for every code. `Record<ReasonCode, string>` makes the compiler demand a label when a code is added. */
export const REASON_LABEL: Record<ReasonCode, string> = {
  NO_TEAM: "the player's team is unknown", NO_FRESH_PROJECTION: 'no fresh model projection', STALE_PROJECTION: 'the projection is too old', INVALID_NUMBERS: 'a number was missing or invalid',
  NO_MINUTES_DATA: 'no minutes history', LOW_MINUTES: 'too few minutes per game', NOT_TOP_BY_MINUTES: "not among the team's top players by minutes", MINUTES_DECLINE: 'minutes falling',
  THIN_HISTORY: 'too few games behind the estimate', INJURY_LISTED: 'listed on the injury report', INJURY_STATUS_UNVERIFIED: 'injury status could not be checked', IDENTITY_UNVERIFIED: 'player identity could not be verified',
  TOO_FEW_INDEPENDENT_BOOKS: 'fewer than two independent books quote both sides', NO_USABLE_QUOTES: 'no usable two-sided quote', BOOKS_DISAGREE: 'the books disagree with each other',
  NO_FRESH_QUOTE: 'no recent quote', UNVERIFIED_PRICE: 'the price could not be confirmed by a second book', STALE_LINE_SUSPECT: 'the best price looks stale', RICH_PRICE: 'the price is rich against the market',
  EXTREME_GAP: 'model and market too far apart', UNEXPLAINED_GAP: 'a big model/market gap the matchup did not explain', FORM_CONTRADICTION: 'recent games contradict the bet', MATCHUP_CONTRADICTED: 'the opponent works against it',
  RESEARCH_THIN_HISTORY: 'research only: 10 to 14 games of history', CALIBRATION_MISSING: 'research only: no calibration for this statistic', CALIBRATION_UNVALIDATED: 'research only: calibration has not passed validation',
  GAP_NEEDS_MATCHUP: 'a sizeable gap that needs a matchup reason', PUSH_RISK: 'the line can land exactly (refund)', CALIBRATION_CLAMPED: 'probability was clamped to the calibrated range', TIMESTAMP_FROM_FEED_ONLY: 'quote time comes from the whole feed', LINE_MOVEMENT_UNAVAILABLE: 'line movement is not available',
  FAILS_CONSERVATIVE_THRESHOLD: 'a raw edge that fails the conservative test', BELOW_SAM_THRESHOLD: "below Safe Sam's thresholds", BELOW_VAL_THRESHOLD: "below Value Val's thresholds", BELOW_CAT_THRESHOLD: "below Contrarian Cat's thresholds",
  CAT_NO_SPECIFIC_REASON: 'the market disagrees and nothing specific explains why', PARLAY_BELOW_EV_FLOOR: 'the parlay does not clear its value floor', PARLAY_LEG_BELOW_FLOOR: 'a leg does not clear the parlay leg floor', NOT_A_LEAN: 'not a shadow lean',
  DUPLICATE_EXPOSURE: 'a better line on the same player and stat was chosen', PLAYER_STAT_CAP: 'one strict bet per player and statistic', PLAYER_CAP: 'two strict bets per player', GAME_CAP: 'four strict bets per game',
  DAILY_CAP: 'twelve strict bets per day', UNDER_SHARE_CAP: 'too many Unders in the day', LEAN_CAP: 'the lean limit was reached',
  INVALID_PROPOSAL: 'a malformed proposal was dropped', PROPOSAL_FIELD_IGNORED: 'a proposal field was ignored', UNKNOWN_CANDIDATE: 'a proposal named a candidate that does not exist',
}
/** Labels for codes stored by older rule sets (lowercase) and for anything unknown: the raw code is shown rather than nothing. */
export const reasonLabel = (code: string): string => REASON_LABEL[code as ReasonCode] ?? REASON_LABEL[code.toUpperCase() as ReasonCode] ?? code.replace(/_/g, ' ')
