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
