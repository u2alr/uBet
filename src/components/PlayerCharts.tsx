import type { ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Stat } from '../../shared/baseline'
import { STAT_LABEL } from '../lib/format'
import {
  byOpponent, distribution, shootingTrend, split, trend, type GameRow,
} from '../lib/stats'

const C = { grid: '#262626', axis: '#525252', bar: '#737373', hi: '#e5e5e5', mid: '#a3a3a3', lo: '#525252' }
const tooltip = {
  cursor: { fill: '#262626' },
  contentStyle: { background: '#171717', border: '1px solid #262626', borderRadius: 6, fontSize: 12 },
}
const axis = { stroke: C.axis, tickLine: false, fontSize: 11 } as const

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
  const t = trend(games, stat)
  const ref = line != null && !Number.isNaN(line)
    ? <ReferenceLine y={line} stroke={C.hi} strokeDasharray="4 4" />
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
        <Card title={`${label} per game`} note="bars = game · line = 5-game avg">
          <ComposedChart data={t}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" {...axis} />
            <YAxis {...axis} axisLine={false} />
            <Tooltip {...tooltip} />
            <Bar dataKey="value" name={label} fill={C.bar} radius={[2, 2, 0, 0]} />
            <Line dataKey="rolling" name="5-game avg" stroke={C.hi} dot={false} strokeWidth={2} />
            {ref}
          </ComposedChart>
        </Card>
      </div>

      <Card title="Minutes" note="usage drives volume">
        <LineChart data={t}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="date" {...axis} />
          <YAxis {...axis} axisLine={false} domain={['dataMin - 4', 'dataMax + 4']} />
          <Tooltip {...tooltip} />
          <Line dataKey="minutes" stroke={C.mid} dot={{ r: 2, fill: C.mid }} strokeWidth={1.5} />
        </LineChart>
      </Card>

      <Card title="Shooting %" note="last 30 games">
        <LineChart data={shootingTrend(games)}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="date" {...axis} />
          <YAxis {...axis} axisLine={false} unit="%" />
          <Tooltip {...tooltip} formatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line dataKey="fg" name="FG" stroke={C.hi} dot={false} connectNulls />
          <Line dataKey="three" name="3P" stroke={C.mid} dot={false} connectNulls strokeDasharray="4 3" />
          <Line dataKey="ft" name="FT" stroke={C.lo} dot={false} connectNulls />
        </LineChart>
      </Card>

      <Card title={`${label} splits`} note="average in each situation">
        <BarChart data={splits} layout="vertical" margin={{ left: 16 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" {...axis} axisLine={false} />
          <YAxis type="category" dataKey="label" {...axis} width={60} />
          <Tooltip {...tooltip} formatter={(v, _n, p) => [`${v} (${p.payload.games} games)`, label]} />
          <Bar dataKey="avg" fill={C.bar} radius={[0, 2, 2, 0]} />
        </BarChart>
      </Card>

      <Card title={`${label} distribution`} note="how often each total happened">
        <BarChart data={dist}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="value" {...axis} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} />
          <Tooltip {...tooltip} />
          <Bar dataKey="count" name="games" fill={C.bar} radius={[2, 2, 0, 0]} />
          {line != null && !Number.isNaN(line) && <ReferenceLine x={Math.round(line)} stroke={C.hi} strokeDasharray="4 4" />}
        </BarChart>
      </Card>

      <div className="lg:col-span-2">
        <Card title={`${label} by opponent`} note="avg vs each team (small samples)" h="h-64">
          <BarChart data={opp}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="opp" {...axis} interval={0} />
            <YAxis {...axis} axisLine={false} />
            <Tooltip {...tooltip} formatter={(v, _n, p) => [`${v} (${p.payload.games} games)`, label]} />
            <Bar dataKey="avg" fill={C.bar} radius={[2, 2, 0, 0]} />
          </BarChart>
        </Card>
      </div>
    </div>
  )
}
