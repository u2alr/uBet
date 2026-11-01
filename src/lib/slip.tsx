import { useEffect, useState, type ReactNode } from 'react'
import { pickKey, type Pick } from './picks'
import { SlipContext, type Slip } from './slipContext'

const KEY = 'ubet-slip'
// Moneyline legs were removed; drop what an older version saved so it does not sit in storage forever.
try { localStorage.removeItem('ubet-slip-team') } catch { /* storage blocked */ }

/** Remember the slip across reloads. Blocked or full storage (private mode, a quota) only means it is not remembered: it must never break adding a leg. */
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* not remembered */ }
}

export function SlipProvider({ children }: { children: ReactNode }) {
  const [legs, setLegs] = useState<Pick[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
  })
  useEffect(() => save(KEY, legs), [legs])

  const has = (p: Pick) => legs.some((l) => pickKey(l) === pickKey(p))
  const value: Slip = {
    legs,
    has,
    toggle: (p) => setLegs((ls) => (ls.some((l) => pickKey(l) === pickKey(p)) ? ls.filter((l) => pickKey(l) !== pickKey(p)) : [...ls, p])),
    addAll: (ps) => setLegs((ls) => [...ls, ...ps.filter((p) => !ls.some((l) => pickKey(l) === pickKey(p)))]),
    remove: (p) => setLegs((ls) => ls.filter((l) => pickKey(l) !== pickKey(p))),
    clear: () => setLegs([]),
  }
  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>
}
