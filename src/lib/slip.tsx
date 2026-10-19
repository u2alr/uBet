import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { pickKey, type Pick } from './picks'

interface Slip {
  legs: Pick[]
  has: (p: Pick) => boolean
  toggle: (p: Pick) => void
  addAll: (ps: Pick[]) => void
  remove: (p: Pick) => void
  clear: () => void
}

const KEY = 'ubet-slip'
const Ctx = createContext<Slip | null>(null)

export function SlipProvider({ children }: { children: ReactNode }) {
  const [legs, setLegs] = useState<Pick[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
  })
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(legs)), [legs])

  const has = (p: Pick) => legs.some((l) => pickKey(l) === pickKey(p))
  const value: Slip = {
    legs,
    has,
    toggle: (p) => setLegs((ls) => (ls.some((l) => pickKey(l) === pickKey(p)) ? ls.filter((l) => pickKey(l) !== pickKey(p)) : [...ls, p])),
    addAll: (ps) => setLegs((ls) => [...ls, ...ps.filter((p) => !ls.some((l) => pickKey(l) === pickKey(p)))]),
    remove: (p) => setLegs((ls) => ls.filter((l) => pickKey(l) !== pickKey(p))),
    clear: () => setLegs([]),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSlip() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSlip must be used inside SlipProvider')
  return s
}
