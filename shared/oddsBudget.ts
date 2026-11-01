// A monthly cap on The Odds API credits. Pure: no network, no clock, no storage.
// The free plan is about 500 credits a month and the cache only limits how often we fetch, not how much a month adds up to. On a deployed copy any visitor's
// page load can cause a fetch, so the cap is what stops a busy month (or a bot) from spending the whole plan.

/** Stop fetching below this many credits of the plan, so a manual refresh is still possible in the last days of the month. */
export const DEFAULT_MONTHLY_CREDITS = 450

const count = (csv: string | undefined) => (csv ?? '').split(',').map((s) => s.trim()).filter(Boolean).length

/** Credits one request costs: the events list is free; an odds request costs one per market per region. */
export function creditCost(path: string, params: Record<string, string>): number {
  if (!path.includes('/odds')) return 0
  return Math.max(1, count(params.markets)) * Math.max(1, count(params.regions))
}

/** "2026-11" for the month a credit was spent in (UTC, which is how the provider's plan resets). */
export const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7)

/** The configured monthly limit, or the default when it is missing or not a positive number. */
export function monthlyLimit(raw: string | undefined): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MONTHLY_CREDITS
}

export interface BudgetDecision { allowed: boolean; used: number; limit: number; remaining: number }

/** May a request costing `cost` go ahead, given what this month has already spent? A free request is always allowed. */
export function checkBudget(used: number, cost: number, limit: number): BudgetDecision {
  const u = Number.isFinite(used) && used > 0 ? used : 0
  return { allowed: cost === 0 || u + cost <= limit, used: u, limit, remaining: Math.max(0, limit - u) }
}
