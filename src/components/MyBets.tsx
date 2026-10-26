import { useEffect, useState } from 'react'
import type { MyBetTotals } from '../../shared/mybets.ts'
import { STAT_LABEL, api, getToken, setToken } from '../lib/format'

interface Bet { id: number; placedAt: string; stake: number; note: string | null; status: 'open' | 'won' | 'lost' | 'push' | 'void'; settledOdds: number | null; profit: number | null }
interface Leg { betId: number; idx: number; player: string; stat: string; side: 'over' | 'under'; line: number; price: number; book: string | null; gameDate: string; actual: number | null; result: string | null }
interface Res { data: { bets: Bet[]; legs: Leg[]; totals: MyBetTotals } }

const money = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`
const TONE: Record<Bet['status'], string> = { open: 'text-neutral-400', won: 'text-emerald-400', lost: 'text-red-400', push: 'text-neutral-300', void: 'text-neutral-500' }
const LABEL: Record<Bet['status'], string> = { open: 'Open', won: 'Won', lost: 'Lost', push: 'Push (refunded)', void: 'Void (refunded)' }

/** The bets actually placed, with money won or lost at the odds actually taken. Not the app's suggestions. */
export default function MyBets({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    api<Res>('/my-bets').then(setRes).catch((e) => setError(e.message))
  }, [refreshKey, tick])

  async function remove(id: number) {
    if (!window.confirm('Delete this logged bet? This cannot be undone.')) return
    try { await api(`/my-bets/${id}`, { method: 'DELETE' }); setTick((t) => t + 1) } catch (e) { setError((e as Error).message) }
  }

  if (error === 'Forbidden') return <TokenForm onSaved={() => { setError(''); setRes(null); setTick((t) => t + 1) }} />
  if (error) return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="text-sm text-neutral-500">Loading…</p>
  const { bets, legs, totals: t } = res.data
  const cell = (label: string, value: string, tone = 'text-neutral-100') => (
    <div className="px-4 py-3"><dt className="text-xs uppercase tracking-wider text-neutral-500">{label}</dt><dd className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</dd></div>
  )
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800 sm:grid-cols-4 sm:divide-x">
        {cell('Profit', money(t.profit), t.profit > 0 ? 'text-emerald-400' : t.profit < 0 ? 'text-red-400' : 'text-neutral-100')}
        {cell('ROI', t.roi == null ? '–' : `${(t.roi * 100).toFixed(1)}%`)}
        {cell('Record', `${t.won}-${t.lost}${t.push + t.void ? `-${t.push + t.void}` : ''}`)}
        {cell('Open', String(t.open))}
      </dl>
      <p className="text-xs text-neutral-500">ROI is profit over the money risked on decided bets. Pushes and voids refund the stake. {t.settled < 30 && 'With fewer than 30 settled bets this is mostly luck: do not read a trend into it.'}</p>

      {bets.length === 0 ? (
        <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">
          No bets logged yet. Add props to your slip, put in the odds you actually got, and press <b className="text-neutral-300">I placed this bet</b>. It is graded from box scores after the games.
        </p>
      ) : (
        <ul className="space-y-2">
          {bets.map((b) => {
            const ls = legs.filter((l) => l.betId === b.id)
            return (
              <li key={b.id} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className={`font-medium ${TONE[b.status]}`}>{LABEL[b.status]}</span>
                  <span className="text-sm tabular-nums text-neutral-300">Stake {b.stake.toFixed(2)}{b.profit != null && <> · <b className={b.profit > 0 ? 'text-emerald-400' : b.profit < 0 ? 'text-red-400' : 'text-neutral-300'}>{money(b.profit)}</b></>}</span>
                  <span className="text-xs text-neutral-600">{ls.length > 1 ? `${ls.length}-leg parlay` : 'single'} · {b.placedAt.slice(0, 10)}</span>
                  {b.note && <span className="text-xs text-neutral-500">“{b.note}”</span>}
                  <button onClick={() => remove(b.id)} className="ml-auto rounded px-2 py-1 text-xs text-neutral-600 hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500" aria-label={`Delete bet ${b.id}`}>Delete</button>
                </div>
                <ul className="mt-2 divide-y divide-neutral-800/70 text-sm">
                  {ls.map((l) => (
                    <li key={l.idx} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                      <span className="text-neutral-100">{l.player}</span>
                      <span className="text-neutral-400">{l.side === 'over' ? 'Over' : 'Under'} {l.line} {STAT_LABEL[l.stat] ?? l.stat}</span>
                      <span className="tabular-nums text-neutral-500">@ {l.price.toFixed(2)}{l.book ? ` ${l.book}` : ''} · {l.gameDate}</span>
                      <span className={`ml-auto tabular-nums ${l.result === 'won' ? 'text-emerald-400' : l.result === 'lost' ? 'text-red-400' : 'text-neutral-500'}`}>{l.result ? `${l.result}${l.actual != null ? ` · got ${l.actual}` : ''}` : 'waiting for box score'}</span>
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Personal bets are private. On this computer they open by themselves; on a deployed copy the access token (the CAPTURE_TOKEN you set) unlocks them. It is kept in this browser only. */
function TokenForm({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('')
  return (
    <form className="space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4" onSubmit={(e) => { e.preventDefault(); setToken(value.trim()); onSaved() }}>
      <p className="text-sm text-neutral-300">My bets are private. Enter your access token to see and log them from this browser.</p>
      <p className="text-xs text-neutral-500">It is the <code>CAPTURE_TOKEN</code> you set on the server. It is stored in this browser only and sent as a header. {getToken() ? 'The saved token was refused.' : ''}</p>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="access-token">Access token</label>
        <input id="access-token" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500" />
        <button className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300">Save</button>
      </div>
    </form>
  )
}
