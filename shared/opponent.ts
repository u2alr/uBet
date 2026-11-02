// Opponent tendency: how much of each stat a team has allowed over its last 20 games relative to the league. One definition, used by the
// Worker, so every screen gives the same matchup answer.
import { TEAM_NAMES, type Pick } from './picks.ts'

export const OPP_STATS = ['pts', 'reb', 'ast', 'fg3m', 'pra'] as const
export type OppStat = (typeof OPP_STATS)[number]

/** Rows: one per team with its average allowed per game over the last 20 regular-season games (teams with at least 10 games). */
export const OPP_ALLOWED_SQL = `WITH tg AS (
    SELECT pg.opp AS team, g.id AS gid, g.date, SUM(pg.pts) AS pts, SUM(pg.reb) AS reb, SUM(pg.ast) AS ast, SUM(pg.fg3m) AS fg3m, SUM(pg.pts + pg.reb + pg.ast) AS pra
    FROM player_games pg JOIN games g ON g.id = pg.game_id WHERE pg.opp IS NOT NULL AND g.game_type = 'regular' GROUP BY pg.opp, g.id),
  r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY team ORDER BY date DESC) AS rn FROM tg)
  SELECT team, AVG(pts) AS pts, AVG(reb) AS reb, AVG(ast) AS ast, AVG(fg3m) AS fg3m, AVG(pra) AS pra, COUNT(*) AS n FROM r WHERE rn <= 20 GROUP BY team HAVING n >= 10`

export type AllowedRow = { team: string } & Record<OppStat, number>

/** team -> stat -> ratio to the league average (above 1: the team allows more than average). Empty when there are no rows. */
export function buildOppTable(rows: AllowedRow[]): Record<string, Record<string, number>> {
  const league = Object.fromEntries(OPP_STATS.map((s) => [s, rows.reduce((a, r) => a + r[s], 0) / (rows.length || 1)]))
  return Object.fromEntries(rows.map((r) => [r.team, Object.fromEntries(OPP_STATS.map((s) => [s, league[s] ? r[s] / league[s] : 1]))]))
}

/** Fills each pick's `oppFactor` from the opponent table (null when the opponent or stat has no row). */
export function attachOpponent<P extends Pick>(picks: P[], table: Record<string, Record<string, number>>): P[] {
  const byName = new Map(Object.entries(TEAM_NAMES).map(([abbr, name]) => [name, abbr]))
  return picks.map((p) => {
    const [away, home] = p.game.split(' @ ')
    const oppName = p.teamName === away ? home : p.teamName === home ? away : null
    const opp = oppName ? byName.get(oppName) : undefined
    return { ...p, oppFactor: opp ? table[opp]?.[p.stat] ?? null : null }
  })
}
