'use client'

/**
 * KYC wizard page — Sprint 2 Day 16 Item 12 PR 3.
 *
 * Routes to the appropriate wizard variant based on tenant.type. Day
 * 16 ships Individual Tier 1 only; Organisation Tier A lands Day 17.
 *
 * The `(tenant)` layout already gates this route with `<TenantTypeGate>`
 * (Item 11), so by the time this component renders, `useTenantType()`
 * returns a non-null type. We still defensively branch + render the
 * Organisation placeholder rather than crashing — the server's
 * requireTenantType middleware is the correctness boundary.
 */

import { useTenantType } from '@/hooks/use-tenant-type'

import { IndividualTier1Wizard } from '@/components/kyc-wizard/individual-tier1'

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
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-[var(--ep-line)] bg-white/50 p-10 text-center">
        <h1 className="text-xl font-semibold text-[var(--ep-ink)]">
          Organisation wizard — coming Day 17
        </h1>
        <p className="mt-3 text-sm text-[var(--ep-graphite)]">
          The organisation Tier A KYC wizard lands tomorrow (Day 17). For now, please check back
          later or contact{' '}
          <a className="text-[var(--ep-violet)] underline" href="mailto:support@eventpulse.com.bd">
            support@eventpulse.com.bd
          </a>{' '}
          if you need to onboard urgently.
        </p>
      </div>
    )
  }

  // Defensive — TenantTypeGate should prevent this branch.
  return null
}
