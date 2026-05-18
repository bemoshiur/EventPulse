import { GradientMesh } from '@/components/ui/gradient-mesh'
import { TenantTypeGate } from '@/components/onboarding/tenant-type-gate'

/**
 * Tenant portal layout. Wraps everything under `(tenant)` in
 * `<TenantTypeGate>` so the post-login Account-Type modal (Item 11)
 * fires on first dashboard load until the tenant picks Individual
 * or Organisation. The server-side `requireTenantType` middleware
 * is the correctness gate; this is the UX layer.
 */
export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen">
      <GradientMesh variant="calm" />
      <TenantTypeGate>
        <div className="mx-auto min-h-screen max-w-6xl px-4 py-12">{children}</div>
      </TenantTypeGate>
    </main>
  )
}
