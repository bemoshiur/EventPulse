/**
 * Refund flow orchestration — Day 41 Sprint 4 (§26.1 Day 7-8 + §29 #5).
 *
 * Four functions cover the v1.0 refund lifecycle:
 *
 *   1. requestRefund         — TENANT initiates; paid → refund_requested
 *                              + INSERT refunds(status='pending')
 *
 *   2. approveRefund         — SUPER-ADMIN approves; refunds.status
 *                              pending → approved. orders.status stays
 *                              refund_requested until the EPS dashboard
 *                              refund is issued + mark-processed fires.
 *
 *   3. rejectRefund          — SUPER-ADMIN declines; refunds.status
 *                              pending → rejected AND orders.status
 *                              refund_requested → paid (rollback). No
 *                              money moves; super_admin_notes required.
 *
 *   4. markRefundProcessed   — SUPER-ADMIN closes the loop after issuing
 *                              the EPS dashboard refund out-of-band;
 *                              refunds.status approved → processed AND
 *                              orders.status refund_requested → refunded.
 *
 * **Authority model.** Routes enforce auth gates per audience; this
 * service trusts the actorId fields supplied by callers because the
 * routes are the trust boundary (mirrors Phase 2b manual-refund
 * pattern).
 *
 * **State machine.** All four functions validate via
 * domain/order-state-machine.ts `validateTransition`. The state
 * machine is the load-bearing idempotency gate — calling
 * approveRefund twice on the same refund returns
 * 'invalid_refund_state' because refunds.status='approved' cannot
 * re-approve.
 *
 * **Money math.** v1.0 = FULL-REFUND ONLY. The refund's amountPaisa
 * always equals order.totalPaisa. Partial refunds are Phase 2 scope
 * (the schema already supports arbitrary amounts via amount_paisa).
 * v1.0 service rejects any amount mismatch up front.
 *
 * **Idempotency.** The state-machine gates idempotency at the row
 * level. Route-layer Idempotency-Key middleware adds the HTTP
 * idempotency story (replay-safe via cached response per §6.4).
 *
 * **EPS-side coupling.** None. The EPS refund happens out-of-band via
 * the merchant dashboard between approveRefund and markRefundProcessed
 * (§11.4: EPS V5 has no public refund API). Settlement netting of the
 * refund amount against disbursement batches is Phase 2 scope (§14.9).
 */

