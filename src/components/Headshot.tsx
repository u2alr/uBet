import { useState } from 'react'

// NBA.com serves headshots by the same player id the database uses. The image is a cut-out (transparent
// background), so it is shown whole with no frame or fill. A missing image (rookies, new signings) falls back
// to initials so a row never shows a broken picture.
const url = (id: number) => `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`
const RATIO = 260 / 190

export default function Headshot({ id, name, size = 44 }: { id: number; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('')
    return (
      <span className="inline-flex shrink-0 items-center justify-center text-xs text-neutral-500" style={{ width: size * RATIO, height: size }} aria-hidden>
        {initials}
      </span>
    )
  }
  return (
    <img
      src={url(id)} alt="" loading="lazy" onError={() => setFailed(true)}
      style={{ width: size * RATIO, height: size }} className="shrink-0 object-contain object-bottom"
    />
  )
}
