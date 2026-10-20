import { createContext, useContext } from 'react'
import type { Pick } from './picks'

export interface Slip {
  legs: Pick[]
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
