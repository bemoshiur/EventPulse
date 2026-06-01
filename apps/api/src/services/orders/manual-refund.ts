/**
 * Manual refund execution — Day 39 Phase 2b.
 *
 * The (d)-mechanism completion path from PR #228's Verify-guard
 * (Day 38 Phase 2a). When EPS Verify returned Success on a non-bKash
 * payment method, the order was diverted to `disputed` status instead
 * of `paid`. The super-admin then:
 *
 *   1. Issues the actual refund via the EPS merchant dashboard
 *      (V5 has no public refund API per CLAUDE.md §11.4).
 *   2. Calls this service (via `POST /api/v1/admin/orders/:id/mark-refunded`)
 *      to mark the platform's view of the order as `refunded`.
 *
 * This is the platform-side accounting transition that closes the
 * loop on a non-bKash dispute. The actual money refund happens
 * out-of-band via EPS dashboard before this call fires.
 *
 * **Authority model:** super-admin only. The audit row's `actor_type`
 * is `'super_admin'` + `actor_id` is the calling super-admin's user
 * id. The route + middleware enforce the auth gate; this service
 * trusts the caller's `refundedBy` because the route is the trust
 * boundary.
 *
 * **State machine:** `disputed → refunded` (Day 39 Phase 2b extension
 * to the §2.5 narrative). The state machine permits the direct
 * transition per the comment on the TRANSITIONS map; v2.4 playbook
 * bump backlog includes updating §2.5 to document the path.
 *
 * **Idempotency:** the route layer is responsible. If this service is
 * called twice for the same order, the second call returns
 * `'invalid_transition'` (refunded is terminal; no outbound
 * transitions). The state-machine surface is the idempotency gate.
 *
 * **Refund amount:** the full `totalPaisa` from the original order
 * (what the buyer paid; what EPS captured; what the dashboard refund
 * reverses). v1.0 Phase 2b does not support partial refunds — every
 * disputed order is fully refunded since the platform never honored
 * the ticket.
 */

import { eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { orderEvents, orders, refunds } from '../../db/schema/index.js'
import { validateTransition, type OrderStatus } from '../../domain/order-state-machine.js'
import { logger } from '../../lib/logger.js'
import { writeOrderRefunded } from '../audit/orders.js'

export type ManualRefundResult =
  | {
      kind: 'refunded'
      orderId: string
      refundId: string
      amountPaisa: bigint
      previousStatus: OrderStatus
    }
  | { kind: 'not_found'; orderId: string }
  | {
      kind: 'invalid_transition'
      orderId: string
      currentStatus: OrderStatus
      reason: string
    }

export interface ManualRefundInput {
  orderId: string
  /** Super-admin user ID issuing the mark-refunded action. */
  refundedBy: string
  /**
   * Human-readable reason text persisted on the refunds row. v1.0
   * Phase 2b passes a fixed-ish string from the route; future use may
   * accept reviewer-typed text for non-default refund reasons.
   */
  reasonText: string
}

/**
 * Mark a disputed order as refunded. Pure orchestration over the
 * state machine + DB writes inside one `withSuperAdmin` tx (BYPASSRLS
 * because the super-admin's session has no tenant context but the
 * audit + order_events rows need `tenant_id` populated from the
 * order row).
 *
 * Returns a `ManualRefundResult`; throws only on truly unexpected DB
 * errors (caller bubbles to 500).
 */
export async function markDisputedOrderRefunded(
  input: ManualRefundInput,
): Promise<ManualRefundResult> {
  // STEP 1 — look up order.
  const orderRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        eventId: orders.eventId,
        merchantTransactionId: orders.merchantTransactionId,
        status: orders.status,
        totalPaisa: orders.totalPaisa,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!orderRow) {
    logger.warn({ orderId: input.orderId }, 'manual_refund.not_found')
    return { kind: 'not_found', orderId: input.orderId }
  }

  const currentStatus = orderRow.status as OrderStatus

  // STEP 2 — state machine validation.
  // The route + UX restrict callers to `disputed` orders; the state
  // machine is the load-bearing gate (handles idempotency: a second
  // call to mark an already-refunded order returns invalid_transition
  // because `refunded` is terminal).
  const t = validateTransition(currentStatus, 'refunded')
  if (!t.valid) {
    logger.warn(
      {
        orderId: orderRow.id,
        currentStatus,
        attemptedTarget: 'refunded',
        reason: t.reason,
        refundedBy: input.refundedBy,
      },
      'manual_refund.invalid_transition',
    )
    return {
      kind: 'invalid_transition',
      orderId: orderRow.id,
      currentStatus,
      reason: t.reason ?? 'unknown',
    }
  }

  // STEP 3 — apply transition in one tx.
  const refundId = await withSuperAdmin(async (db) => {
    // 3a. INSERT refunds row marked `processed` — the actual EPS-side
    //     refund already completed (super-admin used the dashboard
    //     before calling this endpoint).
    const [refundRow] = await db
      .insert(refunds)
      .values({
        tenantId: orderRow.tenantId,
        orderId: orderRow.id,
        amountPaisa: orderRow.totalPaisa,
        reason: input.reasonText,
        initiatedBy: input.refundedBy,
        status: 'processed',
        processedAt: new Date(),
      })
      .returning({ id: refunds.id })
    const rid = refundRow!.id

    // 3b. UPDATE orders.status = 'refunded'. (No `refundedAt` column
    //     on orders; the timestamp lives on the refunds row's
    //     `processedAt` + the order_events row's `created_at`.)
    await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, orderRow.id))

    // 3c. order_events — append-only event-sourcing trail (§2.5).
    await db.insert(orderEvents).values({
      tenantId: orderRow.tenantId,
      orderId: orderRow.id,
      eventType: 'order.refunded',
      actorType: 'super_admin',
      actorId: input.refundedBy,
      payload: {
        source: 'super_admin_manual_refund',
        merchant_transaction_id: orderRow.merchantTransactionId,
        refund_id: rid,
        refund_reason: 'manual_refund_after_non_bkash_dispute',
        amount_paisa: orderRow.totalPaisa.toString(),
      },
    })

    // 3d. audit_logs — platform audit (§1.3 R8) via the one-per-domain
    //     helper.
    await writeOrderRefunded(db, {
      orderId: orderRow.id,
      tenantId: orderRow.tenantId,
      eventId: orderRow.eventId,
      merchantTransactionId: orderRow.merchantTransactionId,
      amountPaisa: orderRow.totalPaisa,
      refundReason: 'manual_refund_after_non_bkash_dispute',
      previousStatus: currentStatus,
      refundedBy: input.refundedBy,
      refundId: rid,
    })

    return rid
  })

  logger.info(
    {
      orderId: orderRow.id,
      refundId,
      amountPaisa: orderRow.totalPaisa.toString(),
      previousStatus: currentStatus,
      refundedBy: input.refundedBy,
    },
    'manual_refund.completed',
  )

  return {
    kind: 'refunded',
    orderId: orderRow.id,
    refundId,
    amountPaisa: orderRow.totalPaisa,
    previousStatus: currentStatus,
  }
}
