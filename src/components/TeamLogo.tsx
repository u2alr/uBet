import { useState } from 'react'
import { logoUrl } from '../lib/teams'

/** A team logo that falls back to the team's abbreviation instead of a broken-image box. */
export default function TeamLogo({ id, abbr, size }: { id: number; abbr: string; size: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[11px] font-medium text-neutral-400" style={{ width: size, height: size }} aria-hidden>{size >= 32 ? abbr : ''}</span>
  return <img src={logoUrl(id)} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className="shrink-0" />
}
