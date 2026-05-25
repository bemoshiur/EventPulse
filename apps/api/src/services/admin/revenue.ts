/**
 * Super-admin platform revenue service — Sprint 4 Day 35 §14.7.
 *
 * The platform-operator's financial cockpit. Cross-tenant aggregates
 * over the orders + fee-snapshot data shipped Sprint 3 (Day 23
 * `tenant_fee_config`, Day 26 `orders` with snapshotted paisa fields).
 *
 * ════════════════════════════════════════════════════════════════════
 * SECURITY MODEL — the inverse of the tenant dashboard's
 * ════════════════════════════════════════════════════════════════════
 *
 * The Day-33 tenant dashboard's risk was cross-tenant leakage —
 * isolation under `withTenant()` ↔ RLS was the load-bearing guard.
 *
 * Here, cross-tenant aggregation is the POINT. The dashboard
 * deliberately reads across all tenants to compute platform GMV,
 * platform revenue, leaderboards, anomalies. The §14.7 author
 * documented this as the EXCEPTION to the Day-33 Choice-B rule
 * (decisions.md "Sprint 4 Day 33 Choice B").
 *
 * So the entire risk concentrates on the AUTH GATE upstream of this
 * service. A tenant user (or unauthenticated request) reaching these
 * functions would be a security incident — they would see all
 * tenants' financials. The route layer guards this with
 * `requireSuperAdminAuth` middleware (apps/api/src/auth/middleware.ts);
 * the route-layer tests in revenue.test.ts assert tenant tokens
 * receive 403 (NOT 200 with leaked data).
 *
 * This service file therefore takes no `tenantId` parameter on the
 * cross-tenant entry points and runs under `withSuperAdmin()`
 * (BYPASSRLS) — the auth gate is the guard, not RLS.
 *
 * ════════════════════════════════════════════════════════════════════
 * Money-truth discipline (carries Day-33 Choice A)
 * ════════════════════════════════════════════════════════════════════
 *
 * Every paisa figure on every endpoint comes from a SNAPSHOTTED column
 * on the orders row (`totalPaisa`, `platformFeePaisa`, `epsFeePaisa`,
 * `netToOrganiserPaisa`, `withholdingTaxPaisa`). The fee calculator
 * never runs at display time. Recomputing would lie about historical
 * orders whose fees were set under a different per-tenant config
 * (§14.4 + Decision N). Same rule as the tenant dashboards; the
 * cross-tenant lens doesn't change the rule.
 *
 * ════════════════════════════════════════════════════════════════════
 * Settlement queue widget — scoped to the data we have today
 * ════════════════════════════════════════════════════════════════════
 *
 * The §14.7 "settlement queue" spec assumes `disbursement_batches`
 * exists. That table doesn't (Sprint 7). For Day 35 we expose a
 * READ-ONLY "amounts owed per tenant" view aggregated from
 * `orders.netToOrganiserPaisa` across paid orders not refunded /
 * reversed. The dashboard labels this honestly: "calculated from
 * paid orders; disbursement batching lands Sprint 7."
 *
 * No disbursement ACTION is exposed by this service — read-only.
 *
 * ════════════════════════════════════════════════════════════════════
 * §14.10 ledger invariant — surfaced in the drillable ledger
 * ════════════════════════════════════════════════════════════════════
 *
 * The drillable ledger (`getRevenueLedgerForOrder()`) exposes each
 * order row with its money split (subtotal, platform_fee, eps_fee,
 * withholding, net) so a super-admin reviewer can hand-verify the
 * §14.10 Invariant 1 (`total = net + platform_fee + eps_fee +
 * withholding`). The reconciliation job already enforces it
 * (apps/api/src/services/orders/reconcile.ts); this view exposes it.
 */

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { events, feeOverrideLog, orders, tenants } from '../../db/schema/index.js'

// ─── input + output types ────────────────────────────────────────────

export interface RevenueDashboardInput {
  /** Time-series window. Defaults to last 30 days. */
  fromDate?: Date | undefined
  toDate?: Date | undefined
  /** Headline KPI window. Defaults to last 24 hours. */
  headlineFromDate?: Date | undefined
}

/**
 * The §14.7 "today" KPI band. Window is configurable; default is
 * the last 24h rolling window (≈ "today" without TZ ambiguity for
 * a super admin in any timezone).
 */
