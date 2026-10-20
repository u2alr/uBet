import { useEffect, useMemo, useState } from 'react'
import type { Stat } from '../../shared/baseline'
import { api, fmt } from '../lib/format'
import type { Pick } from '../lib/picks'
import { PROP_VIEWS, isSingle, viewValue, type PropViewKey } from '../lib/propViews'
import type { GameRow } from '../lib/stats'
import { logoUrl, teamByName, teamId } from '../lib/teams'
import AnimatedNumber from './AnimatedNumber'
import { SlipButton } from './PickTable'

type Kind = 'regular' | 'playoffs' | 'preseason' | 'all'
const KINDS: [Kind, string][] = [['regular', 'Regular'], ['playoffs', 'Playoffs'], ['preseason', 'Preseason'], ['all', 'All']]
const WINDOWS = [5, 10, 15, 20, 0] as const

// Hit / miss are state colours (fixed, always paired with the number printed on the bar), not statistic colours.
const HIT = '#0ca30c', MISS = '#d03b3b', TIE = '#737373', LINE = '#c98500', MINUTES = '#3987e5'
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const seasonLabel = (start: number) => `${String(start).slice(2)}/${String(start + 1).slice(2)}`
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

interface Mate { id: number; name: string; missed: number }

export default function PropCard({ playerId, picks, stat, line, kind, onStat, onLine, onKind }: {
  playerId: number; picks: Pick[]; stat: Stat; line: string; kind: Kind
  onStat: (s: Stat) => void; onLine: (l: string, commit: boolean) => void; onKind: (k: Kind) => void
}) {
  const [view, setView] = useState<PropViewKey>(stat as PropViewKey)
  const [n, setN] = useState<(typeof WINDOWS)[number]>(10)
  const [mate, setMate] = useState<{ id: number; name: string; mode: 'without' | 'with' } | null>(null)
  const [mates, setMates] = useState<Mate[]>([])
  const [rows, setRows] = useState<GameRow[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api<{ data: Mate[] }>(`/players/${playerId}/teammates`).then((r) => live && setMates(r.data)).catch(() => live && setMates([]))
    return () => { live = false }
  }, [playerId])

  useEffect(() => {
    let live = true
    const qs = mate ? `?${mate.mode}=${mate.id}` : ''
    api<{ data: GameRow[] }>(`/players/${playerId}/log${qs}`)
      .then((r) => { if (live) { setRows(r.data); setError('') } })
      .catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [playerId, mate])

  const lineN = line.trim() === '' ? null : Number(line)
  const hasLine = lineN !== null && Number.isFinite(lineN)
  const kindRows = useMemo(() => (kind === 'all' ? rows : rows.filter((g) => g.gameType === kind)), [rows, kind])
  const shown = useMemo(() => (n ? kindRows.slice(0, n) : kindRows).slice().reverse(), [kindRows, n]) // oldest -> newest
  const values = shown.map((g) => viewValue(g, view))
  const hits = hasLine ? values.filter((v) => v > lineN).length : 0
  const meta = PROP_VIEWS.find((v) => v.key === view)!

  // What the books post for this view, if anything: the pill's prices and the "odds imply" figure.
  const bookLines = (k: PropViewKey) => picks.filter((p) => p.stat === k)
  const here = isSingle(view) ? bookLines(view).filter((p) => hasLine && p.line === lineN) : []
  const over = here.find((p) => p.side === 'over'), under = here.find((p) => p.side === 'under')
  const mostCentral = (k: PropViewKey) => {
    const ps = bookLines(k)
    if (!ps.length) return null
    return ps.reduce((b, p) => (Math.abs(p.prob - 0.5) < Math.abs(b.prob - 0.5) ? p : b)).line
  }

  // Open on the book's line for this stat, so the card shows hits and misses straight away instead of an empty line box.
  useEffect(() => {
    if (line.trim() !== '' || !picks.length) return
    const book = mostCentral(view)
    if (book != null) onLine(String(book), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks])

  const pickView = (k: PropViewKey) => {
    setView(k)
    if (isSingle(k)) onStat(k as Stat)
    const book = mostCentral(k)
    onLine(book != null ? String(book) : '', true)
  }

  // The next game, from the odds feed: a "?" column with our projection marked on it.
  const next = picks.length ? [...picks].sort((a, b) => a.gameDate.localeCompare(b.gameDate))[0] : null
  const nextOpp = next ? next.game.split(' @ ').find((t) => t !== next.teamName) ?? null : null
  const nextAway = next ? next.game.split(' @ ')[0] === next.teamName : false
  const nextProj = next && isSingle(view) ? picks.find((p) => p.stat === view && p.gameDate === next.gameDate)?.projection ?? null : null

  const maxV = Math.max(1, ...values, hasLine ? lineN : 0, nextProj ?? 0) * 1.12
  const H = 190
  const y = (v: number) => (v / maxV) * H

  const seasonAvgMin = avg(kindRows.filter((g) => g.season === (kindRows[0]?.season ?? 0)).map((g) => g.minutes))
  const graphAvgMin = avg(shown.map((g) => g.minutes))
  const segments: { season: number; count: number }[] = []
  for (const g of shown) {
    const last = segments[segments.length - 1]
    if (last && last.season === g.season) last.count++
    else segments.push({ season: g.season, count: 1 })
  }
  const cols = shown.length + (next ? 1 : 0)
  const minVals = shown.map((g) => g.minutes)
  const minTop = Math.max(48, ...minVals), minBot = Math.min(0, ...minVals)

  return (
    <div className="rounded-lg bg-neutral-900 p-3">
      {/* prop pill + hit rate + stat tabs */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 rounded-lg bg-neutral-800/70 px-3 py-1.5">
          <input
            value={line} inputMode="decimal" placeholder="line" aria-label="Line"
            onChange={(e) => onLine(e.target.value, false)} onBlur={() => onLine(line, true)}
            onKeyDown={(e) => { if (e.key === 'Enter') onLine(line, true) }}
            className="w-14 bg-transparent text-sm tabular-nums text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <span className="text-xs text-neutral-400">{meta.long}</span>
          {over && <span className="text-xs tabular-nums text-neutral-300" title={`${over.book}`}>O <span style={{ color: HIT }}>{over.price.toFixed(2)}</span></span>}
          {under && <span className="text-xs tabular-nums text-neutral-300" title={`${under.book}`}>U <span style={{ color: MISS }}>{under.price.toFixed(2)}</span></span>}
          {(over ?? under) && <SlipButton pick={(over ?? under)!} />}
          {isSingle(view) && !here.length && hasLine && bookLines(view).length > 0 && <span className="text-[11px] text-neutral-600">no book at this line</span>}
          {!isSingle(view) && <span className="text-[11px] text-neutral-600">no book prices for combos</span>}
        </div>

        <div className="text-center">
          <div className="text-[11px] uppercase tracking-widest text-neutral-500">Hit rate</div>
          {hasLine && values.length ? (
            <div className="text-lg tabular-nums" style={{ color: hits / values.length >= 0.5 ? HIT : MISS }}>
              <AnimatedNumber value={(hits / values.length) * 100} suffix="%" /> <span className="text-sm text-neutral-400">({hits}/{values.length})</span>
            </div>
          ) : <div className="text-lg text-neutral-600">–</div>}
          <div className="text-[11px] text-neutral-500">{over ? `Odds imply ${((1 / over.price) * 100).toFixed(1)}% Over` : 'over the line, last ' + (n || 'all') + ' games'}</div>
        </div>

        <div className="flex flex-wrap gap-1">
          {PROP_VIEWS.map((v) => {
            const vals = (n ? kindRows.slice(0, n) : kindRows).map((g) => viewValue(g, v.key))
            const a = avg(vals)
            const ref = v.key === view ? (hasLine ? lineN : null) : mostCentral(v.key)
            const diff = a != null && ref != null ? a - ref : null
            return (
              <button key={v.key} onClick={() => pickView(v.key)} aria-pressed={v.key === view}
                className={`min-w-14 rounded-md px-2 py-1 text-center ${v.key === view ? 'bg-neutral-700 ring-1 ring-neutral-500' : 'hover:bg-neutral-800'}`}>
                <div className={`text-[11px] ${v.key === view ? 'text-neutral-100' : 'text-neutral-500'}`}>{v.label}</div>
                <div className="text-sm tabular-nums text-neutral-100"><AnimatedNumber value={a} /></div>
                <div className="text-[11px] tabular-nums" style={{ color: diff == null ? '#525252' : diff >= 0 ? HIT : MISS }}>
                  {diff == null ? '·' : `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* filters */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {mate ? (
          <span className="flex items-center gap-1.5 rounded-md bg-neutral-800 px-2 py-1 text-neutral-200">
            {mate.mode === 'without' ? 'W/O' : 'WITH'}: {mate.name}
            <button aria-label="Clear teammate filter" className="text-neutral-500 hover:text-neutral-100" onClick={() => setMate(null)}>×</button>
          </span>
        ) : null}
        <select aria-label="Filter by teammate" value="" onChange={(e) => {
          const [mode, id] = e.target.value.split(':')
          const m = mates.find((t) => String(t.id) === id)
          if (m) setMate({ id: m.id, name: m.name, mode: mode as 'with' | 'without' })
        }} className="rounded-md bg-neutral-800 px-2 py-1 text-neutral-300 outline-none">
          <option value="">{mates.length ? 'Teammate split…' : 'No teammate splits'}</option>
          {mates.map((t) => <option key={`wo${t.id}`} value={`without:${t.id}`}>Without {t.name} ({t.missed} games)</option>)}
          {mates.map((t) => <option key={`w${t.id}`} value={`with:${t.id}`}>With {t.name}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-md bg-neutral-800">
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setN(w)} className={`px-2 py-1 ${n === w ? 'bg-neutral-600 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}>{w ? `L${w}` : 'All'}</button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md bg-neutral-800">
          {KINDS.map(([k, label]) => (
            <button key={k} onClick={() => onKind(k)} className={`px-2 py-1 ${kind === k ? 'bg-neutral-600 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}>{label}</button>
          ))}
        </div>
        <span className="text-neutral-600">{mate ? `${shown.length} games ${mate.mode === 'without' ? 'without' : 'with'} ${mate.name.split(' ').slice(-1)[0]}` : `${shown.length} games`}</span>
      </div>
      {error && <p className="mt-2 text-xs text-neutral-500">{error}</p>}

      {values.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">{rows.length ? 'No games match these filters.' : 'No box scores for this player yet.'}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div style={{ minWidth: Math.max(320, cols * 46) }}>
            {/* season bands */}
            <div className="mb-1 flex text-[10px] text-neutral-500" style={{ paddingLeft: 40 }}>
              {segments.map((s, i) => (
                <div key={`${s.season}${i}`} style={{ flex: s.count }} className={`border-l border-neutral-700 pl-1 ${i % 2 ? '' : 'bg-neutral-800/30'}`}>{seasonLabel(s.season)}</div>
              ))}
              {next && <div style={{ flex: 1 }} />}
            </div>

            <div className="relative flex" style={{ height: H + 4 }}>
              {/* the line, with its value chip */}
              {hasLine && (
                <>
                  <div className="pointer-events-none absolute right-0 border-t border-dashed transition-[bottom] duration-500 ease-out" style={{ left: 40, bottom: y(lineN) + 2, borderColor: LINE }} />
                  <div className="absolute left-0 rounded px-1.5 text-xs tabular-nums text-neutral-900 transition-[bottom] duration-500 ease-out" style={{ bottom: y(lineN) - 7, background: LINE }}>{lineN}</div>
                </>
              )}
              <div className="flex flex-1 items-end gap-1.5" style={{ marginLeft: 40 }}>
                {shown.map((g, i) => {
                  const v = values[i]
                  const col = !hasLine ? '#525252' : v > lineN ? HIT : v < lineN ? MISS : TIE
                  const parts = PROP_VIEWS.find((p) => p.key === view)!.parts.length > 1 ? ` (${(['pts', 'reb', 'ast'] as const).map((k) => `${g[k]} ${k}`).join(', ')})` : ''
                  return (
                    <div key={`${g.date}|${g.opp}`} className="flex flex-1 flex-col items-center justify-end" style={{ height: H }}
                      title={`${g.date} ${g.home ? 'vs' : '@'} ${g.opp ?? '?'}: ${v} ${meta.label}${parts}, ${fmt(g.minutes, 0)} min, ${g.won ? 'W' : 'L'}`}>
                      <div className="anim-bar flex w-full max-w-9 items-end justify-center rounded-t pb-1 text-xs font-medium tabular-nums text-white transition-[height,background-color] duration-500 ease-out hover:brightness-125" style={{ height: Math.max(20, y(v)), background: col, ['--i' as string]: i }}>{v}</div>
                    </div>
                  )
                })}
                {next && (
                  <div className="relative flex flex-1 flex-col items-center justify-end" style={{ height: H }} title={`Next game${nextOpp ? ` ${nextAway ? '@' : 'vs'} ${nextOpp}` : ''}, ${next.gameDate}`}>
                    <div className="anim-pop flex w-full max-w-9 items-end justify-center rounded-t border border-dashed border-neutral-500 pb-1 text-sm text-neutral-300 transition-[height] duration-500 ease-out" style={{ height: Math.max(60, hasLine ? y(lineN) : 60) }}>?</div>
                    {nextProj != null && (
                      <div className="absolute w-full max-w-9 border-t-2 border-dashed transition-[bottom] duration-500 ease-out" style={{ bottom: y(nextProj), borderColor: MINUTES }} title={`Our projection ${nextProj.toFixed(1)}`} />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* opponents and dates */}
            <div className="flex gap-1.5" style={{ marginLeft: 40 }}>
              {shown.map((g, i) => {
                const id = teamId(g.opp)
                const [, m, d] = g.date.split('-')
                return (
                  <div key={`${g.date}${i}`} className="flex flex-1 flex-col items-center pt-1 text-[10px] leading-tight text-neutral-500">
                    <TeamLogo id={id} abbr={g.opp} away={!g.home} />
                    <span>{MONTH[Number(m) - 1]}</span>
                    <span>{Number(d)}{g.gameType !== 'regular' && <sup className="ml-0.5 text-neutral-400">{g.gameType === 'playoffs' ? 'PO' : 'PS'}</sup>}</span>
                  </div>
                )
              })}
              {next && (() => {
                const t = nextOpp ? teamByName(nextOpp) : null
                const [, m, d] = next.gameDate.split('-')
                return (
                  <div className="flex flex-1 flex-col items-center pt-1 text-[10px] leading-tight text-neutral-300">
                    <TeamLogo id={t?.[1] ?? null} abbr={t?.[0] ?? null} away={nextAway} />
                    <span>{MONTH[Number(m) - 1]}</span><span>{Number(d)}</span>
                  </div>
                )
              })()}
            </div>

            {/* minutes: its own small chart on the same columns, never a second axis on the bars */}
            <div className="relative mt-2" style={{ marginLeft: 40, height: 46 }}>
              <svg key={minVals.join()} className="anim-reveal absolute inset-0 h-full w-full" viewBox={`0 0 ${cols * 100} 46`} preserveAspectRatio="none" aria-label="Minutes per game">
                {minVals.length > 1 && (
                  <polyline fill="none" stroke={MINUTES} strokeWidth={2} vectorEffect="non-scaling-stroke"
                    points={minVals.map((m, i) => `${i * 100 + 50},${42 - ((m - minBot) / (minTop - minBot || 1)) * 38}`).join(' ')} />
                )}
              </svg>
              <div className="absolute inset-0 flex">
                {shown.map((g, i) => (
                  <div key={i} className="relative flex-1">
                    <span className="absolute left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-neutral-400" style={{ top: `${((42 - ((g.minutes - minBot) / (minTop - minBot || 1)) * 38) / 46) * 100 - 26}%` }}>{fmt(g.minutes, 0)}</span>
                  </div>
                ))}
                {next && <div className="flex-1" />}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-neutral-500" style={{ marginLeft: 40 }}>
              <span><i className="mr-1 inline-block h-2 w-3 align-middle" style={{ background: LINE }} />LINE</span>
              <span><i className="mr-1 inline-block h-2 w-3 align-middle" style={{ background: MINUTES }} />MINUTES [GRAPH AVG: {fmt(graphAvgMin)} | SEASON AVG: {fmt(seasonAvgMin)}]</span>
              {nextProj != null && <span><i className="mr-1 inline-block h-0 w-3 border-t-2 border-dashed align-middle" style={{ borderColor: MINUTES }} />OUR PROJECTION {nextProj.toFixed(1)}</span>}
              <span>green over the line, red under it</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TeamLogo({ id, abbr, away }: { id: number | null; abbr: string | null; away: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="flex flex-col items-center">
      {away && <span className="text-[9px] text-neutral-600">@</span>}
      {id && !failed
        ? <img src={logoUrl(id)} alt={abbr ?? ''} title={abbr ?? ''} loading="lazy" onError={() => setFailed(true)} className="h-5 w-5 object-contain" />
        : <span className="text-[10px] text-neutral-400">{abbr ?? '?'}</span>}
    </span>
  )
}
