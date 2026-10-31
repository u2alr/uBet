import { createContext, useContext } from 'react'
import type { TeamLeg, teamLegKey } from '../../shared/teamBets.ts'
import type { Pick } from './picks'

export interface Slip {
  legs: Pick[]
  /** Moneyline legs ("ATL + GSW + MIN + LAL"): priced from the market, priced together with the prop legs. */
  teamLegs: TeamLeg[]
  hasTeam: (l: Parameters<typeof teamLegKey>[0]) => boolean
  toggleTeam: (l: TeamLeg) => void
  removeTeam: (l: TeamLeg) => void
  has: (p: Pick) => boolean
  toggle: (p: Pick) => void
  addAll: (ps: Pick[]) => void
  remove: (p: Pick) => void
  clear: () => void
}

export const SlipContext = createContext<Slip | null>(null)

export function useSlip() {
  const s = useContext(SlipContext)
  if (!s) throw new Error('useSlip must be used inside SlipProvider')
  return s
}