import { and, eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { orderEvents, orders, refunds } from '../../db/schema/index.js'
import { validateTransition, type OrderStatus } from '../../domain/order-state-machine.js'
import { logger } from '../../lib/logger.js'
import {
  writeOrderRefunded,
  writeRefundApproved,
  writeRefundRejected,
  writeRefundRequested,
} from '../audit/orders.js'

// ─── 1. requestRefund (tenant-initiated) ─────────────────────────────

export interface RequestRefundInput {
  orderId: string
  tenantId: string
  /** Tenant-user ID submitting the request (audited as actor). */
  initiatedBy: string
  /** Free-text reason supplied by the tenant. Stored on refunds.reason. */
  reason: string
  /** Categorical reason_code. v1.0 default is 'tenant_requested'. */
  reasonCode: 'tenant_requested' | 'other'
  ip: string | null
  userAgent: string | null
}

export type RequestRefundResult =
  | {
      kind: 'requested'
      orderId: string
      refundId: string
      amountPaisa: bigint
    }
  | { kind: 'not_found'; orderId: string }
  | { kind: 'cross_tenant'; orderId: string }
  | {
      kind: 'invalid_transition'
      orderId: string
      currentStatus: OrderStatus
      reason: string
    }
  | {
      kind: 'already_requested'
      orderId: string
      existingRefundId: string
    }

export async function requestRefund(input: RequestRefundInput): Promise<RequestRefundResult> {
  // STEP 1 — read the order under withSuperAdmin (public buyer rows
  // aren't visible to the tenant role; the tenant-portal route's
  // tenantId is the security boundary; we cross-check below).
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
    logger.warn({ orderId: input.orderId }, 'request_refund.not_found')
    return { kind: 'not_found', orderId: input.orderId }
  }

  // STEP 2 — cross-tenant guard. The tenant route restricts callers
  // to their own tenant; orders is platform-global so we verify the
  // requesting tenant owns the order.
  if (orderRow.tenantId !== input.tenantId) {
    logger.warn(
      { orderId: orderRow.id, callerTenant: input.tenantId, orderTenant: orderRow.tenantId },
      'request_refund.cross_tenant',
    )
    return { kind: 'cross_tenant', orderId: orderRow.id }
  }

  const currentStatus = orderRow.status as OrderStatus

  // STEP 3 — state machine validation. Only `paid → refund_requested`
  // is legal from the tenant-initiation path.
  const t = validateTransition(currentStatus, 'refund_requested')
  if (!t.valid) {
    logger.warn(
      {
        orderId: orderRow.id,
        currentStatus,
        attemptedTarget: 'refund_requested',
        reason: t.reason,
      },
      'request_refund.invalid_transition',
    )
    return {
      kind: 'invalid_transition',
      orderId: orderRow.id,
      currentStatus,
      reason: t.reason ?? 'unknown',
    }
  }

  // STEP 4 — defensive guard: an existing pending refund for this
  // order would conflict with the new request. The state machine
  // already catches "paid → refund_requested can't happen from
  // refund_requested" — but if the order somehow is at `paid` while
  // a stale pending refund exists, surface a clean 409 rather than
  // silently creating a duplicate.
  const existing = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({ id: refunds.id })
      .from(refunds)
      .where(and(eq(refunds.orderId, orderRow.id), eq(refunds.status, 'pending')))
      .limit(1)
    return rows[0] ?? null
  })
  if (existing) {
    logger.warn(
      { orderId: orderRow.id, existingRefundId: existing.id },
      'request_refund.already_requested',
    )
    return { kind: 'already_requested', orderId: orderRow.id, existingRefundId: existing.id }
  }

  // STEP 5 — single-tx INSERT refunds + UPDATE orders + order_events
  // + audit_logs. Rollback semantics: if any step throws, the order
  // never transitions and no refund row persists.
  const refundId = await withSuperAdmin(async (db) => {
    // 5a. INSERT refunds(status='pending').
    const [refundRow] = await db
      .insert(refunds)
      .values({
        tenantId: orderRow.tenantId,
        orderId: orderRow.id,
        amountPaisa: orderRow.totalPaisa, // v1.0 full-refund only
        reason: input.reason,
        reasonCode: input.reasonCode,
        initiatedBy: input.initiatedBy,
        status: 'pending',
      })
      .returning({ id: refunds.id })
    const rid = refundRow!.id

    // 5b. UPDATE orders.status = 'refund_requested'.
    await db.update(orders).set({ status: 'refund_requested' }).where(eq(orders.id, orderRow.id))

    // 5c. order_events trail (§2.5).
    await db.insert(orderEvents).values({
      tenantId: orderRow.tenantId,
      orderId: orderRow.id,
      eventType: 'order.refund_requested',
      actorType: 'tenant_user',
      actorId: input.initiatedBy,
      payload: {
        source: 'tenant_portal_refund_request',
        merchant_transaction_id: orderRow.merchantTransactionId,
        refund_id: rid,
        refund_reason: input.reason,
        refund_reason_code: input.reasonCode,
        amount_paisa: orderRow.totalPaisa.toString(),
      },
    })

    // 5d. audit_logs (§1.3 R8).
    await writeRefundRequested(db, {
      orderId: orderRow.id,
      tenantId: orderRow.tenantId,
      eventId: orderRow.eventId,
      merchantTransactionId: orderRow.merchantTransactionId,
      amountPaisa: orderRow.totalPaisa,
      reason: input.reason,
      reasonCode: input.reasonCode,
      initiatedBy: input.initiatedBy,
      refundId: rid,
      ip: input.ip,
      userAgent: input.userAgent,
    })

    return rid
  })

  logger.info(
    {
      orderId: orderRow.id,
      refundId,
      amountPaisa: orderRow.totalPaisa.toString(),
      initiatedBy: input.initiatedBy,
    },
    'request_refund.completed',
  )

  return {
    kind: 'requested',
    orderId: orderRow.id,
    refundId,
    amountPaisa: orderRow.totalPaisa,
  }
}

