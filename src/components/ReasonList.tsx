export type Kind = 'for' | 'against' | 'caution' | 'context'

const MARK: Record<Kind, { glyph: string; cls: string; name: string }> = {
  for: { glyph: '+', cls: 'text-emerald-400', name: 'For' },
  against: { glyph: '−', cls: 'text-red-400', name: 'Against' },
  caution: { glyph: '!', cls: 'text-amber-500', name: 'Caution' },
  context: { glyph: '·', cls: 'text-neutral-500', name: 'Context' },
}

/** Reasons as a short list: + points toward the call, − points away, ! makes it less certain, · is background that is not counted either way. */
export default function ReasonList({ title, reasons }: { title: string; reasons: { kind: Kind; label: string; text: string }[] }) {
  if (!reasons.length) return null
  return (
    <div className="rounded-xl bg-neutral-950/50 px-3 py-2.5">
      <h3 className="mb-1.5 text-xs font-medium text-neutral-300">{title}</h3>
      <ul className="space-y-1">
        {reasons.map((r) => (
          <li key={r.label} className="flex gap-2 text-xs leading-snug text-neutral-400">
            <span aria-hidden className={`w-3 shrink-0 text-center font-semibold ${MARK[r.kind].cls}`}>{MARK[r.kind].glyph}</span>
            <span><span className="sr-only">{MARK[r.kind].name}: </span><b className="font-medium text-neutral-300">{r.label}.</b> {r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
