// Claude's "gut": its own pick for a game, made before tip-off and scored later against the model on the games that have finished.
// It never changes a displayed number. A pick is worth nothing until enough finished games say whether it beats the model, so the record says "too early" until then.

export type Side = 'home' | 'away'
/** Who made the pick. Only Claude's are kept; the column stays so a second author could be added without a migration. */
export type Source = 'claude'
export const SOURCES: Source[] = ['claude']
export type Level = 1 | 2 | 3
export const LEVELS: { level: Level; label: string }[] = [{ level: 1, label: 'Lean' }, { level: 2, label: 'Pretty sure' }, { level: 3, label: 'Lock' }]
export const NOTE_MAX = 300
/** Fewest games where the gut and the model disagreed before the record says anything about who is better. */
export const MIN_DISAGREEMENTS = 50

export interface GutPick { source: Source; date: string; home: string; away: string; pick: Side; level: Level; note: string | null; modelHomeProb: number | null; savedAt: string }
export interface GutResult extends GutPick { homeWon: boolean }

/** What the app needs to name one game when saving or looking up a pick: the ET date and the two standard team codes. */
export interface GutRef { date: string; home: string; away: string }

export const gutKey = (date: string, home: string, away: string) => `${date}|${home}|${away}`

export type Parsed = { ok: true; value: { source: Source; date: string; home: string; away: string; pick: Side; level: Level; note: string | null } } | { ok: false; error: string }

/** Checks a request body. The team codes and the date only select a game; the server still has to find that game in the schedule. */
export function parsePick(b: unknown): Parsed {
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return { ok: false, error: 'body must be a JSON object' }
  const o = b as Record<string, unknown>
  const code = (v: unknown) => (typeof v === 'string' && /^[A-Z]{2,4}$/.test(v) ? v : null)
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null
  const home = code(o.home), away = code(o.away)
  if (!date || !home || !away || home === away) return { ok: false, error: 'date (YYYY-MM-DD) and two different team codes are required' }
  if (o.pick !== 'home' && o.pick !== 'away') return { ok: false, error: 'pick must be "home" or "away"' }
  if (o.level !== 1 && o.level !== 2 && o.level !== 3) return { ok: false, error: 'level must be 1 (lean), 2 (pretty sure) or 3 (lock)' }
  if (o.source != null && o.source !== 'claude') return { ok: false, error: 'source must be "claude"' }
  let note: string | null = null
  if (o.note != null && o.note !== '') {
    if (typeof o.note !== 'string') return { ok: false, error: 'note must be text' }
    note = o.note.trim().slice(0, NOTE_MAX) || null
  }
  return { ok: true, value: { source: 'claude', date, home, away, pick: o.pick, level: o.level, note } }
}

/** A pick can be saved, changed or cleared only before the game starts: afterwards it would be written with the result in mind. */
export const isOpen = (tipIso: string, nowMs: number) => Number.isFinite(Date.parse(tipIso)) && Date.parse(tipIso) > nowMs

export interface LevelRecord { level: Level; label: string; n: number; right: number }
export interface GutRecord {
  games: number
  right: number
  byLevel: LevelRecord[]
  /** The model on the same games (only those where its pre-game number was stored). */
  model: { games: number; right: number }
  /** Games where the gut and the model picked different teams: the only place one can be better than the other. */
  disagreements: { n: number; gutWon: number; modelWon: number; gutShare: number | null; lo: number | null; hi: number | null }
  verdict: string
}

/** Wilson 95% interval for a share: it stays inside 0..1 and is honest at small n. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null
  const p = k / n, d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

export function scoreGut(rows: GutResult[]): GutRecord {
  const right = (r: GutResult) => (r.pick === 'home') === r.homeWon
  const byLevel = LEVELS.map(({ level, label }) => { const g = rows.filter((r) => r.level === level); return { level, label, n: g.length, right: g.filter(right).length } })
  const withModel = rows.filter((r) => r.modelHomeProb != null && r.modelHomeProb !== 0.5)
  const modelSide = (r: GutResult): Side => (r.modelHomeProb! > 0.5 ? 'home' : 'away')
  const modelRight = withModel.filter((r) => (modelSide(r) === 'home') === r.homeWon).length
  const dis = withModel.filter((r) => modelSide(r) !== r.pick)
  const gutWon = dis.filter(right).length
  const ci = wilson(gutWon, dis.length)
  let verdict: string
  if (dis.length < MIN_DISAGREEMENTS) verdict = `Too early to say. ${MIN_DISAGREEMENTS - dis.length} more games where Claude's gut and the model disagree are needed before this means anything.`
  else if (ci && ci[0] > 0.5) verdict = `On the games where Claude disagreed with the model, Claude's gut won more often, and the gap is bigger than chance.`
  else if (ci && ci[1] < 0.5) verdict = 'On the games where Claude disagreed with the model, the model won more often, and the gap is bigger than chance.'
  else verdict = 'No difference you could tell from luck: when Claude disagreed with the model, neither side won clearly more often.'
  return {
    games: rows.length, right: rows.filter(right).length, byLevel,
    model: { games: withModel.length, right: modelRight },
    disagreements: { n: dis.length, gutWon, modelWon: dis.length - gutWon, gutShare: dis.length ? gutWon / dis.length : null, lo: ci?.[0] ?? null, hi: ci?.[1] ?? null },
    verdict,
  }
}
