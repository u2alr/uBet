import { useEffect, useState } from 'react'
import type { FavouriteGame, Review, TierSummary } from '../../shared/seasonReview.ts'
import { api, pct } from '../lib/format'
import { teamId } from '../lib/teams'
import { tierByKey, tierOf } from '../lib/tiers'
import TeamChip from './TeamChip'

interface Res { data: Review; meta: { model?: { version: string; logLoss: number; accuracy: number }; adaptation: { tested: string[]; adopted: string[]; result: string; evidence: string } } }

const dayText = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const signed = (n: number | null) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n}`)

function Team({ abbr, size = 20 }: { abbr: string; size?: number }) {
  const id = teamId(abbr)
  return <span className="flex items-center gap-1.5">{id != null && <TeamChip id={id} abbr={abbr} size={size} />}<span className="font-semibold text-neutral-50">{abbr}</span></span>
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-neutral-900 px-4 py-3">
      <div className="text-xs uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="text-2xl tabular-nums text-neutral-50">{value}</div>
      <div className="text-xs text-neutral-500">{sub}</div>
    </div>
  )
}

/** Stated chance against what happened, per confidence tier: the filled bar is the result, the tick is what the model said. */
function TierRow({ t }: { t: TierSummary }) {
  const tier = tierByKey(t.key)
  return (
    <tr className="border-t border-neutral-800/60">
      <td className="px-3 py-2"><span className="flex items-center gap-2"><span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${tier.bar}`} /><span className={tier.text}>{tier.short}</span><span className="text-xs text-neutral-600">{tier.range}</span></span></td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-400">{t.n}</td>
      <td className="w-full min-w-[9rem] px-2 py-2">
        {t.n === 0 ? <span className="text-xs text-neutral-600">no games yet</span> : (
          <div className="relative h-2 rounded-full bg-neutral-800" aria-hidden>
            <div className={`h-full rounded-full ${tier.bar}`} style={{ width: `${Math.round((t.actual ?? 0) * 100)}%` }} />
            <div className="absolute -top-0.5 h-3 w-0.5 bg-neutral-100" style={{ left: `${Math.round((t.stated ?? 0) * 100)}%` }} />
          </div>
        )}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-400">{t.stated == null ? '–' : pct(t.stated)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-neutral-50">{t.actual == null ? '–' : pct(t.actual)}</td>
      <td className="px-3 py-2 text-xs">{t.withinNoise == null ? null : t.withinNoise ? <span className="text-neutral-500">in line</span> : <span className="text-amber-400">off by more than chance</span>}</td>
    </tr>
  )
}

function Call({ g }: { g: FavouriteGame }) {
  const tier = tierOf(g.prob)
  return (
    <tr className="border-t border-neutral-800/60">
      <td className="px-3 py-1.5 text-xs tabular-nums text-neutral-500">{dayText(g.date)}</td>
      <td className="px-2 py-1.5"><span className="flex items-center gap-1.5 text-neutral-400">{g.home ? <><Team abbr={g.underdog} size={18} /><span className="text-neutral-600">@</span><Team abbr={g.favourite} size={18} /></> : <><Team abbr={g.favourite} size={18} /><span className="text-neutral-600">@</span><Team abbr={g.underdog} size={18} /></>}</span></td>
      <td className="px-2 py-1.5"><span className={`font-semibold ${tier.text}`}>{g.favourite}</span> <span className="tabular-nums text-neutral-300">{pct(g.prob)}</span> <span className="text-xs text-neutral-600">{tier.short}</span></td>
      <td className="px-3 py-1.5 text-right text-xs">{g.won ? <span className="text-neutral-300">✓ {g.favourite} won</span> : <span className="text-amber-400">✗ {g.underdog} won</span>}</td>
    </tr>
  )
}

