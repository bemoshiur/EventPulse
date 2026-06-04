/**
 * Public route group layout — Sprint 2 Day 19 Item 14.
 *
 * Wraps the Trust Center (and any future public marketing routes) in
 * the §1.5 gradient mesh + max-width container. No client providers
 * needed — every page in this group is a Server Component (Decision K
 * 2026-05-19); no TanStack, no auth context.
 */

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="text-mkt-ink min-h-screen bg-white font-[family-name:var(--font-bangla)]">
      {children}
    </main>
  )
}