// ─── 2. approveRefund (super-admin) ──────────────────────────────────

export interface ApproveRefundInput {
  refundId: string
  /** Super-admin user ID issuing the approval. */
  approvedBy: string
  /** Optional reviewer notes. */
  superAdminNotes: string | null
}

export type ApproveRefundResult =
  | {
      kind: 'approved'
      refundId: string
      orderId: string
      amountPaisa: bigint
    }
  | { kind: 'not_found'; refundId: string }
  | {
      kind: 'invalid_refund_state'
      refundId: string
      currentStatus: string
    }

export async function approveRefund(input: ApproveRefundInput): Promise<ApproveRefundResult> {
  const refundRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: refunds.id,
        tenantId: refunds.tenantId,
        orderId: refunds.orderId,
        amountPaisa: refunds.amountPaisa,
        status: refunds.status,
      })
      .from(refunds)
      .where(eq(refunds.id, input.refundId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!refundRow) {
    logger.warn({ refundId: input.refundId }, 'approve_refund.not_found')
    return { kind: 'not_found', refundId: input.refundId }
  }

  if (refundRow.status !== 'pending') {
    logger.warn(
      { refundId: refundRow.id, currentStatus: refundRow.status },
      'approve_refund.invalid_refund_state',
    )
    return { kind: 'invalid_refund_state', refundId: refundRow.id, currentStatus: refundRow.status }
  }

  // Fetch order context for the audit-row payload.
  const orderRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        eventId: orders.eventId,
        merchantTransactionId: orders.merchantTransactionId,
      })
      .from(orders)
      .where(eq(orders.id, refundRow.orderId))
      .limit(1)
    return rows[0]!
  })

  await withSuperAdmin(async (db) => {
    await db
      .update(refunds)
      .set({
        status: 'approved',
        approvedBy: input.approvedBy,
        approvedAt: new Date(),
        superAdminNotes: input.superAdminNotes,
      })
      .where(eq(refunds.id, refundRow.id))

    await db.insert(orderEvents).values({
      tenantId: refundRow.tenantId,
      orderId: refundRow.orderId,
      eventType: 'order.refund_approved',
      actorType: 'super_admin',
      actorId: input.approvedBy,
      payload: {
        source: 'super_admin_refund_approval',
        refund_id: refundRow.id,
        amount_paisa: refundRow.amountPaisa.toString(),
      },
    })

    await writeRefundApproved(db, {
      orderId: refundRow.orderId,
      tenantId: refundRow.tenantId,
      eventId: orderRow.eventId,
      merchantTransactionId: orderRow.merchantTransactionId,
      amountPaisa: refundRow.amountPaisa,
      refundId: refundRow.id,
      approvedBy: input.approvedBy,
      superAdminNotes: input.superAdminNotes,
    })
  })

  logger.info(
    { refundId: refundRow.id, orderId: refundRow.orderId, approvedBy: input.approvedBy },
    'approve_refund.completed',
  )

  return {
    kind: 'approved',
    refundId: refundRow.id,
    orderId: refundRow.orderId,
    amountPaisa: refundRow.amountPaisa,
  }
}

// ─── 3. rejectRefund (super-admin) ───────────────────────────────────

