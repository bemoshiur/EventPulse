/**
 * Tenant sales metrics service — Sprint 4 Day 33 Phase 1.
 *
 * Per §10.2: `GET /api/v1/tenant/reports/sales`. Aggregates over
 * the tenant's own orders for the tenant-facing sales dashboard
 * (§26.1 Day 5).
 *
 * ════════════════════════════════════════════════════════════════════
 * Cross-tenant aggregate isolation is the LOAD-BEARING property
 * ════════════════════════════════════════════════════════════════════
 *
 * The classic dashboard footgun is an unscoped `SUM(...)` that
 * accidentally crosses tenants. One tenant seeing another's revenue
 * is a data breach with regulatory consequences. Two defences:
 *
 *   1. EVERY aggregate query runs under `withTenant(tenantId)` —
 *      the `eventpulse_app` role engages RLS via the
 *      `orders_tenant_select` policy on `orders`. A SUM/COUNT under
 *      RLS only sees rows where `tenant_id = current_setting(...)`.
 *   2. The aggregate functions also include an explicit
 *      `WHERE orders.tenant_id = $tenantId` predicate as defence in
 *      depth (belt + braces; if RLS were momentarily disabled by a
 *      future refactor, the app-layer filter still scopes).
 *
 * Tested via a cross-tenant negative test in the route layer: seed
 * orders under both tenants A and B; tenant A's SUM must reflect
 * ONLY A's orders, never B's.
 *
 * ════════════════════════════════════════════════════════════════════
 * Read SNAPSHOTTED fees — NEVER recompute
 * ════════════════════════════════════════════════════════════════════
 *
 * `orders` carries the fee snapshot at order time (Day 26):
 * `subtotalPaisa`, `epsFeePaisa`, `platformFeePaisa`,
 * `withholdingTaxPaisa`, `totalPaisa`, `netToOrganiserPaisa`.
 *
 * The dashboard reads these directly. It NEVER re-runs the fee
 * calculator. Reasons:
 *
 *   - The fee terms might have CHANGED since the order (per-tenant
 *     fee override via §14.4 + Decision N). Recomputing would lie
 *     about what was actually charged.
 *   - The fee CALCULATOR is the single source of money truth at
 *     order time (§14.3); recomputing risks divergence with what
 *     the buyer + EPS settled.
 *   - §14.10 Invariant 1 holds on the snapshot: total =
 *     subtotal + platformFee + epsFee + withholdingTax. The
 *     dashboard reflects the actual ledger, not a model of it.
 *
 * ════════════════════════════════════════════════════════════════════
 * Status semantics for the dashboard
 * ════════════════════════════════════════════════════════════════════
 *
 * The status enum from migration 0013:
 *   pending / awaiting_payment / paid / completed / cancelled /
 *   failed / refund_requested / refunded / disputed / chargeback /
 *   reversed
 *
 * For dashboard display we collapse into 3 buckets:
 *   - REVENUE (paid + completed): money that's actually owed
 *   - PENDING (pending + awaiting_payment): in-flight, not yet paid
 *   - DROPPED (cancelled + failed): didn't convert
 *
 * Refunded / disputed / chargeback / reversed are excluded from the
 * REVENUE total (their value has been clawed back) but counted
 * separately so the tenant can see the leak. Day 7-8 refund flow
 * will produce these states.
 *
 * ════════════════════════════════════════════════════════════════════
 * Time-series buckets
 * ════════════════════════════════════════════════════════════════════
 *
 * Day-bucketed via `date_trunc('day', paid_at AT TIME ZONE
 * 'Asia/Dhaka')`. BDT is UTC+6; using paid_at in BDT means a sale
 * at 11:30 PM BDT on Monday lands in Monday's bucket, not Tuesday's
 * (which UTC would do). Matches the tenant's mental model.
 */

import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { events, orderItems, orders, ticketTiers } from '../../db/schema/index.js'

// ─── input + output types ───────────────────────────────────────────

export interface SalesMetricsInput {
  tenantId: string
  /** Optional event scope; null = all events. */
  eventId?: string | undefined
  /** Time-series window. Defaults to last 30 days. */
  fromDate?: Date | undefined
  toDate?: Date | undefined
}

