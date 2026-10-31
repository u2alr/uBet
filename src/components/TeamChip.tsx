import TeamLogo from './TeamLogo'

/** A team logo on a light round backing. Dark artwork (POR, CLE, SAS) disappears on the near-black page without it, and one size keeps the rows even. */
export default function TeamChip({ id, abbr, size = 24 }: { id: number; abbr: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-neutral-100/90" style={{ width: size, height: size }}>
      <TeamLogo id={id} abbr={abbr} size={Math.round(size * 0.72)} />
    </span>
  )
}
