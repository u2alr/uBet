import type { ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Stat } from '../../shared/baseline'
import { INK, MINUTES_COLOR, SHOOTING_COLOR, STAT_COLOR } from '../lib/colors'
import { STAT_LABEL } from '../lib/format'
import {
  byOpponent, distribution, shootingTrend, split, trend, type GameRow,
} from '../lib/stats'

const tooltip = {
  cursor: { fill: '#262626' },
  contentStyle: { background: '#171717', border: '1px solid #262626', borderRadius: 6, fontSize: 12 },
  itemStyle: { color: INK.tooltip }, // text stays neutral; the colour lives on the marks
  labelStyle: { color: INK.legend },
}
const axis = { stroke: INK.axis, tickLine: false, fontSize: 11 } as const

function Card({ title, note, children, h = 'h-56' }: { title: string; note?: string; children: ReactNode; h?: string }) {
  return (
    <div className="rounded-lg bg-neutral-900 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">{title}</h3>
        {note && <span className="text-xs text-neutral-600">{note}</span>}
      </div>
      <div className={h}>
        <ResponsiveContainer>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </div>
  )
}

export default function PlayerCharts({ games, stat, line }: { games: GameRow[]; stat: Stat; line: number | null }) {
  const label = STAT_LABEL[stat]
  const color = STAT_COLOR[stat]
  const hasLine = line != null && !Number.isNaN(line)
  const t = trend(games, stat)
  const ref = line != null && !Number.isNaN(line)
    ? <ReferenceLine y={line} stroke={INK.reference} strokeDasharray="4 4" />
    : null

  const homeAway = split(games, stat, [['Home', (g) => !!g.home], ['Away', (g) => !g.home]])
  const winLoss = split(games, stat, [['Win', (g) => !!g.won], ['Loss', (g) => !g.won]])
  const rest = split(games, stat, [['30+ min', (g) => g.minutes >= 30], ['<30 min', (g) => g.minutes < 30]])
  const splits = [...homeAway, ...winLoss, ...rest]
  const opp = byOpponent(games, stat)
  const dist = distribution(games, stat)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <Card title={`${label} per game`} note={hasLine ? 'bright bars cleared your line · white line = 5-game avg' : 'bars = game · white line = 5-game avg'}>
          <ComposedChart data={t}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="date" {...axis} />
            <YAxis {...axis} axisLine={false} />
            <Tooltip {...tooltip} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: INK.legend }}>{v}</span>} />
            <Bar dataKey="value" name={label} fill={color} radius={[3, 3, 0, 0]}>
              {t.map((g, i) => <Cell key={i} fill={!hasLine || g.value > (line as number) ? color : INK.miss} />)}
            </Bar>
            <Line dataKey="rolling" name="5-game avg" stroke={INK.reference} dot={false} strokeWidth={2} />
            {ref}
          </ComposedChart>
        </Card>
      </div>

      <Card title="Minutes" note="usage drives volume">
        <LineChart data={t}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="date" {...axis} />
          <YAxis {...axis} axisLine={false} domain={['dataMin - 4', 'dataMax + 4']} />
          <Tooltip {...tooltip} />
          <Line dataKey="minutes" stroke={MINUTES_COLOR} dot={{ r: 2.5, fill: MINUTES_COLOR, stroke: '#171717', strokeWidth: 1 }} strokeWidth={2} />
        </LineChart>
      </Card>

      <Card title="Shooting %" note="last 30 games">
        <LineChart data={shootingTrend(games)}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="date" {...axis} />
          <YAxis {...axis} axisLine={false} unit="%" />
          <Tooltip {...tooltip} formatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: INK.legend }}>{v}</span>} />
          <Line dataKey="fg" name="FG" stroke={SHOOTING_COLOR.fg} strokeWidth={2} dot={false} connectNulls />
          <Line dataKey="three" name="3P" stroke={SHOOTING_COLOR.three} strokeWidth={2} dot={false} connectNulls />
          <Line dataKey="ft" name="FT" stroke={SHOOTING_COLOR.ft} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </Card>

      <Card title={`${label} splits`} note="average in each situation">
        <BarChart data={splits} layout="vertical" margin={{ left: 16 }}>
          <CartesianGrid stroke={INK.grid} horizontal={false} />
          <XAxis type="number" {...axis} axisLine={false} />
          <YAxis type="category" dataKey="label" {...axis} width={60} />
          <Tooltip {...tooltip} formatter={(v, _n, p) => [`${v} (${p.payload.games} games)`, label]} />
          <Bar dataKey="avg" radius={[0, 3, 3, 0]}>
            {splits.map((_, i) => <Cell key={i} fill={color} fillOpacity={i % 2 === 0 ? 1 : 0.5} />)}
          </Bar>
        </BarChart>
      </Card>

      <Card title={`${label} distribution`} note="how often each total happened">
        <BarChart data={dist}>
          <CartesianGrid stroke={INK.grid} vertical={false} />
          <XAxis dataKey="value" {...axis} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} />
          <Tooltip {...tooltip} />
          <Bar dataKey="count" name="games" radius={[3, 3, 0, 0]}>
            {dist.map((d, i) => <Cell key={i} fill={!hasLine || d.value > (line as number) ? color : INK.miss} />)}
          </Bar>
          {hasLine && <ReferenceLine x={Math.round(line as number)} stroke={INK.reference} strokeDasharray="4 4" />}
        </BarChart>
      </Card>

      <div className="lg:col-span-2">
        <Card title={`${label} by opponent`} note="avg vs each team (small samples)" h="h-64">
          <BarChart data={opp}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="opp" {...axis} interval={0} />
            <YAxis {...axis} axisLine={false} />
            <Tooltip {...tooltip} formatter={(v, _n, p) => [`${v} (${p.payload.games} games)`, label]} />
            <Bar dataKey="avg" fill={color} radius={[3, 3, 0, 0]} />
          </BarChart>
        </Card>
      </div>
    </div>
  )
}
