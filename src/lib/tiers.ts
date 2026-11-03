import { TIER_MIN, type TierKey } from '../../shared/seasonReview.ts'

/**
 * Who we think wins and how sure we are, in words and colors, shared by the Teams and Review pages. This is the likelier winner, which is a different question from which bet is
 * good value, so green (which means value) is not used: heavy is violet, clear is sky blue, slight is amber, a toss-up is grey. Full class names, so Tailwind can see them.
 */
export const TIERS = [
  { key: 'heavy' as TierKey, min: TIER_MIN.heavy, label: 'Heavy favourite', short: 'Heavy', range: '78% and up', bar: 'bg-violet-500', text: 'text-violet-400', tint: 'bg-violet-500/10 ring-1 ring-violet-500/60', badge: 'bg-violet-500' },
  { key: 'clear' as TierKey, min: TIER_MIN.clear, label: 'Clear favourite', short: 'Clear', range: '65 to 78%', bar: 'bg-sky-400', text: 'text-sky-400', tint: 'bg-sky-400/10 ring-1 ring-sky-400/60', badge: 'bg-sky-400' },
  { key: 'slight' as TierKey, min: TIER_MIN.slight, label: 'Slight favourite', short: 'Slight', range: '56 to 65%', bar: 'bg-amber-400', text: 'text-amber-400', tint: 'bg-amber-400/10 ring-1 ring-amber-400/60', badge: 'bg-amber-400' },
  { key: 'tossup' as TierKey, min: 0, label: 'Toss-up', short: 'Toss-up', range: 'under 56%', bar: 'bg-neutral-500', text: 'text-neutral-400', tint: 'bg-neutral-500/10 ring-1 ring-neutral-500/60', badge: 'bg-neutral-400' },
] as const
export const tierOf = (p: number) => TIERS.find((x) => p >= x.min) ?? TIERS[TIERS.length - 1]
export const tierByKey = (k: TierKey) => TIERS.find((x) => x.key === k)!
