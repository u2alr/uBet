import type { GameRow } from './stats'

// What a prop can be about. Singles are what books post lines for here; the combinations are computed from the box score
// (so there are no book prices for them, but the line can still be typed in and tested).
export const PROP_VIEWS = [
  { key: 'pra', label: 'PRA', long: 'P+R+A', parts: ['pts', 'reb', 'ast'] },
  { key: 'pts', label: 'PTS', long: 'Points', parts: ['pts'] },
  { key: 'reb', label: 'REB', long: 'Rebounds', parts: ['reb'] },
  { key: 'ast', label: 'AST', long: 'Assists', parts: ['ast'] },
  { key: 'fg3m', label: '3PM', long: 'Threes', parts: ['fg3m'] },
  { key: 'pr', label: 'P+R', long: 'P+R', parts: ['pts', 'reb'] },
  { key: 'pa', label: 'P+A', long: 'P+A', parts: ['pts', 'ast'] },
  { key: 'ra', label: 'R+A', long: 'R+A', parts: ['reb', 'ast'] },
  { key: 'stl', label: 'STL', long: 'Steals', parts: ['stl'] },
  { key: 'blk', label: 'BLK', long: 'Blocks', parts: ['blk'] },
] as const satisfies readonly { key: string; label: string; long: string; parts: readonly (keyof GameRow)[] }[]

export type PropViewKey = (typeof PROP_VIEWS)[number]['key']
export const isSingle = (k: PropViewKey) => PROP_VIEWS.find((v) => v.key === k)!.parts.length === 1

export const viewValue = (g: GameRow, k: PropViewKey): number =>
  PROP_VIEWS.find((v) => v.key === k)!.parts.reduce((a, p) => a + (g[p as keyof GameRow] as number), 0)
