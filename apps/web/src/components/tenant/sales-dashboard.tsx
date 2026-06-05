'use client'

/**
 * SalesDashboard — tenant portal sales metrics view.
 * Sprint 4 Day 33 Phase 2.
 *
 * Headline KPIs + sales-over-time chart + per-event/per-tier
 * breakdown. Mirrors the conventions of the attendee-list page
 * (plain-<table>, §1.5 design tokens, English labels per R12).
 *
 * Priced-revenue note: with STAGING_PAYMENT_BLOCK on, the only
 * paid orders are free-event ones — so staging shows mostly zero
 * revenue. The dashboard renders correctly; the priced numbers
 * are unverified until the truth gate runs real paid orders.
 */

import Link from 'next/link'
import { useMemo } from 'react'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  formatBdt,
  formatNumber,
  type SalesEnvelope,
  useTenantSales,
} from '@/hooks/use-tenant-sales'

// ─── small subcomponents ────────────────────────────────────────────

function KpiCard({
  label,
  value,
  hint,
  testId,
}: {
  label: string
  value: string
  hint?: string
  testId?: string
}) {
  return (
    <div className="border-mkt-line rounded-2xl border bg-white p-5" data-testid={testId}>
      <div className="text-mkt-slate text-xs font-medium tracking-wide uppercase">{label}</div>
      <div className="text-mkt-ink mt-2 text-3xl font-semibold">{value}</div>
      {hint ? <div className="text-mkt-slate mt-1 text-xs">{hint}</div> : null}
    </div>
  )
}