export interface SalesHeadline {
  /** Sum of orders.totalPaisa where status IN (paid, completed) — gross. */
  grossRevenuePaisa: string // bigint serialised as string for JSON safety
  /** Sum of orders.netToOrganiserPaisa where status IN (paid, completed). */
  netToOrganiserPaisa: string
  /** Sum of orders.platformFeePaisa where status IN (paid, completed). */
  platformFeePaisa: string
  /** Sum of orders.epsFeePaisa where status IN (paid, completed). */
  epsFeePaisa: string
  /** Count of orders where status IN (paid, completed). */
  paidOrderCount: number
  /** Sum of order_items.quantity for paid/completed orders. */
  ticketsSold: number
  /** Counts by collapsed bucket. */
  buckets: {
    revenue: number
    pending: number
    dropped: number
    refunded: number
  }
}

export interface SalesTimeSeriesPoint {
  /** ISO date (YYYY-MM-DD) in Asia/Dhaka. */
  date: string
  grossRevenuePaisa: string
  paidOrderCount: number
}

export interface EventBreakdownRow {
  eventId: string
  eventTitle: string
  eventSlug: string
  grossRevenuePaisa: string
  netToOrganiserPaisa: string
  paidOrderCount: number
  ticketsSold: number
}

export interface TierBreakdownRow {
  tierId: string
  tierName: string
  eventId: string
  eventTitle: string
  pricePaisa: string
  ticketsSold: number
  grossRevenuePaisa: string
}

export interface SalesMetricsResult {
  headline: SalesHeadline
  timeSeries: SalesTimeSeriesPoint[]
  eventBreakdown: EventBreakdownRow[]
  tierBreakdown: TierBreakdownRow[]
}

// ─── helpers ────────────────────────────────────────────────────────

function bigintStr(v: unknown): string {
  if (v == null) return '0'
  return String(v)
}

// ─── main service ──────────────────────────────────────────────────

