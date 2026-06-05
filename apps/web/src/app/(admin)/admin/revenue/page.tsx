'use client'

/**
 * /admin/revenue — Super-admin platform revenue dashboard. §14.7 + Day 35 Phase 2.
 *
 * The platform-operator's financial cockpit. Cross-tenant aggregates,
 * leaderboards, settlement queue, anomaly cards, drillable §14.10
 * ledger.
 *
 * Auth: relies on the admin browser session. If hooks surface 401/403,
 * the page renders an inline error (the actual auth perimeter is the
 * API's requireSuperAdminAuth, not anything client-side).
 *
 * English only per the (admin) layout convention (internal staff tooling).
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatBdt, formatBps, formatNumber, useAdminRevenue } from '@/hooks/use-admin-revenue'

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-mkt-line rounded-2xl border bg-white p-5 shadow-sm backdrop-blur">
      <p className="text-mkt-slate text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="text-mkt-ink mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-mkt-slate/70 mt-1 text-xs">{hint}</p>}
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  children,
  testId,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <section
      data-testid={testId}
      className="border-mkt-line rounded-2xl border bg-white p-6 shadow-sm backdrop-blur"
    >
      <div className="mb-4">
        <h2 className="text-mkt-ink text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-mkt-slate/80 mt-1 text-sm">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export default function AdminRevenuePage() {
  const { data, error, isLoading } = useAdminRevenue()

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-mkt-line text-mkt-slate rounded-2xl border bg-white p-6 text-sm"
        data-testid="admin-revenue-loading"
      >
        Loading revenue dashboard…
      </div>
    )
  }

  if (error) {
    const errMsg = (error as Error).message
    const code = (error as Error & { code?: string }).code
    return (
      <div
        role="alert"
        className="border-ep-rose/40 bg-ep-rose/5 text-mkt-red rounded-2xl border p-6 text-sm"
        data-testid="admin-revenue-error"
      >
        Failed to load revenue dashboard: <strong>{errMsg}</strong>
        {code === 'FORBIDDEN' && (
          <p className="mt-2 text-xs">
            This surface requires a super-admin session. If you arrived here from a tenant session,
            sign out and sign in again with super-admin credentials.
          </p>
        )}
      </div>
    )
  }

  if (!data) return null

  const { headline, timeSeries, topByGmv, topByPlatformRevenue, settlementQueue, anomalies } =
    data.data

  return (
    <div className="space-y-6" data-testid="admin-revenue">
      <div>
        <h2 className="text-mkt-ink text-3xl font-semibold">Platform revenue</h2>
        <p className="text-mkt-slate mt-1 text-sm">
          Cross-tenant operational view. Money figures read from snapshotted order data; current fee
          terms shown alongside.
        </p>
      </div>

      {/* ─── headline KPIs (last 24h) ─── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="kpi-grid">
        <KpiCard
          label="GMV (24h)"
          value={formatBdt(headline.gmvPaisa)}
          hint={`${formatNumber(headline.transactionCount)} transactions`}
        />
        <KpiCard
          label="Platform revenue (24h)"
          value={formatBdt(headline.platformRevenuePaisa)}
          hint={`Weighted take: ${formatBps(headline.weightedTakeBps)}`}
        />
        <KpiCard
          label="Transactions (24h)"
          value={formatNumber(headline.transactionCount)}
          hint={`Across ${formatNumber(headline.activeTenantCount)} tenants`}
        />
        <KpiCard
          label="Active tenants (24h)"
          value={formatNumber(headline.activeTenantCount)}
          hint="Distinct tenants with paid orders"
        />
      </div>

      {/* ─── revenue + GMV time series ─── */}
      <SectionCard
        title="GMV & platform revenue, last 30 days"
        subtitle="Day-bucketed in Asia/Dhaka. Empty days appear as gaps."
        testId="time-series-section"
      >
        {timeSeries.length === 0 ? (
          <p className="text-mkt-slate text-sm">No paid orders in the window.</p>
        ) : (
          <div className="h-72 w-full" data-testid="time-series-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={timeSeries.map((p) => ({
                  date: p.date,
                  gmv: Number(BigInt(p.gmvPaisa) / 100n),
                  platformRevenue: Number(BigInt(p.platformRevenuePaisa) / 100n),
                }))}
                margin={{ top: 8, right: 24, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-mkt-line)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--color-mkt-slate)"
                  fontSize={11}
                  tickMargin={6}
                />
                <YAxis stroke="var(--color-mkt-slate)" fontSize={11} tickMargin={6} />
                <Tooltip
                  contentStyle={{
                    background: 'white',
                    border: '1px solid var(--color-mkt-line)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="gmv"
                  stroke="var(--color-mkt-red)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="platformRevenue"
                  stroke="#059669"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      {/* ─── leaderboards ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="Top tenants by GMV"
          subtitle="Last 30 days. Top 20."
          testId="leaderboard-gmv"
        >
          {topByGmv.length === 0 ? (
            <p className="text-mkt-slate text-sm">No tenants with paid orders yet.</p>
          ) : (
            <ol className="space-y-2">
              {topByGmv.slice(0, 10).map((row, idx) => (
                <li
                  key={row.tenantId}
                  className="flex items-center justify-between text-sm"
                  data-testid={`gmv-row-${row.tenantId}`}
                >
                  <span className="text-mkt-ink">
                    <span className="text-mkt-slate/70 mr-2 tabular-nums">#{idx + 1}</span>
                    <strong className="font-medium">{row.tenantName}</strong>
                    <span className="text-mkt-slate/70 ml-2 text-xs">{row.tenantSlug}</span>
                  </span>
                  <span className="text-mkt-ink font-semibold tabular-nums">
                    {formatBdt(row.gmvPaisa)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>

        <SectionCard
          title="Top tenants by platform revenue"
          subtitle="Last 30 days. Top 20."
          testId="leaderboard-revenue"
        >
          {topByPlatformRevenue.length === 0 ? (
            <p className="text-mkt-slate text-sm">No platform revenue yet.</p>
          ) : (
            <ol className="space-y-2">
              {topByPlatformRevenue.slice(0, 10).map((row, idx) => (
                <li
                  key={row.tenantId}
                  className="flex items-center justify-between text-sm"
                  data-testid={`revenue-row-${row.tenantId}`}
                >
                  <span className="text-mkt-ink">
                    <span className="text-mkt-slate/70 mr-2 tabular-nums">#{idx + 1}</span>
                    <strong className="font-medium">{row.tenantName}</strong>
                    <span className="text-mkt-slate/70 ml-2 text-xs">{row.tenantSlug}</span>
                  </span>
                  <span className="text-mkt-ink font-semibold tabular-nums">
                    {formatBdt(row.platformRevenuePaisa)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      {/* ─── settlement queue (read-only) ─── */}
      <SectionCard
        title="Settlement queue (amounts owed to organisers)"
        subtitle="Read-only view. Aggregated from paid orders not yet refunded. Disbursement batching lands Sprint 7; no payout action here."
        testId="settlement-queue"
      >
        {settlementQueue.length === 0 ? (
          <p className="text-mkt-slate text-sm">No pending payouts.</p>
        ) : (
          <table className="w-full table-auto border-collapse text-sm">
            <thead>
              <tr className="text-mkt-slate border-mkt-line border-b text-left text-xs tracking-wide uppercase">
                <th className="py-2 pr-4">Tenant</th>
                <th className="py-2 pr-4">Paid orders</th>
                <th className="py-2 pr-4 text-right">Pending payout</th>
              </tr>
            </thead>
            <tbody>
              {settlementQueue.map((row) => (
                <tr
                  key={row.tenantId}
                  className="border-mkt-line border-b"
                  data-testid={`settlement-row-${row.tenantId}`}
                >
                  <td className="text-mkt-ink py-2 pr-4">
                    <strong className="font-medium">{row.tenantName}</strong>
                    <span className="text-mkt-slate/70 ml-2 text-xs">{row.tenantSlug}</span>
                  </td>
                  <td className="text-mkt-ink py-2 pr-4 tabular-nums">
                    {formatNumber(row.paidOrderCount)}
                  </td>
                  <td className="text-mkt-ink py-2 pr-4 text-right font-semibold tabular-nums">
                    {formatBdt(row.pendingPaisa)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* ─── anomaly cards ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="anomalies-section">
        <SectionCard
          title="Refund-rate anomalies"
          subtitle="Tenants with refund rate ≥ 10% (min. 3 sample)"
          testId="anomaly-refund-rate"
        >
          {anomalies.refundRates.length === 0 ? (
            <p className="text-mkt-slate text-sm">No refund anomalies.</p>
          ) : (
            <ul className="space-y-2">
              {anomalies.refundRates.map((row) => (
                <li
                  key={row.tenantId}
                  className="border-ep-amber/30 bg-ep-amber/5 rounded-md border p-2 text-sm"
                  data-testid={`anomaly-refund-${row.tenantId}`}
                >
                  <div className="text-mkt-ink font-medium">{row.tenantName}</div>
                  <div className="text-mkt-slate text-xs">
                    {formatBps(row.refundRateBps)} ({formatNumber(row.refundedOrderCount)} of{' '}
                    {formatNumber(row.paidOrderCount + row.refundedOrderCount)})
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Fee changes (last 7 days)"
          subtitle="Per §14.4 4-eyes principle: >10 bps swings warrant review"
          testId="anomaly-fee-changes"
        >
          {anomalies.feeChanges.length === 0 ? (
            <p className="text-mkt-slate text-sm">No fee changes in the last 7 days.</p>
          ) : (
            <ul className="space-y-2">
              {anomalies.feeChanges.map((row) => {
                const flagged = row.absDeltaBps > 10
                return (
                  <li
                    key={`${row.tenantId}-${row.changedAt}`}
                    className={`rounded-md border p-2 text-sm ${
                      flagged ? 'border-ep-rose/30 bg-ep-rose/5' : 'border-mkt-line bg-white'
                    }`}
                    data-testid={`anomaly-fee-${row.tenantId}`}
                  >
                    <div className="text-mkt-ink font-medium">{row.tenantName}</div>
                    <div className="text-mkt-slate text-xs tabular-nums">
                      {formatBps(row.previousFeeBps)} → {formatBps(row.newFeeBps)} (Δ{' '}
                      {formatBps(row.absDeltaBps)})
                    </div>
                    <div className="text-mkt-slate/70 mt-1 text-xs italic">{row.reason}</div>
                  </li>
                )
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="EPS reconciliation"
          subtitle="Placeholder until Sprint 7 ships eps_settlements"
          testId="anomaly-eps-recon"
        >
          <p className="text-mkt-slate/80 text-sm">
            EPS reconciliation mismatches will surface here once Sprint 7 lands the{' '}
            <code className="text-xs">eps_settlements</code> table. Until then, EPS settlement
            reports must be reconciled manually against the order ledger.
          </p>
        </SectionCard>
      </div>

      <p className="text-mkt-slate/70 text-xs italic">
        Money figures are <strong>snapshotted</strong> from each order at creation. Current
        per-tenant fee terms are shown in each tenant&apos;s admin detail page; the dashboard
        deliberately does not recompute (Day-33 Choice A carries to cross-tenant view).
      </p>
    </div>
  )
}
