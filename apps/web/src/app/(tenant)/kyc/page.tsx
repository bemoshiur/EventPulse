'use client'

/**
 * KYC wizard page — Sprint 2 Day 16 Item 12 PR 3 + Day 17 Item 12 Part 2.
 *
 * Routes to the appropriate wizard variant based on tenant.type. Day 16
 * shipped Individual Tier 1; Day 17 adds Organisation Tier A.
 *
 * The `(tenant)` layout already gates this route with `<TenantTypeGate>`
 * (Item 11), so by the time this component renders, `useTenantType()`
 * returns a non-null type. We still defensively return null for an
 * unexpected type — the server's requireTenantType middleware is the
 * correctness boundary.
 */

import { useTenantType } from '@/hooks/use-tenant-type'

import { IndividualTier1Wizard } from '@/components/kyc-wizard/individual-tier1'
import { OrganisationTierAWizard } from '@/components/kyc-wizard/organisation-tier-a'

export default function KycPage() {
  const { type, isLoading } = useTenantType()

  if (isLoading) {
    return (
      <div className="flex justify-center">
        <div className="h-96 w-full max-w-3xl animate-pulse rounded-2xl bg-[var(--ep-line)]/40" />
      </div>
    )
  }

  if (type === 'individual') {
    return <IndividualTier1Wizard />
  }

  if (type === 'organisation') {
    return <OrganisationTierAWizard />
  }

  // Defensive — TenantTypeGate should prevent this branch.
  return null
}
