import { useEffect, useState } from 'react'
import { MIN_DISAGREEMENTS, type GutRecord as Stats, type GutResult, type Source } from '../../shared/gut.ts'
import { api, pct } from '../lib/format'

interface Res { data: { records: Record<Source, Stats>; recent: Record<Source, GutResult[]> }; meta: { canEdit: boolean; note: string } }

const WHO: Record<Source, { title: string; name: string }> = { claude: { title: "Claude's gut vs the model", name: "Claude's" } }

/** How one author's picks are doing against the model, on finished games. The only comparison that can say anything is the games where the two disagreed. */
function Section({ source, r, recent, canEdit }: { source: Source; r: Stats; recent: GutResult[]; canEdit: boolean }) {
  const d = r.disagreements
  if (r.games === 0) {
    return (
      <section className="space-y-1 rounded-xl bg-neutral-900 px-4 py-3 text-xs leading-relaxed text-neutral-400">
        <h3 className="text-xs uppercase tracking-widest text-neutral-500">{WHO[source].title}</h3>
        <p>No finished games with a pick yet.{source === 'claude' && canEdit ? ' Picks are made before tip-off and appear here once the games finish.' : ''} Picks are scored against the model’s own pre-game number and never change a displayed probability.</p>
      </section>
    )
  }
  return (
    <section className="space-y-3">
      <h3 className="text-xs uppercase tracking-widest text-neutral-500">{WHO[source].title}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-neutral-900 px-4 py-3"><div className="text-xs uppercase tracking-widest text-neutral-500">{WHO[source].name} picks</div><div className="text-2xl tabular-nums text-neutral-50">{r.right}–{r.games - r.right}</div><div className="text-xs text-neutral-500">{pct(r.right / r.games)} of {r.games} games</div></div>
        <div className="rounded-xl bg-neutral-900 px-4 py-3"><div className="text-xs uppercase tracking-widest text-neutral-500">Model, same games</div><div className="text-2xl tabular-nums text-neutral-50">{r.model.games ? `${r.model.right}–${r.model.games - r.model.right}` : '–'}</div><div className="text-xs text-neutral-500">{r.model.games ? `${pct(r.model.right / r.model.games)} of ${r.model.games} games` : 'no stored model numbers'}</div></div>
        <div className="rounded-xl bg-neutral-900 px-4 py-3"><div className="text-xs uppercase tracking-widest text-neutral-500">When they disagreed</div><div className="text-2xl tabular-nums text-neutral-50">{d.n ? `${d.gutWon}–${d.modelWon}` : '–'}</div><div className="text-xs text-neutral-500">{d.n ? `gut vs the model, ${d.n} games` : 'no disagreements yet'}</div></div>
      </div>
      <p className="rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
        {r.verdict}{d.lo != null && d.hi != null && d.n >= 10 && <span className="text-xs text-neutral-500"> The gut's share of the disagreements: {pct(d.gutShare ?? 0)} (range {pct(d.lo)} to {pct(d.hi)}; 50% means no difference). A verdict needs at least {MIN_DISAGREEMENTS} of them.</span>}
      </p>
      <div className="overflow-x-auto rounded-xl bg-neutral-900">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="text-left text-neutral-500"><tr><th className="px-3 py-1.5 font-normal">How sure</th><th className="px-2 py-1.5 text-right font-normal">Games</th><th className="px-3 py-1.5 text-right font-normal">Right</th></tr></thead>
          <tbody>{r.byLevel.map((l) => <tr key={l.level} className="border-t border-neutral-800/60"><td className="px-3 py-1.5 text-neutral-300">{l.label}</td><td className="px-2 py-1.5 text-right tabular-nums text-neutral-400">{l.n}</td><td className="px-3 py-1.5 text-right tabular-nums text-neutral-100">{l.n ? pct(l.right / l.n) : '–'}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-600">If "Lock" is not right more often than "Lean", the confidence is not telling anything yet. Small numbers swing a lot.</p>
      {recent.length > 0 && (
        <ul className="space-y-1 text-xs text-neutral-400">
          {recent.map((g) => {
            const picked = g.pick === 'home' ? g.home : g.away
            const right = (g.pick === 'home') === g.homeWon
            return <li key={`${g.date}${g.home}${g.away}`} className="flex flex-wrap items-baseline gap-x-2"><span className="tabular-nums text-neutral-600">{g.date.slice(5)}</span><span>{g.away} @ {g.home}</span><span className="text-neutral-300">picked {picked}</span><span className={right ? 'text-emerald-400' : 'text-red-300'}>{right ? 'right' : 'wrong'}</span>{g.note && <span className="text-neutral-600">“{g.note}”</span>}</li>
          })}
        </ul>
      )}
    </section>
  )
}

export default function GutRecord() {
  const [res, setRes] = useState<Res | null>(null)
  useEffect(() => {
    let live = true
    api<Res>('/gut').then((r) => live && setRes(r)).catch(() => live && setRes(null))
    return () => { live = false }
  }, [])
  if (!res) return null
  return (
    <div className="space-y-6">
      {(['claude'] as Source[]).map((s) => <Section key={s} source={s} r={res.data.records[s]} recent={res.data.recent[s]} canEdit={res.meta.canEdit} />)}
    </div>
  )
}
