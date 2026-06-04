/**
 * Public route group layout — Sprint 2 Day 19 Item 14.
 *
 * Wraps the Trust Center (and any future public marketing routes) in
 * the §1.5 gradient mesh + max-width container. No client providers
 * needed — every page in this group is a Server Component (Decision K
 * 2026-05-19); no TanStack, no auth context.
 */

import { GradientMesh } from '@/components/ui/gradient-mesh'

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen bg-[var(--color-mkt-paper)]">
      <GradientMesh variant="calm" />
      <div className="relative">{children}</div>
    </main>
  )
}