function Upset({ g }: { g: FavouriteGame }) {
  const tier = tierOf(g.prob)
  return (
    <li className="rounded-xl bg-neutral-900 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
          <span className="text-xs tabular-nums text-neutral-500">{dayText(g.date)}</span>
          <Team abbr={g.favourite} /> <span className={`tabular-nums ${tier.text}`}>{pct(g.prob)}</span> <span className="text-neutral-500">lost {g.home ? 'at home' : 'on the road'} to</span> <Team abbr={g.underdog} />
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${tier.text} bg-neutral-800`}>{tier.short}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{g.why.join(' · ')}</p>
    </li>
  )
}

export default function SeasonReview({ refreshKey }: { refreshKey: number }) {
  const [res, setRes] = useState<Res | null>(null)
  const [error, setError] = useState('')
  const [all, setAll] = useState(false)
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all')
  const [shown, setShown] = useState(25)
  useEffect(() => {
    let live = true
    api<Res>('/season-review').then((r) => live && setRes(r)).catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [refreshKey])

  if (error) return <p className="text-sm text-neutral-500">{error}</p>
  if (!res) return <p className="rounded-lg bg-neutral-900 px-3 py-3 text-sm text-neutral-500">Loading…</p>
  const r = res.data, a = res.meta.adaptation
  if (r.games === 0) return <p className="rounded-lg bg-neutral-900 px-4 py-6 text-sm text-neutral-500">No games reviewed yet. The review appears after the next sync (<code className="text-neutral-300">research/game_snapshot.py</code>).</p>
  const upsets = all ? r.upsetGames : r.upsetGames.slice(0, 12)
  const calls = r.allGames.filter((g) => filter === 'all' || (filter === 'won' ? g.won : !g.won))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-neutral-50">Season review</h2>
        <p className="text-xs text-neutral-500">{r.games} games played this season, each called the way the model would have called it before tip-off (fitted on earlier seasons only, using only what was known then).</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Favourite won" value={r.actualRate == null ? '–' : pct(r.actualRate)} sub={`the model said ${r.meanStated == null ? '–' : pct(r.meanStated)} · ${r.favouriteWon} of ${r.games}`} />
        <Tile label="Upsets" value={`${r.upsets.observed}`} sub={`${r.upsets.expected.toFixed(1)} expected from the model's own chances`} />
        <Tile label="Log loss" value={r.logLoss == null ? '–' : r.logLoss.toFixed(3)} sub="a coin flip scores 0.693; lower is better" />
      </div>

      <section className="space-y-1.5 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
        <p>{r.upsets.verdict}</p>
        {r.caution && <p className="text-xs text-neutral-500">{r.caution}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">Did the favourites win as often as we said?</h3>
        <div className="overflow-x-auto rounded-xl bg-neutral-900">
          <table className="w-full whitespace-nowrap text-xs">
            <thead className="text-left text-neutral-500">
              <tr><th className="px-3 py-1.5 font-normal">Tier</th><th className="px-2 py-1.5 text-right font-normal">Games</th><th className="px-2 py-1.5 font-normal">Result (bar) vs said (tick)</th><th className="px-2 py-1.5 text-right font-normal">Said</th><th className="px-2 py-1.5 text-right font-normal">Won</th><th className="px-3 py-1.5 font-normal" /></tr>
            </thead>
            <tbody>{r.tiers.map((t) => <TierRow key={t.key} t={t} />)}</tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-600">"Off by more than chance" means the gap is bigger than two standard errors for that many games. Small tiers swing a lot.</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">What the upsets had in common</h3>
        <div className="overflow-x-auto rounded-xl bg-neutral-900">
          <table className="w-full whitespace-nowrap text-xs">
            <thead className="text-left text-neutral-500"><tr><th className="px-3 py-1.5 font-normal">From the favourite's side</th><th className="px-2 py-1.5 text-right font-normal">In upsets ({r.upsets.observed})</th><th className="px-3 py-1.5 text-right font-normal">When the favourite won ({r.favouriteWon})</th></tr></thead>
            <tbody>
              {r.contrast.map((c) => (
                <tr key={c.factor} className="border-t border-neutral-800/60"><td className="px-3 py-1.5 text-neutral-300">{c.factor}</td><td className="px-2 py-1.5 text-right tabular-nums text-neutral-100">{signed(c.upsets)}</td><td className="px-3 py-1.5 text-right tabular-nums text-neutral-400">{signed(c.held)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-600">A check, not a discovery: with this many games, differences between these two columns are mostly chance. The model already uses the rating gap and the missing talent, so a favourite with a smaller edge losing more often is what it expects.</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">What flipped</h3>
        <ul className="space-y-1.5">{upsets.map((g) => <Upset key={`${g.date}${g.favourite}${g.underdog}`} g={g} />)}</ul>
        {r.upsetGames.length > 12 && <button onClick={() => setAll(!all)} className="text-xs text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">{all ? 'Show fewer' : `Show all ${r.upsetGames.length} upsets`}</button>}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500">Every game this season · picks {r.favouriteWon}–{r.games - r.favouriteWon}</h3>
          <div role="group" aria-label="Filter games" className="flex rounded-lg bg-neutral-900 p-0.5 text-xs">
            {([['all', 'All'], ['won', 'Favourite won'], ['lost', 'Upsets']] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setFilter(k); setShown(25) }} aria-pressed={filter === k}
                className={`rounded-md px-3 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${filter === k ? 'bg-neutral-700 text-neutral-50' : 'text-neutral-400 hover:text-neutral-200'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl bg-neutral-900">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="text-left text-xs text-neutral-500"><tr><th className="px-3 py-1.5 font-normal">Date</th><th className="px-2 py-1.5 font-normal">Game</th><th className="px-2 py-1.5 font-normal">Our call (before tip-off)</th><th className="px-3 py-1.5 text-right font-normal">Result</th></tr></thead>
            <tbody>{calls.slice(0, shown).map((g) => <Call key={`${g.date}${g.favourite}${g.underdog}`} g={g} />)}</tbody>
          </table>
        </div>
        {calls.length > shown && <button onClick={() => setShown(shown + 25)} className="text-xs text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">Show 25 more ({calls.length - shown} left)</button>}
      </section>

      <section className="space-y-2 rounded-xl bg-neutral-900 px-4 py-3 text-xs leading-relaxed text-neutral-400">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">How this is applied to future games</h3>
        <p><b className="font-medium text-neutral-200">Already automatic.</b> Every result updates the Elo rating, the opponent-adjusted ratings are re-solved each day with 30, 60 and 120 day memories, and the model is refit on every game played, this season's included. So a team that keeps beating expectations is rated higher the next day.</p>
        <p><b className="font-medium text-neutral-200">Tested and not adopted.</b> {a.tested.join('; ')}. {a.result}</p>
        <p className="text-neutral-600">Evidence: {a.evidence}. Every game's prediction is also stored before tip-off, so this review will be scored on the live record as games finish.</p>
      </section>
    </div>
  )
}
