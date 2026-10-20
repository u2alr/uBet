import Headshot from './Headshot'
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { INK, STAT_COLOR } from '../lib/colors'
import { STAT_LABEL, api, fmt, pct } from '../lib/format'
import type { PicksMeta } from '../../shared/picks.ts'
import { pickKey, type Pick } from '../lib/picks'
import Notices from './Notices'
import { RiskBadge, SlipButton } from './PickTable'

interface TeamPlayer {
  id: number; name: string; games: number; min: number; pts: number; reb: number; ast: number; fg3m: number
  recent: { pts: number[] }
}
interface Team { abbr: string; name: string; score: string; players: TeamPlayer[] }
interface BookOdds {
  key: string; title: string
  moneyline?: { home: number; away: number }
  spread?: { point: number; home: number; away: number }
  total?: { point: number; over: number; under: number }
}
interface GameOdds {
  books: BookOdds[]
  summary: { spread: number | null; total: number | null; homeWinProb: number | null; bestMoneyline: { home: number; away: number } | null }
}
interface Detail {
  meta?: PicksMeta
  odds: GameOdds | null
  game: { id: string; date: string; status: string; state: 'pre' | 'in' | 'post' }
  configured: boolean
  teams: Team[]
  picks: Pick[]
  teamPicks: Record<string, Pick[]>
}

// A recent game 'landed' if it ended on the side the pick bets on.
const landed = (p: Pick, v: number) => (p.side === 'over' ? v > p.line : v < p.line)
const tip = {
  cursor: { fill: '#262626' },
  contentStyle: { background: '#171717', border: '1px solid #262626', borderRadius: 6, fontSize: 12 },
}
const last = (n: string) => n.split(' ').slice(-1)[0]

