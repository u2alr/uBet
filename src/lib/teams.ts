// NBA.com team ids (they name the logo files) with the tricodes the box scores use.
export const TEAMS: [abbr: string, id: number, name: string][] = [
  ['ATL', 1610612737, 'Atlanta Hawks'], ['BOS', 1610612738, 'Boston Celtics'], ['CLE', 1610612739, 'Cleveland Cavaliers'],
  ['NOP', 1610612740, 'New Orleans Pelicans'], ['CHI', 1610612741, 'Chicago Bulls'], ['DAL', 1610612742, 'Dallas Mavericks'],
  ['DEN', 1610612743, 'Denver Nuggets'], ['GSW', 1610612744, 'Golden State Warriors'], ['HOU', 1610612745, 'Houston Rockets'],
  ['LAC', 1610612746, 'LA Clippers'], ['LAL', 1610612747, 'Los Angeles Lakers'], ['MIA', 1610612748, 'Miami Heat'],
  ['MIL', 1610612749, 'Milwaukee Bucks'], ['MIN', 1610612750, 'Minnesota Timberwolves'], ['BKN', 1610612751, 'Brooklyn Nets'],
  ['NYK', 1610612752, 'New York Knicks'], ['ORL', 1610612753, 'Orlando Magic'], ['IND', 1610612754, 'Indiana Pacers'],
  ['PHI', 1610612755, 'Philadelphia 76ers'], ['PHX', 1610612756, 'Phoenix Suns'], ['POR', 1610612757, 'Portland Trail Blazers'],
  ['SAC', 1610612758, 'Sacramento Kings'], ['SAS', 1610612759, 'San Antonio Spurs'], ['OKC', 1610612760, 'Oklahoma City Thunder'],
  ['TOR', 1610612761, 'Toronto Raptors'], ['UTA', 1610612762, 'Utah Jazz'], ['MEM', 1610612763, 'Memphis Grizzlies'],
  ['WAS', 1610612764, 'Washington Wizards'], ['DET', 1610612765, 'Detroit Pistons'], ['CHA', 1610612766, 'Charlotte Hornets'],
]
const norm = (n: string) => n.replace(/^Los Angeles Clippers$/, 'LA Clippers').toLowerCase()
export const teamId = (abbr: string | null | undefined) => TEAMS.find((t) => t[0] === abbr)?.[1] ?? null
export const teamByName = (name: string) => TEAMS.find((t) => norm(t[2]) === norm(name)) ?? null
export const logoUrl = (id: number) => `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`
