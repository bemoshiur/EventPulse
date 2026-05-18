/**
 * Super admin route group layout — Sprint 2 Day 18 Item 13 PR 4.
 *
 * Wraps everything under `(admin)` in:
 *   1. <QueryProvider> — TanStack Query client for admin hooks.
 *   2. Desktop-only viewport warning per user brief §2.3 — KYC review
 *      is desktop-oriented; mobile reviewers cannot inspect documents
 *      accurately. The banner is rendered server-side as a fallback
 *      that the responsive guard component (client-side) hides on
 *      desktop widths.
 *
 * Auth: super-admin JWT is verified server-side by the API gate
 * (requireSuperAdminAuth on every /api/v1/admin/* route). This layout
 * does NOT re-authenticate; if the API returns 401, hooks surface the
 * error and the page renders a "session expired — sign in" state.
 *
 * Per user brief §2.3: all copy English only. Internal staff tooling
 * does not need Bangla translation.
 */

import { QueryProvider } from '@/components/providers/query-provider'
import { GradientMesh } from '@/components/ui/gradient-mesh'
import { AdminViewportGuard } from '@/components/admin-kyc/viewport-guard'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen">
      <GradientMesh variant="calm" />
      <QueryProvider>
        <div className="mx-auto min-h-screen max-w-7xl px-6 py-10">
          <header className="mb-8 flex items-center justify-between">
            <h1 className="text-2xl font-semibold text-[var(--ep-ink)]">Super Admin</h1>
            <span className="rounded-full bg-[var(--ep-violet)]/10 px-3 py-1 text-xs font-medium tracking-wide text-[var(--ep-violet)] uppercase">
              Internal
            </span>
          </header>
          <AdminViewportGuard>{children}</AdminViewportGuard>
        </div>
      </QueryProvider>
    </main>
  )
}
