// Wording for every number on the Props board. One place, so tooltips and the legend cannot disagree.
export const METRIC: Record<string, { label: string; short: string; long: string }> = {
  ev: { label: 'EV', short: 'Expected profit per 1 staked', long: 'Expected value: the average profit per unit staked at a price two independent books support, using the win chance blended from the calibrated model and the books' no-margin price. A return on stake, not a probability. +5% means 5 cents of expected profit per dollar staked. A line with a tilde (≈) uses an older simple blend that has not been validated.' },
  proj: { label: 'Proj', short: "The model's projected total", long: "The model's projected average for this stat tonight. The gap to the line is shown in brackets, signed toward the side shown." },
  model: { label: 'Model', short: "The model's win chance", long: "The model's chance that this side wins, calibrated against past results, before the market is considered. Compare it with Market: a big gap often means news the model cannot see." },
  market: { label: 'Market', short: 'Win chance the books imply', long: "The win chance implied by the books' prices after removing their margin: the median over independent books with fresh two-sided quotes." },
  hit: { label: 'Last 10', short: 'Recent hit rate', long: 'How many of the last 10 played games landed on this side of the line. History only: it ignores price, opponent and minutes, and is not a forecast.' },
  games: { label: 'Games', short: 'Games of history', long: 'Games behind the estimate. Few games means a noisy projection.' },
  win: { label: 'Win %', short: 'Blended win chance', long: 'The win chance the app uses: the calibrated model blended with the market, given the bet is not refunded. EV is computed from this. A high win chance does not make a bet good value: a likely outcome at a short price can lose money on average.' },
}

