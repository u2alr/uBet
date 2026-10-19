import { useCallback, useEffect, useState } from 'react'
import { STATS, type Prediction, type Stat } from '../../shared/baseline'
import { STAT_LABEL, api, fmt, pct } from '../lib/format'
import { helperStatus, helperSync } from '../lib/helper'
import type { GameRow } from '../lib/stats'
import GameLog from './GameLog'
import GameTypeSplit from './GameTypeSplit'
import PlayerCharts from './PlayerCharts'

interface Player { id: number; name: string; team: string | null; position: string | null }
interface StatsResponse {
  games: { date: string; gameId: number; minutes: number; value: number }[]
  averages: { last5: number | null; last10: number | null; season: number | null }
  hitRate?: { last5: number | null; last10: number | null; season: number | null }
  prediction?: Prediction | null
}

type Kind = 'regular' | 'playoffs' | 'preseason' | 'all'
const KINDS: [Kind, string][] = [['regular', 'Regular'], ['playoffs', 'Playoffs'], ['preseason', 'Preseason'], ['all', 'All']]

export default function PlayerView({ initialId, refreshKey }: { initialId: number | null; refreshKey: number }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Player[]>([])
  const [player, setPlayer] = useState<Player | null>(null)
  const [stat, setStat] = useState<Stat>('pts')
  const [line, setLine] = useState('')
  const [data, setData] = useState<StatsResponse | null>(null)
  const [log, setLog] = useState<GameRow[]>([])
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState<Kind>('regular')

  const load = useCallback(async (p: Player, s: Stat, l: string, k: Kind) => {
    const qs = new URLSearchParams({ stat: s })
    if (k !== 'all') qs.set('type', k)
    if (l) qs.set('line', l)
    try {
      setData(await api<StatsResponse>(`/players/${p.id}/stats?${qs}`))
    } catch (e) {
      setStatus((e as Error).message)
    }
  }, [])

  const open = useCallback(async (p: Player) => {
    setPlayer(p)
    setResults([])
    setStatus('')
    api<{ data: GameRow[] }>(`/players/${p.id}/log`).then((r) => setLog(r.data)).catch((e) => setStatus(e.message))
    setKind('regular')
    await load(p, 'pts', '', 'regular')
    setStat('pts')
    setLine('')
  }, [load])

  async function search() {
    try {
      setResults((await api<{ data: Player[] }>(`/players?search=${encodeURIComponent(query)}`)).data)
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  // Jump straight to a player when opened from a suggested bet.
  useEffect(() => {
    if (initialId == null) return
    api<{ data: Player }>(`/players/${initialId}`)
      .then((r) => open(r.data))
      .catch((e) => setStatus(e.message))
  }, [initialId, open])

  async function logPrediction() {
    if (!player || !data?.prediction) return
    await api('/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: player.id, stat, line: Number(line),
        predicted: data.prediction.predicted, pOver: data.prediction.pOver, model: data.prediction.model,
      }),
    })
    setStatus('Prediction logged')
  }

  const shown = kind === 'all' ? log : log.filter((g) => g.gameType === kind)
  // Re-read this player's numbers after Refresh or a finished sync, keeping the stat/line/filter you chose.
  useEffect(() => {
    if (!player || refreshKey === 0) return
    api<{ data: GameRow[] }>(`/players/${player.id}/log`).then((r) => setLog(r.data)).catch(() => {})
    load(player, stat, line, kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // The Sync player button only works while the local helper is running.
  const [helperOn, setHelperOn] = useState(false)
  useEffect(() => { helperStatus().then((h) => setHelperOn(!!h)) }, [])

  async function syncPlayer() {
    if (!player) return
    const err = await helperSync(player.name)
    setStatus(err ?? 'Syncing this player. Progress shows at the top; the page updates when it finishes.')
  }

  const input = 'rounded-md bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 outline-none focus:ring-1 focus:ring-neutral-600'

  return (
    <div className="space-y-6">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search() }}>
        <input className={`${input} flex-1`} placeholder="Search players you've synced…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="rounded-md bg-neutral-200 px-4 py-2 text-sm text-neutral-900 hover:bg-white">Search</button>
      </form>

      {results.length > 0 && (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-900">
          {results.map((p) => (
            <li key={p.id}>
              <button className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-800" onClick={() => open(p)}>{p.name}</button>
            </li>
          ))}
        </ul>
      )}
      {query && results.length === 0 && !player && (
        <p className="text-sm text-neutral-600">Press search. Only players loaded with ingest/sync.py appear.</p>
      )}

      {player && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl text-neutral-100">{player.name}</h2>
            {helperOn && (
              <button className="mr-auto rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800" onClick={syncPlayer}>
                Sync player
              </button>
            )}
            {!helperOn && <span className="mr-auto" />}
            <select className={input} value={stat} onChange={(e) => { const s = e.target.value as Stat; setStat(s); load(player, s, line, kind) }}>
              {STATS.map((s) => <option key={s} value={s}>{STAT_LABEL[s]}</option>)}
            </select>
            <input className={`${input} w-24`} placeholder="Line" inputMode="decimal" value={line}
              onChange={(e) => setLine(e.target.value)} onBlur={() => load(player, stat, line, kind)} />
            <div className="flex overflow-hidden rounded-md bg-neutral-900 text-xs">
              {KINDS.map(([k, label]) => (
                <button key={k} onClick={() => { setKind(k); load(player, stat, line, k) }}
                  className={`px-3 py-2 ${kind === k ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {data && (
            <>
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-neutral-800 text-center">
                {(['last5', 'last10', 'season'] as const).map((k) => (
                  <div key={k} className="bg-neutral-900 py-4">
                    <div className="text-xs uppercase tracking-widest text-neutral-500">{k.replace('last', 'Last ')}</div>
                    <div className="text-2xl tabular-nums text-neutral-100">{fmt(data.averages[k])}</div>
                    {data.hitRate && <div className="text-xs text-neutral-500">over {pct(data.hitRate[k])}</div>}
                  </div>
                ))}
              </div>

              {data.prediction && (
                <div className="flex items-center justify-between rounded-lg bg-neutral-900 px-4 py-3 text-sm">
                  <span className="text-neutral-400">
                    Projection <b className="text-neutral-100">{fmt(data.prediction.predicted)}</b> ±{fmt(data.prediction.stdDev)} ·
                    over {line} <b className="text-neutral-100">{pct(data.prediction.pOver)}</b>
                  </span>
                  <button className="rounded-md bg-neutral-800 px-3 py-1 text-xs hover:bg-neutral-700" onClick={logPrediction}>Log</button>
                </div>
              )}
            </>
          )}
          {shown.length > 0 && (
            <>
              <GameTypeSplit games={log} stat={stat} line={line ? Number(line) : null} />
              <PlayerCharts games={shown} stat={stat} line={line ? Number(line) : null} />
              <GameLog games={shown} />
            </>
          )}
          {shown.length === 0 && data && (
            <p className="text-sm text-neutral-500">
              {log.length === 0 ? 'No box scores yet. Run ingest/sync.py for this player.' : `No ${kind} games for this player.`}
            </p>
          )}
          {status && <p className="text-xs text-neutral-500">{status}</p>}
        </section>
      )}
    </div>
  )
}
