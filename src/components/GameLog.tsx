import { useState } from 'react'
import { fmt } from '../lib/format'
import { perSeason, type GameRow } from '../lib/stats'

const pctText = (n: number | null) => (n == null ? '–' : `${n.toFixed(1)}`)

export default function GameLog({ games }: { games: GameRow[] }) {
  const [all, setAll] = useState(false)
  const rows = all ? games : games.slice(0, 15)
  const th = 'px-2 py-2 text-right font-normal'
  const td = 'px-2 py-2 text-right tabular-nums'

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg bg-neutral-900">
        <div className="flex items-baseline justify-between px-4 pt-4">
          <h3 className="text-xs uppercase tracking-widest text-neutral-500">Game log</h3>
          <span className="text-xs text-neutral-600">{games.length} games</span>
        </div>
        <table className="mt-2 w-full whitespace-nowrap text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 text-left font-normal">Date</th>
              <th className="px-2 py-2 text-left font-normal">Opp</th>
              <th className={th}>MIN</th><th className={th}>PTS</th><th className={th}>REB</th><th className={th}>AST</th>
              <th className={th}>3PM</th><th className={th}>STL</th><th className={th}>BLK</th>
              <th className={th}>FG</th><th className={th}>3P</th><th className={th}>FT</th>
              <th className={th}>TO</th><th className="px-4 py-2 text-right font-normal">+/-</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {rows.map((g, i) => (
              <tr key={i} className="hover:bg-neutral-800/60">
                <td className="px-4 py-2 text-neutral-400">{g.date}{g.gameType === 'playoffs' && <span className="ml-2 text-xs text-neutral-100">PO</span>}</td>
                <td className="px-2 py-2">
                  <span className="text-neutral-600">{g.home ? 'vs' : '@'}</span> {g.opp ?? '–'}{' '}
                  <span className={g.won ? 'text-neutral-100' : 'text-neutral-600'}>{g.won ? 'W' : 'L'}</span>
                </td>
                <td className={`${td} text-neutral-400`}>{Math.round(g.minutes)}</td>
                <td className={`${td} text-neutral-100`}>{g.pts}</td>
                <td className={td}>{g.reb}</td>
                <td className={td}>{g.ast}</td>
                <td className={td}>{g.fg3m}</td>
                <td className={td}>{g.stl}</td>
                <td className={td}>{g.blk}</td>
                <td className={`${td} text-neutral-400`}>{g.fgm}-{g.fga}</td>
                <td className={`${td} text-neutral-400`}>{g.fg3m}-{g.fg3a}</td>
                <td className={`${td} text-neutral-400`}>{g.ftm}-{g.fta}</td>
                <td className={td}>{g.tov}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-400">
                  {g.plusMinus > 0 ? `+${g.plusMinus}` : g.plusMinus}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {games.length > 15 && (
          <button className="w-full py-3 text-xs text-neutral-500 hover:text-neutral-300" onClick={() => setAll(!all)}>
            {all ? 'Show less' : `Show all ${games.length}`}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg bg-neutral-900">
        <h3 className="px-4 pt-4 text-xs uppercase tracking-widest text-neutral-500">Season averages</h3>
        <table className="mt-2 w-full whitespace-nowrap text-sm">
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 text-left font-normal">Season</th>
              <th className={th}>GP</th><th className={th}>MIN</th><th className={th}>PTS</th><th className={th}>REB</th>
              <th className={th}>AST</th><th className={th}>3PM</th><th className={th}>FG%</th>
              <th className="px-4 py-2 text-right font-normal">TS%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {perSeason(games).map((s) => (
              <tr key={s.season}>
                <td className="px-4 py-2 text-neutral-100">{s.season}</td>
                <td className={td}>{s.games}</td>
                <td className={td}>{fmt(s.min)}</td>
                <td className={`${td} text-neutral-100`}>{fmt(s.pts)}</td>
                <td className={td}>{fmt(s.reb)}</td>
                <td className={td}>{fmt(s.ast)}</td>
                <td className={td}>{fmt(s.fg3m)}</td>
                <td className={td}>{pctText(s.fgPct)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pctText(s.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
