import { METRIC } from '../lib/metricText'

/** A label with its meaning attached: hover for the text, focusable for keyboard users, full definitions in the legend. */
export function Term({ k, children }: { k: keyof typeof METRIC; children?: React.ReactNode }) {
  const m = METRIC[k]
  return <abbr title={`${m.short}. ${m.long}`} className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline focus-visible:underline" tabIndex={0}>{children ?? m.label}</abbr>
}

export default function MetricGuide() {
  return (
    <details className="text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-xs text-neutral-500 hover:text-neutral-300 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-current text-[11px] leading-none">?</span> What the numbers mean
      </summary>
      <dl className="mt-2 grid gap-x-8 gap-y-3 rounded-xl border border-neutral-800 p-4 text-xs sm:grid-cols-2">
        {Object.values(METRIC).map((m) => (
          <div key={m.label}><dt className="font-medium text-neutral-200">{m.label} <span className="font-normal text-neutral-500">· {m.short}</span></dt><dd className="mt-0.5 text-neutral-400">{m.long}</dd></div>
        ))}
        <div className="text-neutral-500 sm:col-span-2">Sorting by hit rate ranks history only. Sorting by EV ranks by expected value. They are different questions and often disagree.</div>
      </dl>
    </details>
  )
}
