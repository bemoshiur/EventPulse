import { AuthGate } from '@/components/auth/auth-gate'
import { QueryProvider } from '@/components/providers/query-provider'
import { GradientMesh } from '@/components/ui/gradient-mesh'
import { TenantTypeGate } from '@/components/onboarding/tenant-type-gate'

/**
 * Tenant portal layout. Wraps everything under `(tenant)` in:
 *   1. `<AuthGate audience="tenant">` — redirects unauthenticated users to
 *      /sign-in, and a signed-in-but-not-yet-scoped user (attendee session,
 *      hasn't picked a tenant) to /choose-tenant, before any portal shell
 *      renders. The API gate on every /tenant/* route is the correctness
 *      authority; this is the UX layer that avoids showing a broken shell.
 *   2. `<QueryProvider>` — TanStack Query client + dev-only devtools
 *      (Sprint 2 Day 16 PR 2). All tenant-portal hooks (useTenantType,
 *      useKycDraft, etc.) share one cache.
 *   3. `<TenantTypeGate>` — post-login Account-Type modal (Item 11)
 *      fires on first dashboard load until the tenant picks Individual
 *      or Organisation. The server-side `requireTenantType` middleware
 *      is the correctness gate; this is the UX layer.
 */
export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen">
      <GradientMesh variant="calm" />
      <AuthGate audience="tenant" wrongAudiencePath="/choose-tenant">
        <QueryProvider>
          <TenantTypeGate>
            <div className="mx-auto min-h-screen max-w-6xl px-4 py-12">{children}</div>
          </TenantTypeGate>
        </QueryProvider>
      </AuthGate>
    </main>
  )
}
