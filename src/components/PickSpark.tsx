import { memo } from 'react'
import { INK, STAT_COLOR } from '../lib/colors'
import type { Stat } from '../../shared/baseline'

/** What the graphs need from a bet: a pick from the odds feed fits, and so does a saved mind leg. */
export interface SparkInput { recent: number[]; line: number; side: string; stat: string; player: string; projection?: number | null }
type Pick = SparkInput

// A recent game "landed" if it ended on the side the pick bets on. A tie on a whole-number line is a refund, so it is neither.
const landed = (p: Pick, v: number) => (p.side === 'over' ? v > p.line : v < p.line)
const color = (p: Pick) => STAT_COLOR[p.stat as Stat] ?? INK.reference
const fill = (p: Pick, v: number) => (landed(p, v) ? color(p) : INK.miss)

/** Last games as small bars against the line: bright bars cleared it for this side. Plain SVG, so a table of 80 stays cheap. */
export const PickSpark = memo(function PickSpark({ p, w = 92, h = 26 }: { p: Pick; w?: number; h?: number }) {
  const n = p.recent.length
  if (n === 0) return <span className="text-neutral-700">–</span>
  const top = Math.max(p.line, ...p.recent) * 1.1 || 1
  const slot = w / n
  const bw = Math.max(1, slot - 1)
  const y = (v: number) => h - (Math.max(0, v) / top) * h
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Last ${n} games against ${p.line}`}>
      {p.recent.map((v, i) => <rect key={i} x={i * slot} y={y(v)} width={bw} height={Math.max(1, h - y(v))} fill={fill(p, v)} />)}
      <line x1={0} x2={w} y1={y(p.line)} y2={y(p.line)} stroke={INK.reference} strokeOpacity={0.7} strokeDasharray="2 2" />
    </svg>
  )
})
