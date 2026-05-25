/**
 * Tenant dashboard — Sprint 4 Day 33 Phase 2.
 *
 * URL: /dashboard (under the tenant route group).
 *
 * The home of the tenant portal: sales KPIs + time-series chart +
 * per-event/per-tier breakdown. Replaces the Day-15 placeholder
 * card that existed just to give the Account-Type modal something
 * to render behind.
 *
 * Auth: the tenant route-group layout handles auth gating; the
 * API gate runs on each fetch (mirrors other tenant pages).
 *
 * Priced-revenue caveat (carried in handoff.md): with
 * STAGING_PAYMENT_BLOCK on, the only paid orders are free-event
 * ones — so staging mostly shows zero revenue. The empty state
 * is the expected look on a fresh tenant.
 */

import { SalesDashboard } from '@/components/tenant/sales-dashboard'

export default function TenantDashboardPage() {
  return (
    <div className="space-y-8 text-white">
      <header>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="mt-2 text-base text-white/70">
          Sales performance across your events — gross, net to you, tickets sold, and the last 30
          days at a glance.
        </p>
      </header>
      <SalesDashboard />
    </div>
  )
}