export interface RevenueHeadline {
  /** Sum of orders.totalPaisa (paid+completed) in the window. */
  gmvPaisa: string
  /** Sum of orders.platformFeePaisa (paid+completed) in the window. */
  platformRevenuePaisa: string
  /** Count of orders (paid+completed) in the window. */
  transactionCount: number
  /** Weighted-average take rate (bps) = platformRevenue / GMV × 10000. */
  weightedTakeBps: number
  /** Number of distinct tenants with at least one paid order in the window. */
  activeTenantCount: number
}

export interface RevenueTimeSeriesPoint {
  /** ISO date (YYYY-MM-DD) in Asia/Dhaka. */
  date: string
  gmvPaisa: string
  platformRevenuePaisa: string
  transactionCount: number
}

export interface TopTenantRow {
  tenantId: string
  tenantName: string
  tenantSlug: string
  gmvPaisa: string
  platformRevenuePaisa: string
  transactionCount: number
}

export interface PendingPayoutRow {
  tenantId: string
  tenantName: string
  tenantSlug: string
  /** Aggregated netToOrganiserPaisa across paid orders not refunded/reversed. */
  pendingPaisa: string
  /** Count of paid orders contributing to this aggregate. */
  paidOrderCount: number
}

export interface RefundRateAnomaly {
  tenantId: string
  tenantName: string
  tenantSlug: string
  paidOrderCount: number
  refundedOrderCount: number
  /** Ratio refunded / paid, expressed in bps (e.g. 1200 = 12.00%). */
  refundRateBps: number
}

export interface FeeChangeAnomaly {
  tenantId: string
  tenantName: string
  tenantSlug: string
  changedAt: string // ISO
  changedBy: string // user id
  previousFeeBps: number
  newFeeBps: number
  previousMode: string
  newMode: string
  reason: string
  /** Absolute delta in bps; cards highlight when > 10 per §14.4 4-eyes principle. */
  absDeltaBps: number
}

export interface RevenueDashboardResult {
  headline: RevenueHeadline
  timeSeries: RevenueTimeSeriesPoint[]
  topByGmv: TopTenantRow[]
  topByPlatformRevenue: TopTenantRow[]
  topByTransactions: TopTenantRow[]
  settlementQueue: PendingPayoutRow[]
  anomalies: {
    refundRates: RefundRateAnomaly[]
    feeChanges: FeeChangeAnomaly[]
    /**
     * EPS reconciliation mismatches — placeholder until Sprint 7 ships
     * the `eps_settlements` table. Surface as an empty array with a
     * `placeholder: true` flag in the UI; the API stays forward-
     * compatible.
     */
    epsReconciliationPlaceholder: true
  }
}

export interface LedgerOrderRow {
  orderId: string
  merchantTransactionId: string
  buyerEmail: string
  totalPaisa: string
  netToOrganiserPaisa: string
  platformFeePaisa: string
  epsFeePaisa: string
  withholdingTaxPaisa: string
  status: string
  paidAt: string | null
  eventId: string
  eventTitle: string
  tenantId: string
  tenantName: string
}

export interface LedgerInput {
  tenantId?: string | undefined
  eventId?: string | undefined
  fromDate?: Date | undefined
  toDate?: Date | undefined
  limit?: number | undefined
}

export interface LedgerResult {
  rows: LedgerOrderRow[]
  /**
   * §14.10 Invariant 1 check across the returned page:
   * `Σ total = Σ (net + platform_fee + eps_fee + withholding)`.
   * `true` → conservation holds for every row in the page.
   * Any row that fails surfaces here so the UI can flag it.
   */
  invariantOk: boolean
  /** Per-row invariant failure ids (for the UI to highlight). */
  invariantFailureOrderIds: string[]
}

// ─── helpers ─────────────────────────────────────────────────────────

function bigintStr(v: unknown): string {
  if (v == null) return '0'
  return String(v)
}

function toBigInt(v: unknown): bigint {
  if (v == null) return 0n
  if (typeof v === 'bigint') return v
  if (typeof v === 'string') return BigInt(v)
  if (typeof v === 'number') return BigInt(Math.trunc(v))
  return 0n
}

// ─── main service: full dashboard payload ────────────────────────────

const REVENUE_STATUSES = sql`('paid','completed')`
const REFUND_LEAK_STATUSES = sql`('refund_requested','refunded','chargeback','reversed')`

