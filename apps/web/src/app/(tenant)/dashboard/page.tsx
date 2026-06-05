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

import Link from 'next/link'

import { SalesDashboard } from '@/components/tenant/sales-dashboard'

export default function TenantDashboardPage() {
  return (
    <div className="text-mkt-ink space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-mkt-slate mt-2 text-base">
            Sales performance across your events — gross, net to you, tickets sold, and the last 30
            days at a glance.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/settings"
            className="border-mkt-line text-mkt-ink inline-flex h-11 items-center rounded-md border px-4 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm"
          >
            Settings
          </Link>
          <Link
            href="/events/new"
            className="bg-mkt-red inline-flex h-11 items-center rounded-md px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            + Create event
          </Link>
        </div>
      </header>
      <SalesDashboard />
    </div>
  )
}