export default function GameDetail({ refreshKey, gameId, onBack, onOpenPlayer }: {
  refreshKey: number; gameId: string; onBack: () => void; onOpenPlayer: (id: number) => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<Detail>(`/games/${gameId}${refreshKey ? '?fresh=1' : ''}`).then(setD).catch((e) => setError(e.message))
  }, [gameId, refreshKey])

  const back = <button className="text-sm text-neutral-500 hover:text-neutral-300" onClick={onBack}>← Games</button>
  if (error) return <div className="space-y-4">{back}<p className="text-sm text-neutral-500">{error}</p></div>
  if (!d) return <div className="space-y-4">{back}<p className="text-sm text-neutral-500">Loading…</p></div>

  const [away, home] = d.teams
  const when = new Date(d.game.date).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="space-y-8">
      {back}
      <header>
        <h2 className="text-xl text-neutral-100">{away.name} <span className="text-neutral-600">@</span> {home.name}</h2>
        <p className="text-sm text-neutral-500">{d.game.state === 'pre' ? when : `${away.score}–${home.score} · ${d.game.status}`}</p>
      </header>

      <TeamOdds odds={d.odds} configured={d.configured} home={home} away={away} />

      <section>
        <h3 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">Suggested bets</h3>
        {d.configured && <Notices meta={d.meta ?? null} />}
        {!d.configured ? (
          <Note>Add an <code className="text-neutral-300">ODDS_API_KEY</code> to <code className="text-neutral-300">.dev.vars</code> to see lines and picks.</Note>
        ) : d.picks.length === 0 ? (
          <Note>No prop lines for this game yet, or none of its players are synced.</Note>
        ) : (
          <div className="space-y-6">
            {d.teams.map((t) => {
              const list = d.teamPicks[t.abbr] ?? []
              if (list.length === 0) return null
              return (
                <div key={t.abbr}>
                  <div className="mb-2 text-sm text-neutral-400">{t.name}</div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((p) => (
              <div key={pickKey(p)} className="rounded-lg bg-neutral-900 p-4">
                <div className="flex items-center justify-between">
                  <button className="flex items-center gap-2 text-neutral-100 hover:underline" onClick={() => onOpenPlayer(p.playerId)}>
                    <Headshot id={p.playerId} name={p.player} size={56} />{p.player}
                  </button>
                  <span className="flex items-center gap-2">
                    <RiskBadge risk={p.risk} />
                    <span className="text-sm tabular-nums text-neutral-100">{p.ev > 0 ? '+' : ''}{(p.ev * 100).toFixed(1)}% EV</span>
                    <SlipButton pick={p} />
                  </span>
                </div>
                <div className="text-sm text-neutral-400">
                  {p.side === 'over' ? 'Over' : 'Under'} {p.line} {STAT_LABEL[p.stat]} · {p.price.toFixed(2)}{' '}
                  <span className="text-neutral-600">{p.book}</span>
                </div>
                <div className="mt-3 h-24">
                  <ResponsiveContainer>
                    <BarChart data={p.recent.map((v, i) => ({ i: i + 1, v }))}>
                      <XAxis dataKey="i" hide />
                      <YAxis hide domain={[0, 'dataMax + 2']} />
                      <Tooltip {...tip} formatter={(v) => [v, STAT_LABEL[p.stat]]} labelFormatter={() => 'Recent game'} />
                      <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                        {p.recent.map((v, i) => <Cell key={i} fill={landed(p, v) ? STAT_COLOR[p.stat] : INK.miss} />)}
                      </Bar>
                      <ReferenceLine y={p.line} stroke={INK.reference} strokeDasharray="3 3" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex justify-between text-xs text-neutral-500">
                  <span>Proj {fmt(p.projection)}</span>
                  <span>{p.side === 'over' ? 'Over' : 'Under'} last 10: {pct(p.hitRate10)}</span>
                  <span>Chance {pct(p.prob)} (model {pct(p.modelProb)}, market {pct(p.marketProb)})</span>
                </div>
              </div>
            ))}
                  </div>
                </div>
              )
            })}
            {(() => {
              const placed = new Set(d.teams.flatMap((t) => (d.teamPicks[t.abbr] ?? []).map((p) => p.playerId)))
              const rest = d.picks.filter((p) => !placed.has(p.playerId))
              return rest.length > 0 && (
                <div>
                  <div className="mb-2 text-sm text-neutral-400">Other</div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {rest.map((p) => (
              <div key={pickKey(p)} className="rounded-lg bg-neutral-900 p-4">
                <div className="flex items-center justify-between">
                  <button className="flex items-center gap-2 text-neutral-100 hover:underline" onClick={() => onOpenPlayer(p.playerId)}>
                    <Headshot id={p.playerId} name={p.player} size={56} />{p.player}
                  </button>
                  <span className="flex items-center gap-2">
                    <RiskBadge risk={p.risk} />
                    <span className="text-sm tabular-nums text-neutral-100">{p.ev > 0 ? '+' : ''}{(p.ev * 100).toFixed(1)}% EV</span>
                    <SlipButton pick={p} />
                  </span>
                </div>
                <div className="text-sm text-neutral-400">
                  {p.side === 'over' ? 'Over' : 'Under'} {p.line} {STAT_LABEL[p.stat]} · {p.price.toFixed(2)}{' '}
                  <span className="text-neutral-600">{p.book}</span>
                </div>
                <div className="mt-3 h-24">
                  <ResponsiveContainer>
                    <BarChart data={p.recent.map((v, i) => ({ i: i + 1, v }))}>
                      <XAxis dataKey="i" hide />
                      <YAxis hide domain={[0, 'dataMax + 2']} />
                      <Tooltip {...tip} formatter={(v) => [v, STAT_LABEL[p.stat]]} labelFormatter={() => 'Recent game'} />
                      <Bar dataKey="v" radius={[2, 2, 0, 0]}>
                        {p.recent.map((v, i) => <Cell key={i} fill={landed(p, v) ? STAT_COLOR[p.stat] : INK.miss} />)}
                      </Bar>
                      <ReferenceLine y={p.line} stroke={INK.reference} strokeDasharray="3 3" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex justify-between text-xs text-neutral-500">
                  <span>Proj {fmt(p.projection)}</span>
                  <span>{p.side === 'over' ? 'Over' : 'Under'} last 10: {pct(p.hitRate10)}</span>
                  <span>Chance {pct(p.prob)} (model {pct(p.modelProb)}, market {pct(p.marketProb)})</span>
                </div>
              </div>
            ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </section>

      {d.teams.map((t) => (
        <section key={t.abbr} className="space-y-4">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500">{t.name} · last 10 games</h3>
          {t.players.length === 0 ? (
            <Note>No synced players for {t.abbr}. Run <code className="text-neutral-300">ingest/sync.py --all-active</code>.</Note>
          ) : (
            <>
              <div className="h-60 rounded-lg bg-neutral-900 p-4">
                <ResponsiveContainer>
                  <BarChart data={t.players.map((p) => ({ name: last(p.name), PTS: +p.pts.toFixed(1), REB: +p.reb.toFixed(1), AST: +p.ast.toFixed(1) }))}>
                    <CartesianGrid stroke={INK.grid} vertical={false} />
                    <XAxis dataKey="name" stroke={INK.axis} tickLine={false} fontSize={11} interval={0} />
                    <YAxis stroke={INK.axis} tickLine={false} axisLine={false} fontSize={11} />
                    <Tooltip {...tip} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: INK.legend }}>{v}</span>} />
                    <Bar dataKey="PTS" fill={STAT_COLOR.pts} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="REB" fill={STAT_COLOR.reb} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="AST" fill={STAT_COLOR.ast} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-x-auto rounded-lg bg-neutral-900">
                <table className="w-full whitespace-nowrap text-sm">
                  <thead className="text-xs text-neutral-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-normal">Player</th>
                      <th className="px-2 py-2 text-right font-normal">MIN</th>
                      <th className="px-2 py-2 text-right font-normal">PTS</th>
                      <th className="px-2 py-2 text-right font-normal">REB</th>
                      <th className="px-2 py-2 text-right font-normal">AST</th>
                      <th className="px-2 py-2 text-right font-normal">3PM</th>
                      <th className="px-4 py-2 text-right font-normal">PTS trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {t.players.map((p) => (
                      <tr key={p.id} className="hover:bg-neutral-800/60">
                        <td className="px-4 py-2">
                          <button className="flex items-center gap-2 text-neutral-100 hover:underline" onClick={() => onOpenPlayer(p.id)}>
                            <Headshot id={p.id} name={p.name} />{p.name}
                          </button>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-neutral-400">{fmt(p.min, 0)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-neutral-100">{fmt(p.pts)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(p.reb)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(p.ast)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt(p.fg3m)}</td>
                        <td className="px-4 py-2">
                          <div className="ml-auto h-6 w-24">
                            <ResponsiveContainer>
                              <BarChart data={p.recent.pts.map((v, i) => ({ i, v }))}>
                                <YAxis hide domain={[0, 'dataMax']} />
                                <Bar dataKey="v" fill={STAT_COLOR.pts} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-neutral-900 px-4 py-6 text-sm text-neutral-500">{children}</p>
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

function TeamOdds({ odds, configured, home, away }: { odds: GameOdds | null; configured: boolean; home: Team; away: Team }) {
  if (!configured) return null
  if (!odds || odds.books.length === 0)
    return (
      <section>
        <h3 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">Game odds</h3>
        <Note>No team odds posted for this game yet.</Note>
      </section>
    )

  const { summary: s, books } = odds
  const best = (vals: (number | undefined)[]) => Math.max(...vals.filter((v): v is number => v != null))
  const bestHomeML = best(books.map((b) => b.moneyline?.home))
  const bestAwayML = best(books.map((b) => b.moneyline?.away))
  const bestOver = best(books.map((b) => b.total?.over))
  const bestUnder = best(books.map((b) => b.total?.under))
  const bestHomeSp = best(books.map((b) => b.spread?.home))
  const bestAwaySp = best(books.map((b) => b.spread?.away))
  const hot = (v: number | undefined, top: number) => (v === top ? 'text-neutral-100 font-medium' : 'text-neutral-400')
  const cell = (v: number | undefined, top: number) => <td className={`px-2 py-2 text-right tabular-nums ${hot(v, top)}`}>{v?.toFixed(2) ?? '–'}</td>
  const prob = s.homeWinProb

  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-widest text-neutral-500">Game odds</h3>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-neutral-800 text-center">
        <div className="bg-neutral-900 py-4">
          <div className="text-xs uppercase tracking-widest text-neutral-500">Spread</div>
          <div className="text-xl tabular-nums text-neutral-100">{s.spread != null ? `${home.abbr} ${signed(s.spread)}` : '–'}</div>
        </div>
        <div className="bg-neutral-900 py-4">
          <div className="text-xs uppercase tracking-widest text-neutral-500">Total</div>
          <div className="text-xl tabular-nums text-neutral-100">{s.total ?? '–'}</div>
        </div>
        <div className="bg-neutral-900 py-4">
          <div className="text-xs uppercase tracking-widest text-neutral-500">Win prob</div>
          <div className="text-xl tabular-nums text-neutral-100">
            {prob != null ? `${away.abbr} ${Math.round((1 - prob) * 100)} · ${home.abbr} ${Math.round(prob * 100)}` : '–'}
          </div>
        </div>
      </div>

      {prob != null && (
        <div className="flex h-1.5 overflow-hidden rounded bg-neutral-800">
          <div className="bg-neutral-500" style={{ width: `${(1 - prob) * 100}%` }} />
          <div className="bg-neutral-200" style={{ width: `${prob * 100}%` }} />
        </div>
      )}

      <div className="overflow-x-auto rounded-lg bg-neutral-900">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th rowSpan={2} className="px-4 py-2 text-left align-bottom font-normal">Book</th>
              <th colSpan={2} className="px-2 pt-2 text-center font-normal">Moneyline</th>
              <th colSpan={3} className="px-2 pt-2 text-center font-normal">Spread ({home.abbr})</th>
              <th colSpan={3} className="px-2 pt-2 text-center font-normal">Total</th>
            </tr>
            <tr>
              <th className="px-2 pb-2 text-right font-normal">{away.abbr}</th>
              <th className="px-2 pb-2 text-right font-normal">{home.abbr}</th>
              <th className="px-2 pb-2 text-right font-normal">Line</th>
              <th className="px-2 pb-2 text-right font-normal">{away.abbr}</th>
              <th className="px-2 pb-2 text-right font-normal">{home.abbr}</th>
              <th className="px-2 pb-2 text-right font-normal">Line</th>
              <th className="px-2 pb-2 text-right font-normal">Over</th>
              <th className="px-2 pb-2 text-right font-normal">Under</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {books.map((b) => (
              <tr key={b.key} className="hover:bg-neutral-800/60">
                <td className="px-4 py-2 text-neutral-200">{b.title}</td>
                {cell(b.moneyline?.away, bestAwayML)}
                {cell(b.moneyline?.home, bestHomeML)}
                <td className="px-2 py-2 text-right tabular-nums text-neutral-400">{b.spread ? signed(b.spread.point) : '–'}</td>
                {cell(b.spread?.away, bestAwaySp)}
                {cell(b.spread?.home, bestHomeSp)}
                <td className="px-2 py-2 text-right tabular-nums text-neutral-400">{b.total?.point ?? '–'}</td>
                {cell(b.total?.over, bestOver)}
                {cell(b.total?.under, bestUnder)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-600">Decimal odds. Brightest number in each column is the best price. Win probability has the bookmaker margin removed.</p>
    </section>
  )
}