export async function getPlatformRevenueDashboard(
  input: RevenueDashboardInput = {},
): Promise<RevenueDashboardResult> {
  const fromDate = input.fromDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const toDate = input.toDate ?? new Date()
  // Headline window defaults to last 24h ("today" without TZ ambiguity).
  const headlineFromDate = input.headlineFromDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000)

  return withSuperAdmin(async (db) => {
    // ─── 1) Headline (last 24h by default) ────────────────────────────
    //
    // The auth gate is the security model — we deliberately omit any
    // tenant filter. The service runs under withSuperAdmin (BYPASSRLS);
    // the route layer's requireSuperAdminAuth is the perimeter guard.
    const [headlineRow] = await db
      .select({
        gmvPaisa: sql<bigint>`COALESCE(SUM(${orders.totalPaisa})
          FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)`,
        platformRevenuePaisa: sql<bigint>`COALESCE(SUM(${orders.platformFeePaisa})
          FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)`,
        transactionCount: sql<number>`COUNT(*)
          FILTER (WHERE ${orders.status} IN ('paid','completed'))`,
        activeTenantCount: sql<number>`COUNT(DISTINCT ${orders.tenantId})
          FILTER (WHERE ${orders.status} IN ('paid','completed'))`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.paidAt, headlineFromDate),
          // Bound the upper end too so this is a true rolling window.
          lte(orders.paidAt, toDate),
        ),
      )

    const gmv = toBigInt(headlineRow!.gmvPaisa)
    const platformRev = toBigInt(headlineRow!.platformRevenuePaisa)
    // Weighted take rate = platformRev / gmv × 10000 (bps). Guard ÷0.
    const weightedTakeBps = gmv > 0n ? Number((platformRev * 10000n) / gmv) : 0

    const headline: RevenueHeadline = {
      gmvPaisa: bigintStr(gmv),
      platformRevenuePaisa: bigintStr(platformRev),
      transactionCount: Number(headlineRow!.transactionCount),
      weightedTakeBps,
      activeTenantCount: Number(headlineRow!.activeTenantCount),
    }

    // ─── 2) Time series (default 30 days, day-bucketed, Asia/Dhaka) ──
    //
    // Day-33 sales service uses date_trunc('day', X AT TIME ZONE 'Asia/Dhaka')
    // for the same reason (a sale at 11:30 PM BDT lands in BDT-Monday's
    // bucket, not UTC-Tuesday's). Mirror that here.
    const timeSeriesRows = await db
      .select({
        date: sql<string>`to_char(
          date_trunc('day', ${orders.paidAt} AT TIME ZONE 'Asia/Dhaka'),
          'YYYY-MM-DD'
        )`,
        gmvPaisa: sql<bigint>`COALESCE(SUM(${orders.totalPaisa}), 0)`,
        platformRevenuePaisa: sql<bigint>`COALESCE(SUM(${orders.platformFeePaisa}), 0)`,
        transactionCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(
        and(
          sql`${orders.status} IN ('paid','completed')`,
          gte(orders.paidAt, fromDate),
          lte(orders.paidAt, toDate),
        ),
      )
      .groupBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE 'Asia/Dhaka')`)
      .orderBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE 'Asia/Dhaka') ASC`)

    const timeSeries: RevenueTimeSeriesPoint[] = timeSeriesRows.map((r) => ({
      date: r.date,
      gmvPaisa: bigintStr(r.gmvPaisa),
      platformRevenuePaisa: bigintStr(r.platformRevenuePaisa),
      transactionCount: Number(r.transactionCount),
    }))

    // ─── 3) Leaderboards (this month = last 30 days, top 20) ──────────
    //
    // §14.7 spec says "this month"; we use a rolling 30-day window for
    // determinism + to keep the leaderboard meaningful across month
    // boundaries. Same SUM(...) pattern, GROUP BY tenant.
    const leaderboardBaseQuery = db
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        gmvPaisa: sql<bigint>`COALESCE(SUM(${orders.totalPaisa}), 0)`,
        platformRevenuePaisa: sql<bigint>`COALESCE(SUM(${orders.platformFeePaisa}), 0)`,
        transactionCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .innerJoin(tenants, eq(orders.tenantId, tenants.id))
      .where(
        and(
          sql`${orders.status} IN ('paid','completed')`,
          gte(orders.paidAt, fromDate),
          lte(orders.paidAt, toDate),
        ),
      )
      .groupBy(tenants.id, tenants.name, tenants.slug)

    const topByGmv = (
      await leaderboardBaseQuery.orderBy(sql`COALESCE(SUM(${orders.totalPaisa}), 0) DESC`).limit(20)
    ).map(
      (r): TopTenantRow => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        gmvPaisa: bigintStr(r.gmvPaisa),
        platformRevenuePaisa: bigintStr(r.platformRevenuePaisa),
        transactionCount: Number(r.transactionCount),
      }),
    )

    const topByPlatformRevenue = (
      await leaderboardBaseQuery
        .orderBy(sql`COALESCE(SUM(${orders.platformFeePaisa}), 0) DESC`)
        .limit(20)
    ).map(
      (r): TopTenantRow => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        gmvPaisa: bigintStr(r.gmvPaisa),
        platformRevenuePaisa: bigintStr(r.platformRevenuePaisa),
        transactionCount: Number(r.transactionCount),
      }),
    )

    const topByTransactions = (
      await leaderboardBaseQuery.orderBy(sql`COUNT(*) DESC`).limit(20)
    ).map(
      (r): TopTenantRow => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        gmvPaisa: bigintStr(r.gmvPaisa),
        platformRevenuePaisa: bigintStr(r.platformRevenuePaisa),
        transactionCount: Number(r.transactionCount),
      }),
    )

    // ─── 4) Settlement queue (per-tenant pending payouts) ─────────────
    //
    // Read-only "amounts owed to organisers" — Sum of netToOrganiserPaisa
    // across PAID orders that are NOT in a refund/reversal state. No
    // actual `disbursement_batches` table yet (Sprint 7); the dashboard
    // calls this "calculated from paid orders" honestly.
    //
    // All-time window deliberately: until disbursement batching exists,
    // every paid order is "pending settlement." A 30-day window would
    // hide carry-forward debts.
    const settlementRows = await db
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        pendingPaisa: sql<bigint>`COALESCE(SUM(${orders.netToOrganiserPaisa}), 0)`,
        paidOrderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .innerJoin(tenants, eq(orders.tenantId, tenants.id))
      .where(sql`${orders.status} IN ('paid','completed')`)
      .groupBy(tenants.id, tenants.name, tenants.slug)
      .orderBy(sql`COALESCE(SUM(${orders.netToOrganiserPaisa}), 0) DESC`)
      .limit(50)

    const settlementQueue: PendingPayoutRow[] = settlementRows
      // Drop tenants with 0 pending — noise.
      .filter((r) => toBigInt(r.pendingPaisa) > 0n)
      .map((r) => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        pendingPaisa: bigintStr(r.pendingPaisa),
        paidOrderCount: Number(r.paidOrderCount),
      }))

    // ─── 5) Refund-rate anomalies (per-tenant) ─────────────────────────
    //
    // §14.7 says "tenants with abnormal refund rates." We compute
    // refunded_count / paid_count over the dashboard window and
    // surface every tenant with rate > 10% AND >= 3 paid orders
    // (avoid noise from tiny-sample tenants). The UI may filter
    // further; service surfaces the candidates.
    const refundRateRows = await db
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        paidOrderCount: sql<number>`COUNT(*)
          FILTER (WHERE ${orders.status} IN ('paid','completed'))`,
        refundedOrderCount: sql<number>`COUNT(*)
          FILTER (WHERE ${orders.status} IN ('refund_requested','refunded','chargeback','reversed'))`,
      })
      .from(orders)
      .innerJoin(tenants, eq(orders.tenantId, tenants.id))
      .where(and(gte(orders.createdAt, fromDate), lte(orders.createdAt, toDate)))
      .groupBy(tenants.id, tenants.name, tenants.slug)

    const refundRateAnomalies: RefundRateAnomaly[] = refundRateRows
      .map((r) => {
        const paid = Number(r.paidOrderCount)
        const refunded = Number(r.refundedOrderCount)
        // Refund rate is refunded / (paid + refunded) — denominator
        // is total successful payments before refund.
        const denom = paid + refunded
        const refundRateBps = denom > 0 ? Math.round((refunded * 10000) / denom) : 0
        return {
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          tenantSlug: r.tenantSlug,
          paidOrderCount: paid,
          refundedOrderCount: refunded,
          refundRateBps,
        }
      })
      // Surface only tenants with non-trivial sample size AND elevated rate.
      .filter((r) => r.paidOrderCount + r.refundedOrderCount >= 3 && r.refundRateBps >= 1000)
      .sort((a, b) => b.refundRateBps - a.refundRateBps)
      .slice(0, 20)

    // ─── 6) Fee-change anomalies (last 7 days) ──────────────────────
    //
    // §14.7 + §14.4 (4-eyes for >10bps swings) — surface every fee
    // change in the last 7 days for super-admin awareness.
    const feeChangeWindow = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const feeChangeRows = await db
      .select({
        tenantId: feeOverrideLog.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        changedAt: feeOverrideLog.createdAt,
        changedBy: feeOverrideLog.changedBy,
        previousFeeBps: feeOverrideLog.previousFeeBps,
        newFeeBps: feeOverrideLog.newFeeBps,
        previousMode: feeOverrideLog.previousMode,
        newMode: feeOverrideLog.newMode,
        reason: feeOverrideLog.reason,
      })
      .from(feeOverrideLog)
      .innerJoin(tenants, eq(feeOverrideLog.tenantId, tenants.id))
      .where(gte(feeOverrideLog.createdAt, feeChangeWindow))
      .orderBy(desc(feeOverrideLog.createdAt))
      .limit(50)

    const feeChangeAnomalies: FeeChangeAnomaly[] = feeChangeRows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      tenantSlug: r.tenantSlug,
      changedAt: r.changedAt.toISOString(),
      changedBy: r.changedBy,
      previousFeeBps: r.previousFeeBps,
      newFeeBps: r.newFeeBps,
      previousMode: r.previousMode,
      newMode: r.newMode,
      reason: r.reason,
      absDeltaBps: Math.abs(r.newFeeBps - r.previousFeeBps),
    }))

    return {
      headline,
      timeSeries,
      topByGmv,
      topByPlatformRevenue,
      topByTransactions,
      settlementQueue,
      anomalies: {
        refundRates: refundRateAnomalies,
        feeChanges: feeChangeAnomalies,
        epsReconciliationPlaceholder: true,
      },
    }
  })
}

