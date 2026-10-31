import { useEffect, useState, type ReactNode } from 'react'
import { pickKey, type Pick } from './picks'
import { teamLegKey, type TeamLeg } from '../../shared/teamBets.ts'
import { SlipContext, type Slip } from './slipContext'

const KEY = 'ubet-slip'
const TEAM_KEY = 'ubet-slip-team'

export function SlipProvider({ children }: { children: ReactNode }) {
  const [legs, setLegs] = useState<Pick[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
  })
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(legs)), [legs])
  const [teamLegs, setTeamLegs] = useState<TeamLeg[]>(() => {
    try { return JSON.parse(localStorage.getItem(TEAM_KEY) ?? '[]') } catch { return [] }
  })
  useEffect(() => localStorage.setItem(TEAM_KEY, JSON.stringify(teamLegs)), [teamLegs])

  const has = (p: Pick) => legs.some((l) => pickKey(l) === pickKey(p))
  const value: Slip = {
    legs,
    teamLegs,
    hasTeam: (l) => teamLegs.some((t) => teamLegKey(t) === teamLegKey(l)),
    // Picking the other side of a game replaces the first: both teams cannot win.
    toggleTeam: (l) => setTeamLegs((ts) => (ts.some((t) => teamLegKey(t) === teamLegKey(l)) ? ts.filter((t) => teamLegKey(t) !== teamLegKey(l)) : [...ts.filter((t) => t.gameId !== l.gameId), l])),
    removeTeam: (l) => setTeamLegs((ts) => ts.filter((t) => teamLegKey(t) !== teamLegKey(l))),
    has,
    toggle: (p) => setLegs((ls) => (ls.some((l) => pickKey(l) === pickKey(p)) ? ls.filter((l) => pickKey(l) !== pickKey(p)) : [...ls, p])),
    addAll: (ps) => setLegs((ls) => [...ls, ...ps.filter((p) => !ls.some((l) => pickKey(l) === pickKey(p)))]),
    remove: (p) => setLegs((ls) => ls.filter((l) => pickKey(l) !== pickKey(p))),
    clear: () => { setLegs([]); setTeamLegs([]) },
  }
  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>
}
