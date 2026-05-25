/**
 * Tenant payouts view — Sprint 4 Day 33 Phase 3.
 *
 * Per §10.2 + §26.1 Day 5: `GET /api/v1/tenant/reports/payouts`.
 * The tenant's READ-ONLY view of what they're owed: net-to-organiser
 * from paid orders, plus their CURRENT platform_fee_bps so they
 * understand the fee terms going forward.
 *
 * ════════════════════════════════════════════════════════════════════
 * This is a VIEW, NOT a disbursement action
 * ════════════════════════════════════════════════════════════════════
 *
 * No money moves here. No disbursement execution. No payout API call.
 * Actual disbursement is Sprint 4 Day 7-8 work (and the priced parts
 * are truth-gate-gated anyway). The payouts VIEW exists so the
 * tenant can see what they're owed before disbursement.
 *
 * ════════════════════════════════════════════════════════════════════
 * Read SNAPSHOTTED net — NEVER recompute
 * ════════════════════════════════════════════════════════════════════
 *
 * `orders.netToOrganiserPaisa` was snapshotted by the fee calculator
 * at order time (Day 26 + §14). We sum it directly across the
 * tenant's paid + completed orders. Reasons (same as the sales
 * service):
 *
 *   - Fee terms might have CHANGED since the order (§14.4 + Decision
 *     N). The dashboard reflects what was actually settled, not what
 *     it would be NOW under the current terms.
 *   - §14.10 Invariant 1 already holds on the snapshot:
 *     total = subtotal + platformFee + epsFee + withholdingTax.
 *     The view just surfaces what's already conserved.
 *
 * ════════════════════════════════════════════════════════════════════
 * Refunds reduce net (same as sales service)
 * ════════════════════════════════════════════════════════════════════
 *
 * MVP: paid+completed states only contribute to the payable total.
 * refund_requested / refunded / chargeback / reversed are counted
 * separately as a "pending leak" line that ops + the tenant can see.
 * When Day 7-8 refund flow lands, refund rows will subtract from
 * the payable total; the view recompiles.
 *
 * ════════════════════════════════════════════════════════════════════
 * Cross-tenant aggregate isolation
 * ════════════════════════════════════════════════════════════════════
 *
 * Same dual defence as the sales service: withTenant() ↔ RLS +
 * explicit WHERE tenant_id predicate. A tenant reading another
 * tenant's payouts is the same data breach class. Tested via
 * cross-tenant negative test.
 */

import { and, eq, sql } from 'drizzle-orm'

import { withTenant } from '../../db/client.js'
import { orders } from '../../db/schema/index.js'

import { getEffectiveFees, type EffectiveFees } from '../fee-config/index.js'

// ─── input + output types ───────────────────────────────────────────

export interface PayoutsViewInput {
  tenantId: string
}

export interface PayoutsViewResult {
  /** Sum of orders.netToOrganiserPaisa for paid+completed orders (snapshotted). */
  pendingPayoutPaisa: string
  /** Sum of orders.totalPaisa for paid+completed (matches sales' gross). */
  grossRevenuePaisa: string
  /** Sum of orders.platformFeePaisa for paid+completed (snapshotted). */
  platformFeePaisa: string
  /** Sum of orders.epsFeePaisa for paid+completed (snapshotted). */
  epsFeePaisa: string
  /** Sum of orders.withholdingTaxPaisa for paid+completed (snapshotted). */
  withholdingTaxPaisa: string
  /** Count of orders contributing to the payable total. */
  paidOrderCount: number
  /** Orders currently in refund-leak states (refund_requested / refunded / chargeback / reversed). */
  refundLeakOrderCount: number
  /** Sum of order totals in refund-leak states. */
  refundLeakPaisa: string
  /** The tenant's CURRENT fee config (NOT the snapshotted per-order). */
  currentFees: EffectiveFees
}

// ─── helpers ────────────────────────────────────────────────────────

function bigintStr(v: unknown): string {
  if (v == null) return '0'
  return String(v)
}

// ─── main service ──────────────────────────────────────────────────

export async function getTenantPayoutsView(input: PayoutsViewInput): Promise<PayoutsViewResult> {
  // Run the fee-config read OUTSIDE the withTenant tx because the
  // service uses withSuperAdmin (BYPASSRLS) — it's a super-admin-
  // owned config table the tenant can only READ via their portal.
  const currentFees = await getEffectiveFees(input.tenantId)

  return withTenant(input.tenantId, async (db) => {
    const tenantFilter = eq(orders.tenantId, input.tenantId)

    const rows = await db
      .select({
        pendingPayoutPaisa: sql<bigint>`
          COALESCE(SUM(${orders.netToOrganiserPaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        grossRevenuePaisa: sql<bigint>`
          COALESCE(SUM(${orders.totalPaisa})
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
        withholdingTaxPaisa: sql<bigint>`
          COALESCE(SUM(${orders.withholdingTaxPaisa})
            FILTER (WHERE ${orders.status} IN ('paid','completed')), 0)
        `,
        paidOrderCount: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('paid','completed'))
        `,
        refundLeakOrderCount: sql<number>`
          COUNT(*) FILTER (WHERE ${orders.status} IN ('refund_requested','refunded','chargeback','reversed'))
        `,
        refundLeakPaisa: sql<bigint>`
          COALESCE(SUM(${orders.totalPaisa})
            FILTER (WHERE ${orders.status} IN ('refund_requested','refunded','chargeback','reversed')), 0)
        `,
      })
      .from(orders)
      .where(and(tenantFilter))

    const r = rows[0]!

    return {
      pendingPayoutPaisa: bigintStr(r.pendingPayoutPaisa),
      grossRevenuePaisa: bigintStr(r.grossRevenuePaisa),
      platformFeePaisa: bigintStr(r.platformFeePaisa),
      epsFeePaisa: bigintStr(r.epsFeePaisa),
      withholdingTaxPaisa: bigintStr(r.withholdingTaxPaisa),
      paidOrderCount: Number(r.paidOrderCount),
      refundLeakOrderCount: Number(r.refundLeakOrderCount),
      refundLeakPaisa: bigintStr(r.refundLeakPaisa),
      currentFees,
    }
  })
}
