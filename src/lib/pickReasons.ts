// Why the app leans the way it does on a prop: the pick's own inputs, read side by side and turned into plain sentences.
// Every sentence restates a number the card already holds; nothing here changes a probability or an EV.
import { evidenceInfo } from './evidence.ts'
import type { Pick } from './picks.ts'
import { hitRate, projectionEdge, projectionState, type Card } from './propsBoard.ts'

export type ReasonKind = 'for' | 'against' | 'caution'
export interface PickReason { kind: ReasonKind; label: string; text: string }

const pts = (x: number) => `${Math.round(x * 100)}%`
const one = (x: number) => (Math.round(x * 10) / 10).toFixed(1)

/** Gaps smaller than these are noise and are not worth a sentence. */
const MIN_EDGE = 0.05, MIN_PROB_GAP = 0.03, MIN_HIT_GAMES = 5, MIN_TREND = 3, MIN_OPP = 0.04, HUGE_GAP = 0.15

/** Reasons for and against the lead side of a card, strongest evidence first within each kind; cautions come last. */
export function pickReasons(c: Card): PickReason[] {
  const p: Pick = c.lead
  const over = p.side === 'over'
  const side = over ? 'Over' : 'Under'
  const out: PickReason[] = []
  const add = (kind: ReasonKind, label: string, text: string) => out.push({ kind, label, text })

  // 1. The projection against the line.
  const edge = projectionEdge(p)
  if (edge != null && Math.abs(edge) >= MIN_EDGE && projectionState(p) !== 'missing')
    add(edge > 0 ? 'for' : 'against', 'Projection', `Projects ${one(p.projection)} against a line of ${p.line}: ${one(Math.abs(edge))} ${(edge > 0) === over ? 'above' : 'below'} it, ${edge > 0 ? 'in favour of' : 'against'} the ${side.toLowerCase()}.`)

  // 2. The model against the books.
  if (p.marketProb != null) {
    const d = p.modelProb - p.marketProb
    if (d >= HUGE_GAP) add('caution', 'Model vs market', `The model gives the ${side.toLowerCase()} ${pts(p.modelProb)} against ${pts(p.marketProb)} at the books. A gap this wide usually means the model is missing news, so it is not counted as support.`)
    else if (Math.abs(d) >= MIN_PROB_GAP)
      add(d > 0 ? 'for' : 'against', 'Model vs market', `The model gives the ${side.toLowerCase()} ${pts(p.modelProb)}; the books price it at ${pts(p.marketProb)}${d > 0 ? ', so the model sees more value than the market does' : ', so the market is more confident than the model'}.`)
  }

  // 3. Recent form against this line.
  const decided = p.recent.filter((v) => v !== p.line).length
  const hr = hitRate(c)
  if (decided >= MIN_HIT_GAMES && hr >= 0) {
    const landed = Math.round(hr * decided)
    if (hr >= 0.6) add('for', 'Recent form', `The ${side.toLowerCase()} landed in ${landed} of the last ${decided} games.`)
    else if (hr <= 0.4) add('against', 'Recent form', `The ${side.toLowerCase()} landed in only ${landed} of the last ${decided} games.`)
  }

  // 4. Minutes: a role that is growing helps an over and hurts an under, and the reverse.
  const r = p.role
  if (r && r.trend != null && Math.abs(r.trend) >= MIN_TREND) {
    const rising = r.trend > 0
    add(rising === over ? 'for' : 'against', 'Minutes', `${r.label}, about ${Math.round(r.min10)} minutes a game, and ${rising ? 'rising' : 'falling'} (${rising ? '+' : ''}${one(r.trend)} over the last 5 games).`)
  }

  // 5. The opponent's tendency on this statistic.
  if (p.oppFactor != null && Math.abs(p.oppFactor - 1) >= MIN_OPP) {
    const allows = p.oppFactor > 1
    add(allows === over ? 'for' : 'against', 'Opponent', `The opponent allows ${Math.round(Math.abs(p.oppFactor - 1) * 100)}% ${allows ? 'more' : 'less'} of this statistic than the league average.`)
  }

  // 6. Things that make the whole call less certain.
  if (p.injury && p.injury.status !== 'other') add('caution', 'Injury report', `Listed ${p.injury.label.toLowerCase()}${p.injury.note ? `: ${p.injury.note}` : ''}. Minutes could change.`)
  if (p.bigGap) add('caution', 'Big gap', 'The model and the market disagree widely, which usually means the model is missing news.')
  const state = projectionState(p)
  if (state === 'fallback') add('caution', 'Model', 'Uses the fallback average, not the boosted projection.')
  else if (state === 'stale') add('caution', 'Model', 'The projection is more than a day old.')
  else if (state === 'missing') add('caution', 'Model', 'There is no projection for this player.')
  if (p.basis !== 'authoritative') add('caution', 'Evidence', 'Unvalidated simple blend: the engine could not price this line.')
  else {
    const ev = evidenceInfo(p)
    if (ev.kind === 'insufficient' || ev.kind === 'research') add('caution', 'Evidence', `${ev.label}: ${ev.detail.join('; ')}.`)
  }
  if (p.push > 0.005) add('caution', 'Refund', `${pts(p.push)} chance the stat lands exactly on ${p.line} and the stake is refunded.`)

  const order: Record<ReasonKind, number> = { for: 0, against: 1, caution: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind])
}
