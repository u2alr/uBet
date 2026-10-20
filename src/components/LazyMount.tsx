import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Renders its children only once they are about to scroll into view, holding their place with a fixed-height box so
 * the page does not jump. Charts are the expensive part of every page here; ones below the fold should not delay
 * the first paint or the first click.
 */
export default function LazyMount({ children, height, margin = 150 }: { children: ReactNode; height: number; margin?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (shown || !el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect() }
    }, { rootMargin: `${margin}px 0px` })
    io.observe(el)
    return () => io.disconnect()
  }, [shown, margin])
  return shown ? <>{children}</> : <div ref={ref} style={{ minHeight: height }} aria-hidden />
}
