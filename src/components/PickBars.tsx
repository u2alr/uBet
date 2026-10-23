import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { INK, STAT_COLOR } from '../lib/colors'
import { STAT_LABEL } from '../lib/format'
import type { Stat } from '../../shared/baseline'
import type { SparkInput } from './PickSpark'

type Pick = SparkInput
const landed = (p: Pick, v: number) => (p.side === 'over' ? v > p.line : v < p.line)
const color = (p: Pick) => STAT_COLOR[p.stat as Stat] ?? INK.reference
const fill = (p: Pick, v: number) => (landed(p, v) ? color(p) : INK.miss)

// Kept apart from PickSpark so the charting library loads only when a card is opened.
/** The same games large, with each value labelled, for the row that opens under a pick. */
export default function PickBars({ p }: { p: Pick }) {
  const hits = p.recent.filter((v) => landed(p, v)).length
  const avg = p.recent.length ? p.recent.reduce((a, b) => a + b, 0) / p.recent.length : null
  return (
    <div className="px-3 py-2">
      <div className="mb-1 flex flex-wrap gap-x-4 text-[11px] text-neutral-500">
        <span>{p.player} · last {p.recent.length} games, oldest to newest</span>
        <span>{hits} of {p.recent.length} landed {p.side} {p.line} {STAT_LABEL[p.stat] ?? p.stat}</span>
        {avg != null && <span>average {avg.toFixed(1)}</span>}
        {p.projection != null && <span>projection {p.projection.toFixed(1)}</span>}
      </div>
      <div className="h-32 max-w-2xl">
        <ResponsiveContainer>
          <BarChart data={p.recent.map((v, i) => ({ i: i + 1, v }))} margin={{ top: 14, right: 8, bottom: 0, left: -24 }}>
            <XAxis dataKey="i" stroke={INK.axis} tick={{ fill: INK.legend, fontSize: 10 }} tickLine={false} />
            <YAxis stroke={INK.axis} tick={{ fill: INK.legend, fontSize: 10 }} tickLine={false} domain={[0, Math.ceil(Math.max(p.line, ...p.recent, p.projection ?? 0) * 1.15)]} />
            <ReferenceLine y={p.line} stroke={INK.reference} strokeDasharray="4 3" label={{ value: `line ${p.line}`, fill: INK.legend, fontSize: 10, position: 'insideTopRight' }} />
            {p.projection != null && <ReferenceLine y={p.projection} stroke={color(p)} strokeDasharray="1 3" />}
            <Bar dataKey="v" radius={[2, 2, 0, 0]} animationDuration={600}>
              {p.recent.map((v, i) => <Cell key={i} fill={fill(p, v)} />)}
              <LabelList dataKey="v" position="top" fill={INK.legend} fontSize={10} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
