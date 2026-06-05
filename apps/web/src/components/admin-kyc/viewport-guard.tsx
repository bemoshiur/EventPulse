'use client'

/**
 * AdminViewportGuard — Sprint 2 Day 18 Item 13 PR 4.
 *
 * Per user brief §2.3: "Responsive at desktop only. Reviewer workflow
 * is desktop-oriented (large screen, document viewer + form
 * side-by-side). Mobile responsive is explicitly out of scope for
 * Item 13 — surface a warning banner on viewports under 1024px saying
 * 'KYC review queue is desktop-optimised; please use a larger screen
 * for accurate document review.'"
 *
 * Renders the children unchanged on >= 1024px viewports; surfaces a
 * full-page banner on smaller viewports. Listens to resize so the
 * banner toggles when DevTools opens/closes or the window resizes.
 */

import { useEffect, useState } from 'react'

const MIN_DESKTOP_WIDTH = 1024

export function AdminViewportGuard({ children }: { children: React.ReactNode }) {
  const [isTooNarrow, setIsTooNarrow] = useState(false)

  useEffect(() => {
    function check() {
      setIsTooNarrow(window.innerWidth < MIN_DESKTOP_WIDTH)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  if (isTooNarrow) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[var(--ep-amber)]/40 bg-[var(--ep-amber)]/5 p-6 text-[var(--color-mkt-slate)]"
      >
        <h2 className="text-lg font-semibold text-[var(--color-mkt-ink)]">
          Desktop screen required
        </h2>
        <p className="mt-2 text-sm">
          The KYC review queue is desktop-optimised. Please use a screen at least 1024px wide for
          accurate document review.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
