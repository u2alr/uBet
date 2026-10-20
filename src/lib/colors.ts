import type { Stat } from '../../shared/baseline.ts'

// Chart colours. Validated with the dataviz skill's validator against this app's card colour (#171717):
// lightness band, chroma, colour-blind separation of neighbouring slots, and 3:1 contrast all pass.
// A statistic keeps ONE colour on every chart, so it is learned once. Slots follow the palette's documented
// order, which is what makes the colour-blind check pass: do not reorder them.
export const STAT_COLOR: Record<Stat, string> = {
  pts: '#3987e5', // blue    (slot 1)
  reb: '#d95926', // orange  (slot 2)
  ast: '#199e70', // aqua    (slot 3)
  fg3m: '#c98500', // yellow  (slot 4)
  stl: '#d55181', // magenta (slot 5)
  blk: '#008300', // green   (slot 6)
}

export const MINUTES_COLOR = '#9085e9' // violet (slot 7)
/** Shooting percentages borrow the colour of the statistic they relate to: FG% ~ points, 3P% ~ threes. */
export const SHOOTING_COLOR = { fg: STAT_COLOR.pts, three: STAT_COLOR.fg3m, ft: STAT_COLOR.stl }

export const INK = {
  grid: '#262626',
  axis: '#525252',
  /** The betting line and averages: neutral, because they describe the data rather than being a statistic. */
  reference: '#e5e5e5',
  /** Bars that did not clear the line recede. */
  miss: '#404040',
  /** Chart text always wears text colours, never the series colour. */
  legend: '#a3a3a3',
  tooltip: '#d4d4d4',
}
