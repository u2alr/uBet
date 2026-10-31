// Team (moneyline) legs for parlays: "ATL + GSW + MIN + LAL". Pure functions, no network.
// The app has no game-winner model, so a team leg carries the MARKET's no-margin win chance (averaged over books), not its own estimate. Expected value on a team leg
// therefore measures only price shopping against that consensus (the best price across books versus the average no-margin chance); it is not an edge claim.

export interface TeamLeg {
  kind: 'team'
  gameId: string
  /** "Away Name @ Home Name" as the schedule has it. */
  game: string
  team: string
  opponent: string
  home: boolean
  /** Decimal moneyline: the best price across books. */
  price: number
  /** The market's no-margin chance that this team wins. */
  marketProb: number
  date: string
}

export interface GameForTeamBets {
  id: string; date: string; state: 'pre' | 'in' | 'post'
  home: { abbr: string; name?: string }; away: { abbr: string; name?: string }
  odds?: { homeWinProb: number | null; bestMoneyline?: { home: number; away: number } | null } | null
}

export const teamLegKey = (l: Pick<TeamLeg, 'gameId' | 'team'>) => `team|${l.gameId}|${l.team}`

/** Both sides of every game that has not started and has a price. Games without odds produce no legs: a price is never invented. */
export function teamLegsFromGames(games: GameForTeamBets[], norm: (abbr: string) => string = (a) => a): TeamLeg[] {
  const out: TeamLeg[] = []
  for (const g of games) {
    const p = g.odds?.homeWinProb, ml = g.odds?.bestMoneyline
    if (g.state !== 'pre' || p == null || !Number.isFinite(p) || !ml || !(ml.home > 1) || !(ml.away > 1)) continue
    const home = norm(g.home.abbr), away = norm(g.away.abbr)
    const label = `${g.away.name ?? away} @ ${g.home.name ?? home}`
    out.push({ kind: 'team', gameId: g.id, game: label, team: home, opponent: away, home: true, price: ml.home, marketProb: p, date: g.date })
    out.push({ kind: 'team', gameId: g.id, game: label, team: away, opponent: home, home: false, price: ml.away, marketProb: 1 - p, date: g.date })
  }
  return out
}

/** Two teams from one game cannot both win. */
export function conflicts(legs: Pick<TeamLeg, 'gameId' | 'team'>[]): boolean {
  const games = new Set<string>()
  for (const l of legs) {
    if (games.has(l.gameId)) return true
    games.add(l.gameId)
  }
  return false
}

export interface Combined { odds: number; prob: number; ev: number }
export interface Priced { price: number; prob: number }

/** Product of prices and of probabilities. The chance assumes the legs are independent, which is exact only for different games with no shared drivers. */
export function combineLegs(legs: Priced[]): Combined {
  const odds = legs.reduce((a, l) => a * l.price, 1)
  const prob = legs.reduce((a, l) => a * l.prob, 1)
  return { odds, prob, ev: prob * odds - 1 }
}

/** "ATL + GSW + MIN + LAL" */
export const parlayLabel = (legs: Pick<TeamLeg, 'team'>[]) => legs.map((l) => l.team).join(' + ')
