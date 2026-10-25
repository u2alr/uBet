// Wording for every number on the Props board. One place, so tooltips and the legend cannot disagree.
export const METRIC: Record<string, { label: string; short: string; long: string }> = {
  ev: { label: 'EV', short: 'Expected profit per 1 staked', long: 'Expected value: the average profit per unit staked at the best price, using the win chance blended from model and market. A return on stake, not a probability. +5% means 5 cents of expected profit per dollar staked.' },
  proj: { label: 'Proj', short: "The model's projected total", long: "The model's projected average for this stat tonight. The gap to the line is shown in brackets, signed toward the side shown." },
  model: { label: 'Model', short: "The model's win chance", long: "The model's own chance that this side wins, before the market is considered. Compare it with Market: a big gap often means news the model cannot see." },
  market: { label: 'Market', short: 'Win chance the books imply', long: "The win chance implied by the books' prices after removing their margin, averaged over the books that quote both sides." },
  hit: { label: 'Last 10', short: 'Recent hit rate', long: 'How many of the last 10 played games landed on this side of the line. History only: it ignores price, opponent and minutes, and is not a forecast.' },
  games: { label: 'Games', short: 'Games of history', long: 'Games behind the estimate. Few games means a noisy projection.' },
  win: { label: 'Win %', short: 'Blended win chance', long: 'The win chance the app trusts: the model blended with the market, given the bet is not refunded. EV is computed from this.' },
}