function BucketPill({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${tone}`}
    >
      {label}: <strong>{formatNumber(count)}</strong>
    </span>
  )
}

// ─── chart helpers ──────────────────────────────────────────────────

interface ChartPoint {
  date: string
  revenue: number // BDT (number, for the chart's y-axis)
  orders: number
}

function toChartData(series: SalesEnvelope['data']['timeSeries'] | undefined): ChartPoint[] {
  if (!series) return []
  return series.map((p) => ({
    date: p.date,
    // Recharts axis prefers number; convert paisa-string → BDT number.
    // Precision loss is fine for chart pixel placement; the table
    // surfaces use formatBdt directly from the bigint-string.
    revenue: Number(BigInt(p.grossRevenuePaisa) / 100n),
    orders: p.paidOrderCount,
  }))
}

// ─── main component ─────────────────────────────────────────────────

export function SalesDashboard() {
  const { data, error, isLoading } = useTenantSales()
  const chartData = useMemo(() => toChartData(data?.data?.timeSeries), [data])

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-mkt-line text-mkt-slate rounded-2xl border bg-white p-6 text-sm"
      >
        Loading sales metrics…
      </div>
    )
  }

  if (error) {
    return (
      <div
        role="alert"
        className="text-mkt-red rounded-2xl border border-[var(--ep-rose)]/40 bg-[var(--ep-rose)]/5 p-6 text-sm"
      >
        Failed to load sales metrics: {(error as Error).message}
      </div>
    )
  }

  if (!data) return null
  const { headline, eventBreakdown, tierBreakdown } = data.data
  const hasAnyRevenue = BigInt(headline.grossRevenuePaisa) > 0n || headline.paidOrderCount > 0

  return (
    <section aria-label="Sales metrics" className="space-y-8">
      {!hasAnyRevenue ? (
        <div
          className="border-mkt-line/60 rounded-2xl border bg-white p-8 backdrop-blur"
          data-testid="empty-state"
        >
          <p className="text-mkt-red text-xs font-semibold tracking-widest uppercase">Welcome 👋</p>
          <h3 className="font-display text-mkt-ink mt-2 text-2xl font-semibold">
            Let’s get your first event live.
          </h3>
          <p className="text-mkt-slate mt-2 max-w-2xl text-sm leading-relaxed">
            Your sales, attendees, and payouts will light up here once people start registering. It
            takes about 90 seconds to publish — free events go live instantly.
          </p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              [
                '1',
                'Create your event',
                'Pick a type, add the basics — we generate a branded page.',
              ],
              ['2', 'Add tickets & publish', 'Set tiers and a sales window, then share your link.'],
              [
                '3',
                'Get paid T+5',
                'Net proceeds settle to your account five business days later.',
              ],
            ].map(([n, t, d]) => (
              <li key={n} className="border-mkt-line/60 rounded-xl border bg-white p-4">
                <span className="text-mkt-red font-display text-xl font-bold">{n}</span>
                <p className="text-mkt-ink mt-1 text-sm font-semibold">{t}</p>
                <p className="text-mkt-slate mt-1 text-xs leading-relaxed">{d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/events/new"
              className="bg-mkt-red inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              Create your first event
            </Link>
            <a
              href="https://eventpulse.com.bd/demo"
              target="_blank"
              rel="noreferrer noopener"
              className="border-mkt-line text-mkt-ink inline-flex h-11 items-center justify-center rounded-md border px-6 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              Watch the 90-second demo
            </a>
          </div>
        </div>
      ) : null}

      {/* Headline KPI cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Gross revenue"
          value={formatBdt(headline.grossRevenuePaisa)}
          hint="Sum of paid order totals (snapshotted)"
          testId="kpi-gross"
        />
        <KpiCard
          label="Net to organiser"
          value={formatBdt(headline.netToOrganiserPaisa)}
          hint="After platform + EPS fees"
          testId="kpi-net"
        />
        <KpiCard
          label="Tickets sold"
          value={formatNumber(headline.ticketsSold)}
          hint={`across ${formatNumber(headline.paidOrderCount)} paid order${headline.paidOrderCount === 1 ? '' : 's'}`}
          testId="kpi-tickets"
        />
        <KpiCard
          label="Avg. order value"
          value={
            headline.paidOrderCount > 0
              ? formatBdt(
                  (BigInt(headline.grossRevenuePaisa) / BigInt(headline.paidOrderCount)).toString(),
                )
              : formatBdt('0')
          }
          hint="Gross ÷ paid orders"
          testId="kpi-aov"
        />
      </div>

      {/* Status bucket pills */}
      <div
        aria-label="Order status breakdown"
        className="flex flex-wrap gap-2"
        data-testid="bucket-pills"
      >
        <BucketPill
          label="Revenue"
          count={headline.buckets.revenue}
          tone="bg-[var(--ep-mint)]/15 text-emerald-600"
        />
        <BucketPill
          label="Pending"
          count={headline.buckets.pending}
          tone="bg-[var(--ep-cerulean)]/15 text-mkt-red"
        />
        <BucketPill
          label="Dropped"
          count={headline.buckets.dropped}
          tone="bg-[var(--ep-rose)]/15 text-mkt-red"
        />
        <BucketPill
          label="Refunded"
          count={headline.buckets.refunded}
          tone="bg-[var(--ep-amber)]/15 text-[var(--ep-amber)]"
        />
      </div>

      {/* Time-series chart */}
      <div className="border-mkt-line rounded-2xl border bg-white p-6">
        <div className="mb-4">
          <h2 className="text-mkt-ink text-xl font-semibold">Sales over time</h2>
          <p className="text-mkt-slate text-xs">
            Last 30 days · daily revenue (BDT) · times in Asia/Dhaka
          </p>
        </div>
        {chartData.length === 0 ? (
          <div className="text-mkt-slate py-12 text-center text-sm">
            No paid sales in the last 30 days.
          </div>
        ) : (
          <div data-testid="sales-chart" style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ep-line)" />
                <XAxis dataKey="date" stroke="var(--ep-graphite)" fontSize={11} tickMargin={6} />
                <YAxis stroke="var(--ep-graphite)" fontSize={11} tickMargin={6} />
                <Tooltip
                  contentStyle={{
                    background: 'white',
                    border: '1px solid var(--ep-line)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--ep-violet)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Per-event breakdown */}
      <div className="border-mkt-line rounded-2xl border bg-white p-6">
        <h2 className="text-mkt-ink mb-4 text-xl font-semibold">By event</h2>
        {eventBreakdown.length === 0 ? (
          <div className="text-mkt-slate text-sm">No events with orders yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm">
              <thead>
                <tr className="border-mkt-line text-mkt-slate border-b text-left text-xs tracking-wide uppercase">
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Tickets</th>
                  <th className="px-4 py-3">Orders</th>
                  <th className="px-4 py-3">Gross</th>
                  <th className="px-4 py-3">Net to organiser</th>
                </tr>
              </thead>
              <tbody>
                {eventBreakdown.map((r) => (
                  <tr
                    key={r.eventId}
                    className="border-mkt-line border-b transition-colors hover:bg-[var(--color-mkt-soft)]"
                  >
                    <td className="text-mkt-ink px-4 py-3 font-medium">{r.eventTitle}</td>
                    <td className="text-mkt-slate px-4 py-3">{formatNumber(r.ticketsSold)}</td>
                    <td className="text-mkt-slate px-4 py-3">{formatNumber(r.paidOrderCount)}</td>
                    <td className="text-mkt-ink px-4 py-3">{formatBdt(r.grossRevenuePaisa)}</td>
                    <td className="text-mkt-ink px-4 py-3">{formatBdt(r.netToOrganiserPaisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-tier breakdown */}
      <div className="border-mkt-line rounded-2xl border bg-white p-6">
        <h2 className="text-mkt-ink mb-4 text-xl font-semibold">By ticket tier</h2>
        {tierBreakdown.length === 0 ? (
          <div className="text-mkt-slate text-sm">No tiers yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm">
              <thead>
                <tr className="border-mkt-line text-mkt-slate border-b text-left text-xs tracking-wide uppercase">
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Tickets sold</th>
                  <th className="px-4 py-3">Gross</th>
                </tr>
              </thead>
              <tbody>
                {tierBreakdown.map((r) => (
                  <tr
                    key={r.tierId}
                    className="border-mkt-line border-b transition-colors hover:bg-[var(--color-mkt-soft)]"
                  >
                    <td className="text-mkt-ink px-4 py-3 font-medium">{r.tierName}</td>
                    <td className="text-mkt-slate px-4 py-3">{r.eventTitle}</td>
                    <td className="text-mkt-slate px-4 py-3">{formatBdt(r.pricePaisa)}</td>
                    <td className="text-mkt-slate px-4 py-3">{formatNumber(r.ticketsSold)}</td>
                    <td className="text-mkt-ink px-4 py-3">{formatBdt(r.grossRevenuePaisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
