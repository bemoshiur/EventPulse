/**
 * Tenant payouts page — Sprint 4 Day 33 Phase 3.
 *
 * URL: /payouts (under the tenant route group).
 *
 * Read-only "what's owed" view. Pairs with the /dashboard sales
 * dashboard (Day 33 Phase 2) — the dashboard shows performance,
 * the payouts page shows settlement.
 *
 * Auth: tenant route-group layout handles auth gating; API gate
 * runs on each fetch.
 *
 * NOT a disbursement action. Actual disbursement is Day 7-8 work
 * (and priced disbursement is gated on the truth gate).
 */

import { PayoutsView } from '@/components/tenant/payouts-view'

export default function TenantPayoutsPage() {
  return (
    <div className="space-y-8 text-white">
      <header>
        <h1 className="text-3xl font-bold">Payouts</h1>
        <p className="mt-2 text-base text-white/70">
          What you're owed across your paid orders, with your current fee terms. Automated T+5
          disbursement ships in a future sprint; this view is what your settlement total will be
          when payouts go live.
        </p>
      </header>
      <PayoutsView />
    </div>
  )
}
