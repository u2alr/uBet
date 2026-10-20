import { useEffect, useRef, useState } from 'react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A number that eases to its new value instead of jumping. Respects "reduce motion". */
export default function AnimatedNumber({ value, digits = 1, ms = 500, suffix = '' }: { value: number | null; digits?: number; ms?: number; suffix?: string }) {
  const [shown, setShown] = useState<number | null>(value)
  const from = useRef<number | null>(value)
  useEffect(() => {
    if (value === null || from.current === null || reduced()) { from.current = value; setShown(value); return }
    const start = performance.now(), a = from.current, b = value
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(a + (b - a) * eased)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = b
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = b }
  }, [value, ms])
  return <>{shown === null ? '–' : `${shown.toFixed(digits)}${suffix}`}</>
}