// ─── drillable ledger ─────────────────────────────────────────────────

/**
 * §14.7 drillable ledger: list orders with the full money split per
 * row so a super-admin can hand-verify §14.10 Invariant 1 conservation.
 *
 * Filterable by tenant + event + date range. Limit defaults to 100
 * (keep the JSON payload bounded; pagination is a Sprint 7 follow-up
 * if we need it for very large tenants).
 */
export async function getRevenueLedger(input: LedgerInput = {}): Promise<LedgerResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500))
  const fromDate = input.fromDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const toDate = input.toDate ?? new Date()

  return withSuperAdmin(async (db) => {
    const filters = [
      sql`${orders.status} IN ('paid','completed','refund_requested','refunded','chargeback','reversed')`,
      gte(orders.createdAt, fromDate),
      lte(orders.createdAt, toDate),
    ]
    if (input.tenantId) filters.push(eq(orders.tenantId, input.tenantId))
    if (input.eventId) filters.push(eq(orders.eventId, input.eventId))

    const rows = await db
      .select({
        orderId: orders.id,
        merchantTransactionId: orders.merchantTransactionId,
        buyerEmail: orders.buyerEmail,
        totalPaisa: orders.totalPaisa,
        netToOrganiserPaisa: orders.netToOrganiserPaisa,
        platformFeePaisa: orders.platformFeePaisa,
        epsFeePaisa: orders.epsFeePaisa,
        withholdingTaxPaisa: orders.withholdingTaxPaisa,
        status: orders.status,
        paidAt: orders.paidAt,
        eventId: orders.eventId,
        eventTitle: events.title,
        tenantId: orders.tenantId,
        tenantName: tenants.name,
      })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .innerJoin(tenants, eq(orders.tenantId, tenants.id))
      .where(and(...filters))
      .orderBy(desc(orders.createdAt))
      .limit(limit)

    const invariantFailureOrderIds: string[] = []
    for (const r of rows) {
      const split =
        toBigInt(r.netToOrganiserPaisa) +
        toBigInt(r.platformFeePaisa) +
        toBigInt(r.epsFeePaisa) +
        toBigInt(r.withholdingTaxPaisa)
      if (toBigInt(r.totalPaisa) !== split) {
        invariantFailureOrderIds.push(r.orderId)
      }
    }

    const ledgerRows: LedgerOrderRow[] = rows.map((r) => ({
      orderId: r.orderId,
      merchantTransactionId: r.merchantTransactionId,
      buyerEmail: r.buyerEmail,
      totalPaisa: bigintStr(r.totalPaisa),
      netToOrganiserPaisa: bigintStr(r.netToOrganiserPaisa),
      platformFeePaisa: bigintStr(r.platformFeePaisa),
      epsFeePaisa: bigintStr(r.epsFeePaisa),
      withholdingTaxPaisa: bigintStr(r.withholdingTaxPaisa),
      status: r.status,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      tenantId: r.tenantId,
      tenantName: r.tenantName,
    }))

    return {
      rows: ledgerRows,
      invariantOk: invariantFailureOrderIds.length === 0,
      invariantFailureOrderIds,
    }
  })
}