export async function getTenantSalesMetrics(input: SalesMetricsInput): Promise<SalesMetricsResult> {
  const fromDate = input.fromDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const toDate = input.toDate ?? new Date()

  return withTenant(input.tenantId, async (db) => {
    // Defence-in-depth: app-layer tenant filter alongside RLS.
    const tenantFilter = eq(orders.tenantId, input.tenantId)
    const eventFilter = input.eventId ? eq(orders.eventId, input.eventId) : undefined

    // ─── headline aggregates (single query, multiple FILTER clauses) ───
    //
    // Drizzle's sql template lets us inline FILTER (WHERE ...) which
    // Postgres uses to compute conditional aggregates in one pass.
    // Far cheaper than N separate queries with different WHEREs.
    const headlineRows = await db
      .select({
        grossRevenuePaisa: sql<bigint>`
          COALESCE(SUM(${orders.totalPaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        netToOrganiserPaisa: sql<bigint>`
          COALESCE(SUM(${orders.netToOrganiserPaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        platformFeePaisa: sql<bigint>`
          COALESCE(SUM(${orders.platformFeePaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        epsFeePaisa: sql<bigint>`
          COALESCE(SUM(${orders.epsFeePaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        paidOrderCount: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('paid','completed'))
        `,
        revenueBucket: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('paid','completed'))
        `,
        pendingBucket: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('pending','awaiting_payment'))
        `,
        droppedBucket: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('cancelled','failed'))
        `,
        refundedBucket: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('refund_requested','refunded','chargeback','reversed'))
        `,
      })
      .from(orders)
      .where(eventFilter ? and(tenantFilter, eventFilter) : tenantFilter)

    const h = headlineRows[0]!

    // ─── tickets sold (sum of quantity on paid/completed orders) ────
    //
    // Joined query: order_items × orders WHERE status in revenue +
    // tenant filter. Tenant filter on BOTH sides because RLS is per
    // table — and order_items has its own RLS policy too.
    const ticketsRows = await db
      .select({
        ticketsSold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.tenantId, input.tenantId),
          eq(orderItems.tenantId, input.tenantId),
          sql`${orders.status} IN ('paid','completed')`,
          ...(eventFilter ? [eventFilter] : []),
        ),
      )

    const headline: SalesHeadline = {
      grossRevenuePaisa: bigintStr(h.grossRevenuePaisa),
      netToOrganiserPaisa: bigintStr(h.netToOrganiserPaisa),
      platformFeePaisa: bigintStr(h.platformFeePaisa),
      epsFeePaisa: bigintStr(h.epsFeePaisa),
      paidOrderCount: Number(h.paidOrderCount),
      ticketsSold: Number(ticketsRows[0]!.ticketsSold),
      buckets: {
        revenue: Number(h.revenueBucket),
        pending: Number(h.pendingBucket),
        dropped: Number(h.droppedBucket),
        refunded: Number(h.refundedBucket),
      },
    }

    // ─── time-series (day-bucketed paid orders, BDT) ────────────────
    //
    // We use AT TIME ZONE 'Asia/Dhaka' so a sale at 11:30 PM BDT on
    // Monday lands in Monday's bucket (the tenant's mental model),
    // not Tuesday's (which UTC would do for those evening sales).
    const tsRows = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${orders.paidAt} AT TIME ZONE 'Asia/Dhaka'), 'YYYY-MM-DD')`,
        grossRevenuePaisa: sql<bigint>`COALESCE(SUM(${orders.totalPaisa}), 0)`,
        paidOrderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(
        and(
          tenantFilter,
          ...(eventFilter ? [eventFilter] : []),
          isNotNull(orders.paidAt),
          sql`${orders.status} IN ('paid','completed')`,
          gte(orders.paidAt, fromDate),
          lte(orders.paidAt, toDate),
        ),
      )
      .groupBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE 'Asia/Dhaka')`)
      .orderBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE 'Asia/Dhaka')`)

    const timeSeries: SalesTimeSeriesPoint[] = tsRows.map((r) => ({
      date: r.date,
      grossRevenuePaisa: bigintStr(r.grossRevenuePaisa),
      paidOrderCount: Number(r.paidOrderCount),
    }))

    // ─── per-event breakdown ────────────────────────────────────────

    const eventRows = await db
      .select({
        eventId: orders.eventId,
        eventTitle: events.title,
        eventSlug: events.slug,
        grossRevenuePaisa: sql<bigint>`
          COALESCE(SUM(${orders.totalPaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        netToOrganiserPaisa: sql<bigint>`
          COALESCE(SUM(${orders.netToOrganiserPaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        paidOrderCount: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('paid','completed'))
        `,
        ticketsSold: sql<number>`
          COALESCE((SELECT SUM(${orderItems.quantity})
                    FROM ${orderItems}
                    INNER JOIN ${orders} o2 ON ${orderItems.orderId} = o2.id
                    WHERE o2.event_id = ${orders.eventId}
                      AND o2.tenant_id = ${input.tenantId}
                      AND o2.status IN ('paid','completed')), 0)
        `,
      })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .where(eventFilter ? and(tenantFilter, eventFilter) : tenantFilter)
      .groupBy(orders.eventId, events.title, events.slug)
      .orderBy(
        sql`SUM(${orders.totalPaisa}) FILTER (WHERE ${orders.status} IN ('paid','completed')) DESC NULLS LAST`,
      )

    const eventBreakdown: EventBreakdownRow[] = eventRows.map((r) => ({
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      eventSlug: r.eventSlug,
      grossRevenuePaisa: bigintStr(r.grossRevenuePaisa),
      netToOrganiserPaisa: bigintStr(r.netToOrganiserPaisa),
      paidOrderCount: Number(r.paidOrderCount),
      ticketsSold: Number(r.ticketsSold),
    }))

    // ─── per-tier breakdown ─────────────────────────────────────────

    const tierRows = await db
      .select({
        tierId: ticketTiers.id,
        tierName: ticketTiers.name,
        eventId: ticketTiers.eventId,
        eventTitle: events.title,
        pricePaisa: ticketTiers.pricePaisa,
        ticketsSold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
        grossRevenuePaisa: sql<bigint>`COALESCE(SUM(${orderItems.subtotalPaisa}), 0)`,
      })
      .from(ticketTiers)
      .innerJoin(events, eq(ticketTiers.eventId, events.id))
      .leftJoin(orderItems, eq(orderItems.ticketTierId, ticketTiers.id))
      .leftJoin(
        orders,
        and(eq(orderItems.orderId, orders.id), sql`${orders.status} IN ('paid','completed')`),
      )
      .where(
        and(
          eq(ticketTiers.tenantId, input.tenantId),
          ...(input.eventId ? [eq(ticketTiers.eventId, input.eventId)] : []),
        ),
      )
      .groupBy(
        ticketTiers.id,
        ticketTiers.name,
        ticketTiers.eventId,
        events.title,
        ticketTiers.pricePaisa,
      )
      .orderBy(sql`SUM(${orderItems.quantity}) DESC NULLS LAST`)

    const tierBreakdown: TierBreakdownRow[] = tierRows.map((r) => ({
      tierId: r.tierId,
      tierName: r.tierName,
      eventId: r.eventId,
      eventTitle: r.eventTitle,
      pricePaisa: bigintStr(r.pricePaisa),
      ticketsSold: Number(r.ticketsSold),
      grossRevenuePaisa: bigintStr(r.grossRevenuePaisa),
    }))

    return {
      headline,
      timeSeries,
      eventBreakdown,
      tierBreakdown,
    }
  })
}
