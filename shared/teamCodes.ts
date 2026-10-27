// Team abbreviations: ESPN's differ from NBA.com's for six teams, and the rest of the app uses NBA.com's. One module, one data file (teamCodes.json),
// so a code cannot be mapped one way in the Worker, another in the browser and a third in the Python projection job.
import codes from './teamCodes.json' with { type: 'json' }

export const ESPN_TO_NBA: Readonly<Record<string, string>> = codes.espnToNba
export const NBA_ABBRS: readonly string[] = codes.nba

/** An ESPN or NBA.com abbreviation as the NBA.com one. Unknown codes are returned unchanged (so they stay visible rather than turning into something else). */
export const normAbbr = (abbr: string): string => ESPN_TO_NBA[abbr] ?? abbr

export const isNbaAbbr = (abbr: string): boolean => NBA_ABBRS.includes(abbr)

/** NBA.com team ids by abbreviation (they also name the logo files). */
export const TEAM_IDS: Readonly<Record<string, number>> = codes.ids
export const abbrOfTeamId = (id: number): string | null => Object.entries(codes.ids).find(([, v]) => v === id)?.[0] ?? null
