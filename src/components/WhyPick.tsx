import { useId, useState } from 'react'
import { pickReasons } from '../lib/pickReasons'
import type { Card } from '../lib/propsBoard'
import ReasonList from './ReasonList'

/** The reasons behind the lead side of a card. Closed until clicked: the closed state only counts them. */
export default function WhyPick({ c }: { c: Card }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const reasons = pickReasons(c)
  if (!reasons.length) return null
  const n = (k: string) => reasons.filter((r) => r.kind === k).length
  const summary = [`${n('for')} for`, `${n('against')} against`, `${n('caution')} caution${n('caution') === 1 ? '' : 's'}`].join(' · ')
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center gap-2 rounded-lg text-left text-xs text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500">
        <span aria-hidden className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        <span className="font-medium text-neutral-300">Why the {c.lead.side}?</span>
        <span className="text-neutral-500">{summary}</span>
      </button>
      {open && <div id={id} className="mt-2"><ReasonList title={`Why the ${c.lead.side}`} reasons={reasons} /></div>}
    </div>
  )
}
