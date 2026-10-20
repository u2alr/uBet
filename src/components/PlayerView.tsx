import { useCallback, useEffect, useState } from 'react'
import type { Prediction, Stat } from '../../shared/baseline'
import type { Injury, Role } from '../../shared/injuries'
import { api, fmt, pct } from '../lib/format'
import { helperStatus, helperSync } from '../lib/helper'
import type { GameRow } from '../lib/stats'
import { InjuryTag, RoleTag } from './Availability'
import GameLog from './GameLog'
import LazyMount from './LazyMount'
import GameTypeSplit from './GameTypeSplit'
import Headshot from './Headshot'
import PlayerCharts from './PlayerCharts'
import PlayerProps from './PlayerProps'
import PropCard from './PropCard'
import { usePlayerPicks } from '../lib/usePlayerPicks'

interface Player { id: number; name: string; team: string | null; position: string | null }
interface StatsResponse {
  games: { date: string; gameId: number; minutes: number; value: number }[]
  averages: { last5: number | null; last10: number | null; season: number | null }
  hitRate?: { last5: number | null; last10: number | null; season: number | null }
  prediction?: Prediction | null
  role?: Role | null
  injury?: Injury | null
}

type Kind = 'regular' | 'playoffs' | 'preseason' | 'all'

// The shape of the numbers behind the averages: a player who scores 20 every night and one who swings 8 to 38 average the same.
function Spread({ games, line }: { games: StatsResponse['games']; line: number | null }) {
  if (games.length === 0) return null
  const v = games.map((g) => g.value)
  const sorted = [...v].sort((a, b) => a - b)
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1)) : null
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  const mins = games.reduce((a, g) => a + g.minutes, 0) / games.length
  const items: [string, string][] = [
    ['Games', String(v.length)], ['Median', fmt(median)], ['High', String(sorted[sorted.length - 1])], ['Low', String(sorted[0])],
    ['Spread (SD)', sd == null ? '–' : fmt(sd)], ['Minutes', fmt(mins)],
    ...(line != null ? [['Over line', String(v.filter((x) => x > line).length)], ['Under line', String(v.filter((x) => x < line).length)], ['Exactly', String(v.filter((x) => x === line).length)]] as [string, string][] : []),
  ]
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-neutral-900 px-3 py-2 text-xs">
      {items.map(([k, val]) => <span key={k} className="text-neutral-500">{k} <b className="font-normal tabular-nums text-neutral-100">{val}</b></span>)}
    </div>
  )
}

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
  const props = usePlayerPicks(player?.id ?? null, refreshKey)

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
    try {
      await api('/predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: player.id, stat, line: Number(line),
          predicted: data.prediction.predicted, pOver: data.prediction.pOver, model: data.prediction.model,
        }),
      })
      setStatus('Prediction logged')
    } catch (e) {
      setStatus((e as Error).message)
    }
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
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search() }}>
        <input className={`${input} flex-1`} placeholder="Search players you've synced…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="rounded-md bg-neutral-200 px-4 py-2 text-sm text-neutral-900 hover:bg-white">Search</button>
      </form>

      {results.length > 0 && (
        <ul className="divide-y divide-neutral-800 rounded-lg bg-neutral-900">
          {results.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-neutral-800" onClick={() => open(p)}>
                <Headshot id={p.id} name={p.name} />{p.name}
                {p.team && <span className="ml-auto text-xs text-neutral-600">{p.team}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && results.length === 0 && !player && (
        <p className="text-sm text-neutral-600">Press search. Only players loaded with ingest/sync.py appear.</p>
      )}

      {player && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Headshot id={player.id} name={player.name} size={104} />
            <div>
              <h2 className="text-xl text-neutral-100">{player.name}</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                {player.team}
                <RoleTag role={data?.role} />
                <InjuryTag injury={data?.injury} />
              </div>
              {data?.injury?.note && <p className="max-w-xl text-xs text-neutral-500">{data.injury.note}</p>}
            </div>
            {helperOn && (
              <button className="mr-auto rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800" onClick={syncPlayer}>
                Sync player
              </button>
            )}
            {!helperOn && <span className="mr-auto" />}
          </div>

          <PropCard key={player.id} playerId={player.id} picks={props.picks} stat={stat} line={line} kind={kind}
            onStat={(s) => { setStat(s); load(player, s, line, kind) }}
            onLine={(l, commit) => { setLine(l); if (commit) load(player, stat, l, kind) }}
            onKind={(k) => { setKind(k); load(player, stat, line, k) }} />

          <PlayerProps picks={props.picks} note={props.note} loading={props.loading}
            onPick={(s, l) => { setStat(s); setLine(String(l)); load(player, s, String(l), kind) }} />

          {data && (
            <>
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-neutral-800 text-center">
                {(['last5', 'last10', 'season'] as const).map((k) => (
                  <div key={k} className="bg-neutral-900 py-2">
                    <div className="text-xs uppercase tracking-widest text-neutral-500">{k.replace('last', 'Last ')}</div>
                    <div className="text-xl tabular-nums text-neutral-100">{fmt(data.averages[k])}</div>
                    {data.hitRate && <div className="text-xs text-neutral-500">over {pct(data.hitRate[k])}</div>}
                  </div>
                ))}
              </div>

              <Spread games={data.games} line={line ? Number(line) : null} />

              {data.prediction && (
                <div className="flex items-center justify-between rounded-lg bg-neutral-900 px-3 py-2 text-sm">
                  <span className="text-neutral-400">
                    Projection <b className="text-neutral-100">{fmt(data.prediction.predicted)}</b> ±{fmt(data.prediction.stdDev)} ·
                    over {line} <b className="text-neutral-100">{pct(data.prediction.pOver)}</b>
                    {data.prediction.pPush > 0.005 && <> · under <b className="text-neutral-100">{pct(data.prediction.pUnder)}</b> · push (refund) {pct(data.prediction.pPush)}</>}
                  </span>
                  <button className="rounded-md bg-neutral-800 px-3 py-1 text-xs hover:bg-neutral-700" onClick={logPrediction}>Log</button>
                </div>
              )}
            </>
          )}
          {shown.length > 0 && (
            <>
              <LazyMount height={220}><GameTypeSplit games={log} stat={stat} line={line ? Number(line) : null} /></LazyMount>
              <LazyMount height={900}><PlayerCharts games={shown} stat={stat} line={line ? Number(line) : null} /></LazyMount>
              <LazyMount height={400}><GameLog games={shown} /></LazyMount>
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