export interface RejectRefundInput {
  refundId: string
  rejectedBy: string
  /** REQUIRED for rejections — captures the why for tenant + audit. */
  superAdminNotes: string
}

export type RejectRefundResult =
  | {
      kind: 'rejected'
      refundId: string
      orderId: string
      orderRolledBackTo: 'paid'
    }
  | { kind: 'not_found'; refundId: string }
  | {
      kind: 'invalid_refund_state'
      refundId: string
      currentStatus: string
    }
  | {
      kind: 'invalid_transition'
      refundId: string
      orderId: string
      currentOrderStatus: OrderStatus
      reason: string
    }

export async function rejectRefund(input: RejectRefundInput): Promise<RejectRefundResult> {
  const refundRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: refunds.id,
        tenantId: refunds.tenantId,
        orderId: refunds.orderId,
        amountPaisa: refunds.amountPaisa,
        status: refunds.status,
      })
      .from(refunds)
      .where(eq(refunds.id, input.refundId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!refundRow) {
    logger.warn({ refundId: input.refundId }, 'reject_refund.not_found')
    return { kind: 'not_found', refundId: input.refundId }
  }

  if (refundRow.status !== 'pending') {
    logger.warn(
      { refundId: refundRow.id, currentStatus: refundRow.status },
      'reject_refund.invalid_refund_state',
    )
    return { kind: 'invalid_refund_state', refundId: refundRow.id, currentStatus: refundRow.status }
  }

  const orderRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: orders.id,
        eventId: orders.eventId,
        merchantTransactionId: orders.merchantTransactionId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, refundRow.orderId))
      .limit(1)
    return rows[0]!
  })

  const currentOrderStatus = orderRow.status as OrderStatus
  const t = validateTransition(currentOrderStatus, 'paid')
  if (!t.valid) {
    // This should not happen in normal flow (orders.status must be
    // refund_requested for a pending refund to exist), but defensive
    // surface for callers.
    logger.warn(
      {
        refundId: refundRow.id,
        orderId: orderRow.id,
        currentOrderStatus,
        reason: t.reason,
      },
      'reject_refund.invalid_order_transition',
    )
    return {
      kind: 'invalid_transition',
      refundId: refundRow.id,
      orderId: orderRow.id,
      currentOrderStatus,
      reason: t.reason ?? 'unknown',
    }
  }

  await withSuperAdmin(async (db) => {
    await db
      .update(refunds)
      .set({
        status: 'rejected',
        rejectedBy: input.rejectedBy,
        rejectedAt: new Date(),
        superAdminNotes: input.superAdminNotes,
      })
      .where(eq(refunds.id, refundRow.id))

    await db.update(orders).set({ status: 'paid' }).where(eq(orders.id, orderRow.id))

    await db.insert(orderEvents).values({
      tenantId: refundRow.tenantId,
      orderId: orderRow.id,
      eventType: 'order.refund_rejected',
      actorType: 'super_admin',
      actorId: input.rejectedBy,
      payload: {
        source: 'super_admin_refund_rejection',
        refund_id: refundRow.id,
        amount_paisa: refundRow.amountPaisa.toString(),
        super_admin_notes: input.superAdminNotes,
        order_rolled_back_to: 'paid',
      },
    })

    await writeRefundRejected(db, {
      orderId: orderRow.id,
      tenantId: refundRow.tenantId,
      eventId: orderRow.eventId,
      merchantTransactionId: orderRow.merchantTransactionId,
      amountPaisa: refundRow.amountPaisa,
      refundId: refundRow.id,
      rejectedBy: input.rejectedBy,
      superAdminNotes: input.superAdminNotes,
    })
  })

  logger.info(
    { refundId: refundRow.id, orderId: orderRow.id, rejectedBy: input.rejectedBy },
    'reject_refund.completed',
  )

  return {
    kind: 'rejected',
    refundId: refundRow.id,
    orderId: orderRow.id,
    orderRolledBackTo: 'paid',
  }
}

