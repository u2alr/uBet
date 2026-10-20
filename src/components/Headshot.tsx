import { useState } from 'react'

// NBA.com serves headshots by the same player id the database uses. A missing image (rookies, new signings)
// falls back to initials so a row never shows a broken picture.
const url = (id: number) => `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`

export default function Headshot({ id, name, size = 28 }: { id: number; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const box = { width: size, height: size }
  if (failed) {
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('')
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-neutral-400" style={box} aria-hidden>
        {initials}
      </span>
    )
  }
  return (
    <img
      src={url(id)} alt="" loading="lazy" onError={() => setFailed(true)} style={box}
      className="shrink-0 rounded-full bg-neutral-800 object-cover object-top"
    />
  )
}
