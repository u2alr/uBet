import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { INK, MIND_COLOR, STAT_COLOR } from '../lib/colors'
import type { Stat } from '../../shared/baseline'
import { STAT_LABEL } from '../lib/format'

interface Bet { id: number; mind: string; kind: string; odds: number; prob: number; ev: number; status: string }
interface Leg { betId: number; player: string; stat: string; side: string; line: number; price: number; modelProb: number | null; marketProb: number | null }

const NAMES: Record<string, string> = { sam: 'Safe Sam', val: 'Value Val', lou: 'Longshot Lou', cat: 'Contrarian Cat', control: 'Control' }
const ORDER = ['sam', 'val', 'lou', 'cat', 'control']
const STAT_ORDER: Stat[] = ['pts', 'reb', 'ast', 'fg3m']
const tip = { background: '#171717', border: '1px solid #262626', color: INK.tooltip, fontSize: 12 }
const axis = { stroke: INK.axis, tick: { fill: INK.legend, fontSize: 11 } }

function Panel({ title, note, children, empty }: { title: string; note?: string; children: React.ReactNode; empty?: string }) {
  return (
    <div className="rounded-lg bg-neutral-900 p-3">
      <h3 className="text-sm text-neutral-300">{title}</h3>
      {note && <p className="mb-1 text-[11px] text-neutral-500">{note}</p>}
      {empty ? <p className="py-8 text-center text-xs text-neutral-500">{empty}</p> : <div className="h-52">{children}</div>}
    </div>
  )
}

export default function MindsCharts({ bets, legs, pick }: { bets: Bet[]; legs: Leg[]; pick: string | null }) {
  const dim = (m: string) => (pick && pick !== m ? 0.15 : 0.85)
  const byBet = new Map(bets.map((b) => [b.id, b]))

  // 1. Each bet by its payout and the chance we gave it: a mind's style is where its dots sit.
  const style = ORDER.map((m) => ({
    m, data: bets.filter((b) => b.mind === m).map((b) => ({ odds: Number(b.odds.toFixed(2)), prob: Number((b.prob * 100).toFixed(1)), n: b.kind === 'combo' ? 'combo' : 'single' })),
  }))

  // 2. Every leg: our model against the market. Off the diagonal is where the mind thinks it knows better.
  const disagreement = ORDER.map((m) => ({
    m, data: legs.filter((l) => byBet.get(l.betId)?.mind === m && l.modelProb != null && l.marketProb != null)
      .map((l) => ({ market: Number((l.marketProb! * 100).toFixed(1)), model: Number((l.modelProb! * 100).toFixed(1)), name: `${l.player} ${l.side === 'over' ? 'O' : 'U'} ${l.line} ${STAT_LABEL[l.stat] ?? l.stat}` })),
  }))

  // 3. What each mind bets on.
  const mix = ORDER.map((m) => {
    const ls = legs.filter((l) => byBet.get(l.betId)?.mind === m)
    const row: Record<string, number | string> = { mind: NAMES[m], under: ls.filter((l) => l.side === 'under').length, over: ls.filter((l) => l.side === 'over').length }
    for (const s of STAT_ORDER) row[s] = ls.filter((l) => l.stat === s).length
    return row
  })

  // 4. Does "60%" win 60% of the time? Only settled bets can say.
  const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost')
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.01]
  const calib = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]
    const inBin = settled.filter((b) => b.prob >= lo && b.prob < hi)
    return inBin.length ? {
      bin: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: inBin.length,
      said: Number((inBin.reduce((a, b) => a + b.prob, 0) / inBin.length * 100).toFixed(1)),
      got: Number((inBin.filter((b) => b.status === 'won').length / inBin.length * 100).toFixed(1)),
    } : null
  }).filter((x): x is NonNullable<typeof x> => x !== null)

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Panel title="Style map" note="Each dot is a bet: payout against the win chance we gave it." empty={bets.length ? undefined : 'No bets yet.'}>
        <ResponsiveContainer>
          <ScatterChart margin={{ left: -10, right: 10, top: 5 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis type="number" dataKey="odds" name="Payout" unit="x" scale="log" domain={['auto', 'auto']} {...axis} />
            <YAxis type="number" dataKey="prob" name="Chance" unit="%" domain={[0, 100]} {...axis} />
            <ZAxis range={[40, 40]} />
            <Tooltip contentStyle={tip} cursor={{ stroke: INK.axis }} />
            <Legend wrapperStyle={{ fontSize: 12, color: INK.legend }} />
            {style.filter((s) => s.data.length).map((s) => <Scatter isAnimationActive={false} key={s.m} name={NAMES[s.m]} data={s.data} fill={MIND_COLOR[s.m]} fillOpacity={dim(s.m)} />)}
          </ScatterChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Model vs market" note="Each dot is a leg. On the line: we agree with the books. Above it: we like it more than they do."
        empty={disagreement.some((d) => d.data.length) ? undefined : 'No legs yet.'}>
        <ResponsiveContainer>
          <ScatterChart margin={{ left: -10, right: 10, top: 5 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis type="number" dataKey="market" name="Market" unit="%" domain={[0, 100]} {...axis} />
            <YAxis type="number" dataKey="model" name="Model" unit="%" domain={[0, 100]} {...axis} />
            <ZAxis range={[40, 40]} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke={INK.reference} strokeDasharray="4 4" strokeOpacity={0.5} />
            <Tooltip contentStyle={tip} cursor={{ stroke: INK.axis }} formatter={(v, n) => [`${v}%`, n]} labelFormatter={() => ''} />
            {disagreement.filter((s) => s.data.length).map((s) => <Scatter isAnimationActive={false} key={s.m} name={NAMES[s.m]} data={s.data} fill={MIND_COLOR[s.m]} fillOpacity={dim(s.m)} />)}
          </ScatterChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="What they bet on" note="Legs per mind by statistic. Under/Over split in the labels." empty={legs.length ? undefined : 'No legs yet.'}>
        <ResponsiveContainer>
          <BarChart data={mix.map((r) => ({ ...r, mind: `${r.mind} (${r.under}U/${r.over}O)` }))} margin={{ left: -20, right: 10, top: 5 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="mind" interval={0} {...axis} tick={{ fill: INK.legend, fontSize: 10 }} />
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff10' }} />
            <Legend wrapperStyle={{ fontSize: 12, color: INK.legend }} formatter={(v: string) => STAT_LABEL[v] ?? v} />
            {STAT_ORDER.map((s) => <Bar isAnimationActive={false} key={s} dataKey={s} name={s} stackId="a" fill={STAT_COLOR[s]} stroke="#171717" strokeWidth={1} />)}
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Calibration" note="When we say 60%, do they win 60% of the time? Needs settled bets."
        empty={calib.length ? undefined : `No settled bets yet (${bets.filter((b) => b.status === 'open').length} open).`}>
        <ResponsiveContainer>
          <BarChart data={calib} margin={{ left: -20, right: 10, top: 5 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="bin" {...axis} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} {...axis} />
            <Tooltip contentStyle={tip} cursor={{ fill: '#ffffff10' }} formatter={(v, n) => [`${v}%`, n]} labelFormatter={(l, p) => `${l} (${p?.[0]?.payload?.n ?? 0} bets)`} />
            <Legend wrapperStyle={{ fontSize: 12, color: INK.legend }} />
            <Bar isAnimationActive={false} dataKey="said" name="Said" fill={INK.legend} radius={[3, 3, 0, 0]} />
            <Bar isAnimationActive={false} dataKey="got" name="Got" fill={STAT_COLOR.pts} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  )
}
