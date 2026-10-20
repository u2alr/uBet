import { useEffect, useRef } from 'react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * A number that eases to its new value instead of jumping. It writes the text straight into the element on each
 * animation frame, so React does not re-render anything while it counts. Respects "reduce motion".
 */
export default function AnimatedNumber({ value, digits = 1, ms = 500, suffix = '' }: { value: number | null; digits?: number; ms?: number; suffix?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const from = useRef<number | null>(null)
  const text = (v: number | null) => (v === null ? '–' : `${v.toFixed(digits)}${suffix}`)
  useEffect(() => {
    const node = el.current
    if (!node) return
    const a = from.current, b = value
    from.current = b
    if (a === null || b === null || a === b || reduced()) { node.textContent = text(b); return }
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      node.textContent = text(a + (b - a) * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms, digits, suffix])
  return <span ref={el}>{text(value)}</span>
}