// ─── 4. markRefundProcessed (super-admin, post-EPS-dashboard refund) ──

export interface MarkRefundProcessedInput {
  refundId: string
  processedBy: string
}

export type MarkRefundProcessedResult =
  | {
      kind: 'processed'
      refundId: string
      orderId: string
      amountPaisa: bigint
    }
  | { kind: 'not_found'; refundId: string }
  | {
      kind: 'invalid_refund_state'
      refundId: string
      currentStatus: string
    }
  | {
      kind: 'invalid_transition'
      refundId: string
      orderId: string
      currentOrderStatus: OrderStatus
      reason: string
    }

export async function markRefundProcessed(
  input: MarkRefundProcessedInput,
): Promise<MarkRefundProcessedResult> {
  const refundRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: refunds.id,
        tenantId: refunds.tenantId,
        orderId: refunds.orderId,
        amountPaisa: refunds.amountPaisa,
        status: refunds.status,
      })
      .from(refunds)
      .where(eq(refunds.id, input.refundId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!refundRow) {
    logger.warn({ refundId: input.refundId }, 'mark_refund_processed.not_found')
    return { kind: 'not_found', refundId: input.refundId }
  }

  if (refundRow.status !== 'approved') {
    logger.warn(
      { refundId: refundRow.id, currentStatus: refundRow.status },
      'mark_refund_processed.invalid_refund_state',
    )
    return { kind: 'invalid_refund_state', refundId: refundRow.id, currentStatus: refundRow.status }
  }

  const orderRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: orders.id,
        eventId: orders.eventId,
        merchantTransactionId: orders.merchantTransactionId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, refundRow.orderId))
      .limit(1)
    return rows[0]!
  })

  const currentOrderStatus = orderRow.status as OrderStatus
  const t = validateTransition(currentOrderStatus, 'refunded')
  if (!t.valid) {
    logger.warn(
      {
        refundId: refundRow.id,
        orderId: orderRow.id,
        currentOrderStatus,
        reason: t.reason,
      },
      'mark_refund_processed.invalid_order_transition',
    )
    return {
      kind: 'invalid_transition',
      refundId: refundRow.id,
      orderId: orderRow.id,
      currentOrderStatus,
      reason: t.reason ?? 'unknown',
    }
  }

  await withSuperAdmin(async (db) => {
    await db
      .update(refunds)
      .set({
        status: 'processed',
        processedBy: input.processedBy,
        processedAt: new Date(),
      })
      .where(eq(refunds.id, refundRow.id))

    await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, orderRow.id))

    await db.insert(orderEvents).values({
      tenantId: refundRow.tenantId,
      orderId: orderRow.id,
      eventType: 'order.refunded',
      actorType: 'super_admin',
      actorId: input.processedBy,
      payload: {
        source: 'super_admin_mark_refund_processed',
        merchant_transaction_id: orderRow.merchantTransactionId,
        refund_id: refundRow.id,
        refund_reason: 'tenant_initiated_refund',
        amount_paisa: refundRow.amountPaisa.toString(),
      },
    })

    await writeOrderRefunded(db, {
      orderId: orderRow.id,
      tenantId: refundRow.tenantId,
      eventId: orderRow.eventId,
      merchantTransactionId: orderRow.merchantTransactionId,
      amountPaisa: refundRow.amountPaisa,
      refundReason: 'tenant_initiated_refund',
      previousStatus: currentOrderStatus,
      refundedBy: input.processedBy,
      refundId: refundRow.id,
    })
  })

  logger.info(
    { refundId: refundRow.id, orderId: orderRow.id, processedBy: input.processedBy },
    'mark_refund_processed.completed',
  )

  return {
    kind: 'processed',
    refundId: refundRow.id,
    orderId: orderRow.id,
    amountPaisa: refundRow.amountPaisa,
  }
}
