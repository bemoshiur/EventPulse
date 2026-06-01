/**
 * Audit helpers for the orders domain — Sprint 3 Day 26 Phase 4.
 *
 * Sibling to apps/api/src/services/audit/{events,kyc,tenant,
 * tenant-subdomain,legal,fee-config,ticket-tiers}.ts. One-per-domain
 * audit-helper convention per decisions.md 2026-05-17 (reaffirmed
 * 2026-05-18).
 *
 * Shipping today (Day 26):
 *   • writeOrderCreated — public-buyer order creation; written in the
 *     same tx as the orders INSERT under withSuperAdmin. Captures
 *     non-PII metadata only (order id, event id, fee-snapshot bps,
 *     amounts in paisa as strings to preserve bigint precision in
 *     jsonb). Buyer name/email/phone/NID are NEVER captured here per
 *     §1.3 R5 — they live on the orders row itself, NOT in the audit
 *     trail (where they would be replicated across every state
 *     transition for the life of the order).
 *
 * Future helpers (Day 27+):
 *   • writeOrderPaid           — Verify-confirmed payment transition
 *   • writeOrderCancelled      — buyer cancel on EPS hosted page
 *   • writeOrderFailed         — EPS-reported failure
 *   • writeOrderRefunded       — refund processed
 *
 * The buyer-write path uses actor_type='system' because no
 * authenticated user record exists for the buyer at order-create
 * time. The actor_id is null. This is the documented exception to
 * "actor_id always set" — §9.10 actor_type='system' is valid with
 * actor_id null.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { auditLogs } from '../../db/schema/index.js'

type Tx = NodePgDatabase<Record<string, unknown>>

// ─── writeOrderCreated ───────────────────────────────────────────────

export interface WriteOrderCreatedInput {
  orderId: string
  tenantId: string
  eventId: string
  merchantTransactionId: string
  subtotalPaisa: bigint
  platformFeePaisa: bigint
  epsFeePaisa: bigint
  totalPaisa: bigint
  netToOrganiserPaisa: bigint
  platformFeeBps: number
  epsFeeBps: number
  platformFeeHandling: 'absorb' | 'pass_through'
  epsFeeHandling: 'absorb' | 'pass_through'
  ip?: string | null
  userAgent?: string | null
}

/**
 * Birth audit for a public-buyer order. Fires in the same tx as the
 * orders INSERT (under withSuperAdmin). Captures fee-snapshot inputs
 * + amounts so reconciliation post-mortem can match the audit row to
 * the calculator inputs without joining back to mutable foreign-key
 * tables.
 */
export async function writeOrderCreated(tx: Tx, input: WriteOrderCreatedInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'system',
    actorId: null,
    action: 'order.created',
    entityType: 'order',
    entityId: input.orderId,
    diff: {
      event_id: input.eventId,
      merchant_transaction_id: input.merchantTransactionId,
      // Paisa amounts serialised as strings — Postgres jsonb does NOT
      // preserve bigint precision (it stores numbers as JSON number =
      // double). String round-trips losslessly.
      subtotal_paisa: input.subtotalPaisa.toString(),
      platform_fee_paisa: input.platformFeePaisa.toString(),
      eps_fee_paisa: input.epsFeePaisa.toString(),
      total_paisa: input.totalPaisa.toString(),
      net_to_organiser_paisa: input.netToOrganiserPaisa.toString(),
      platform_fee_bps: input.platformFeeBps,
      eps_fee_bps: input.epsFeeBps,
      platform_fee_handling: input.platformFeeHandling,
      eps_fee_handling: input.epsFeeHandling,
    },
    metadata: { source: 'public_buyer_route', event_id: input.eventId },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
}

// ─── writeOrderSettled (Day 27 Phase 2) ──────────────────────────────

export interface WriteOrderSettledInput {
  orderId: string
  tenantId: string
  eventId: string
  merchantTransactionId: string
  /** State machine `from` — captured so the audit row tells a complete story. */
  previousStatus: string
  /** State machine `to` — paid / failed / cancelled at Day-27 hot path. */
  newStatus: string
  /** EPS canonical status the verify returned (per normalise-status.ts). */
  epsStatus: 'success' | 'failed' | 'cancelled' | 'pending' | 'unknown'
  /** Which trigger source caused the settlement: 'webhook' / 'redirect_success' / etc. */
  source: string
  /** Optional EPS-side transaction id captured from the verify response (when present). */
  epsTransactionId?: string
}

/**
 * Settlement audit. Fires in the same tx as the orders UPDATE +
 * order_events INSERT under withSuperAdmin. The diff carries the
 * previous + new status so a single audit row tells the transition
 * story without needing to join back to prior audit rows.
 *
 * No PII — buyer details stay on the orders row + the order_events
 * payload. This row is structural + audit-of-money.
 */
export async function writeOrderSettled(tx: Tx, input: WriteOrderSettledInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'system',
    actorId: null,
    action: `order.${input.newStatus}`,
    entityType: 'order',
    entityId: input.orderId,
    diff: {
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      eps_status: input.epsStatus,
      merchant_transaction_id: input.merchantTransactionId,
      ...(input.epsTransactionId ? { eps_transaction_id: input.epsTransactionId } : {}),
    },
    metadata: { source: input.source, event_id: input.eventId },
    ip: null,
    userAgent: null,
  })
}

// ─── writeOrderDisputed (Day 38 Phase 2 — v1.0 single-method launch) ─

export interface WriteOrderDisputedInput {
  orderId: string
  tenantId: string
  eventId: string
  merchantTransactionId: string
  /** State machine `from` — typically `awaiting_payment` for the v1.0 Verify-guard path. */
  previousStatus: string
  /** EPS canonical status from verifyOrder — typically `success` (EPS accepted; we refused). */
  epsStatus: 'success' | 'failed' | 'cancelled' | 'pending' | 'unknown'
  /** Which trigger source caused the dispute discovery: 'webhook' / 'redirect_success' / etc. */
  source: string
  /**
   * Machine-readable reason code. v1.0 launch uses
   * `'non_bkash_method_at_verify'` exclusively (Verify-guard for the
   * single-method launch). Future expansion: `'eps_chargeback'`,
   * `'tenant_initiated'`, etc. Tracked as a string union at the
   * application layer rather than a DB enum to keep dispute reasons
   * extensible without migration.
   */
  disputeReason: 'non_bkash_method_at_verify'
  /**
   * The actual FinancialEntity value EPS reported on the Verify
   * response. For v1.0 this is anything-not-bKash; captured verbatim
   * (no normalisation) so ops can see exactly what method the buyer
   * used. May be null/missing if EPS didn't populate the field.
   */
  financialEntity: string | null
  /** Optional EPS-side transaction id captured from the verify response (when present). */
  epsTransactionId?: string
}

/**
 * Dispute audit. Fires when the v1.0 single-method launch Verify-guard
 * (Day 38 Phase 2 (d), per decisions.md 2026-05-31 Option 3) diverts an
 * awaiting_payment order to `disputed` because EPS Verify returned
 * Success but the buyer used a non-bKash payment method.
 *
 * The diff carries previous_status + new_status (mirroring
 * writeOrderSettled's structure for a regular settlement) PLUS
 * dispute_reason + financial_entity so ops + reviewers can see at a
 * glance:
 *
 *   - what status this order was in (awaiting_payment)
 *   - what status it's now in (disputed)
 *   - why we disputed (non_bkash_method_at_verify)
 *   - what method the buyer actually used (the verbatim FinancialEntity)
 *
 * Fires in the same tx as the orders UPDATE + order_events INSERT
 * under withSuperAdmin. No PII — buyer details stay on the orders row.
 *
 * **Ops queue source (v1.0):** until the Phase 2b admin queue UI
 * lands, ops queries the `audit_logs` table directly for rows with
 * `action = 'order.disputed'` to drive the manual-refund work. This
 * is documented as the v1.0 launch posture per the Day 38 Phase 2 (d)
 * decision.
 */
export async function writeOrderDisputed(tx: Tx, input: WriteOrderDisputedInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'system',
    actorId: null,
    action: 'order.disputed',
    entityType: 'order',
    entityId: input.orderId,
    diff: {
      previous_status: input.previousStatus,
      new_status: 'disputed',
      eps_status: input.epsStatus,
      dispute_reason: input.disputeReason,
      // FinancialEntity verbatim from EPS — could be 'card', 'Nagad',
      // 'Rocket', null, or any string EPS chose. Captured exactly as
      // observed so future analysis can decode deviation patterns.
      financial_entity: input.financialEntity,
      merchant_transaction_id: input.merchantTransactionId,
      ...(input.epsTransactionId ? { eps_transaction_id: input.epsTransactionId } : {}),
    },
    metadata: { source: input.source, event_id: input.eventId },
    ip: null,
    userAgent: null,
  })
}

// ─── writeRefundRequested (Day 41 Sprint 4 — tenant-initiated refund request) ─

export interface WriteRefundRequestedInput {
  orderId: string
  tenantId: string
  eventId: string
  merchantTransactionId: string
  /** Refund amount in paisa. v1.0 = order.totalPaisa (full-refund only). */
  amountPaisa: bigint
  /** Free-text reason supplied by the tenant. */
  reason: string
  /** Categorical reason_code for analytics — typically 'tenant_requested'. */
  reasonCode: string
  /** Tenant-user who initiated the refund request. */
  initiatedBy: string
  /** UUID of the refunds-table row inserted in the same tx (status='pending'). */
  refundId: string
  ip: string | null
  userAgent: string | null
}

/**
 * Tenant-initiated refund request audit. Fires when a tenant submits a
 * refund request via the tenant portal. Captures the orders.status
 * transition `paid → refund_requested` + the new refunds row in
 * `pending` state. The refund is NOT yet executed — super-admin
 * approval comes next via writeRefundApproved / writeRefundRejected.
 */
export async function writeRefundRequested(
  tx: Tx,
  input: WriteRefundRequestedInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'tenant_user',
    actorId: input.initiatedBy,
    action: 'order.refund_requested',
    entityType: 'order',
    entityId: input.orderId,
    diff: {
      previous_status: 'paid',
      new_status: 'refund_requested',
      refund_reason: input.reason,
      refund_reason_code: input.reasonCode,
      amount_paisa: input.amountPaisa.toString(),
      refund_id: input.refundId,
      merchant_transaction_id: input.merchantTransactionId,
    },
    metadata: { source: 'tenant_portal_refund_request', event_id: input.eventId },
    ip: input.ip,
    userAgent: input.userAgent,
  })
}

// ─── writeRefundApproved (Day 41 Sprint 4 — super-admin approval) ─

export interface WriteRefundApprovedInput {
  orderId: string
  tenantId: string
  eventId: string
  merchantTransactionId: string
  amountPaisa: bigint
  refundId: string
  /** Super-admin who approved. */
  approvedBy: string
  /** Optional reviewer notes captured at approval time. */
  superAdminNotes: string | null
}

/**
 * Super-admin approval audit. Fires when a super-admin approves a
 * pending tenant refund request. orders.status stays at
 * `refund_requested` until the super-admin issues the EPS-dashboard
 * refund out-of-band and then calls mark-processed. This audit row
 * captures only the refunds.status `pending → approved` transition.
 */
export async function writeRefundApproved(tx: Tx, input: WriteRefundApprovedInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'super_admin',
    actorId: input.approvedBy,
    action: 'refund.approved',
    entityType: 'refund',
    entityId: input.refundId,
    diff: {
      refund_id: input.refundId,
      refund_previous_status: 'pending',
      refund_new_status: 'approved',
      amount_paisa: input.amountPaisa.toString(),
      merchant_transaction_id: input.merchantTransactionId,
      order_id: input.orderId,
      super_admin_notes: input.superAdminNotes,
    },
    metadata: { source: 'super_admin_refund_approval', event_id: input.eventId },
    ip: null,
    userAgent: null,
  })
}

// ─── writeRefundRejected (Day 41 Sprint 4 — super-admin rejection rollback) ─

export interface WriteRefundRejectedInput {
  orderId: string
  tenantId: string
  eventId: string
  merchantTransactionId: string
  amountPaisa: bigint
  refundId: string
  /** Super-admin who rejected. */
  rejectedBy: string
  /** Reviewer notes — REQUIRED on rejection to capture the why. */
  superAdminNotes: string
}

/**
 * Super-admin rejection audit. Fires when a super-admin rejects a
 * pending refund request. Captures BOTH transitions in a single audit
 * row: refunds.status `pending → rejected` AND orders.status
 * `refund_requested → paid` (the rollback that returns the order to
 * its honored state). super_admin_notes is required on the input
 * shape — rejections must be justified for tenant communication +
 * audit trail integrity.
 */
export async function writeRefundRejected(tx: Tx, input: WriteRefundRejectedInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'super_admin',
    actorId: input.rejectedBy,
    action: 'refund.rejected',
    entityType: 'refund',
    entityId: input.refundId,
    diff: {
      refund_id: input.refundId,
      refund_previous_status: 'pending',
      refund_new_status: 'rejected',
      order_previous_status: 'refund_requested',
      order_new_status: 'paid',
      amount_paisa: input.amountPaisa.toString(),
      merchant_transaction_id: input.merchantTransactionId,
      order_id: input.orderId,
      super_admin_notes: input.superAdminNotes,
    },
    metadata: { source: 'super_admin_refund_rejection', event_id: input.eventId },
    ip: null,
    userAgent: null,
  })
}

// ─── writeOrderRefunded (Day 39 Phase 2b + Day 41 Sprint 4 generalisation) ─

/**
 * Day 41 Sprint 4: refundReason expanded from a single-literal union
 * to a wider union covering both the Phase 2b disputed-manual path
 * AND the Day 41 tenant-initiated path. The audit row format is
 * identical; only the source string differs.
 */
export type RefundReasonCode =
  | 'manual_refund_after_non_bkash_dispute' // Phase 2b backfill
  | 'tenant_initiated_refund' // Day 41
  | 'reconciliation_correction' // Phase 2+ settlement layer
  | 'other'

export interface WriteOrderRefundedInput {
  orderId: string
  tenantId: string
  eventId: string
  merchantTransactionId: string
  /** Refund amount in paisa; v1.0 always equals order.totalPaisa (full-refund only). */
  amountPaisa: bigint
  /** Refund reason code — taxonomy aligned with refunds.reason_code column. */
  refundReason: RefundReasonCode
  /** State machine `from` — `disputed` for Phase 2b path, `refund_requested` for Day 41 tenant-initiated path. */
  previousStatus: string
  /** ID of the super-admin user who marked the refund complete. */
  refundedBy: string
  /** UUID of the refunds-table row associated with this refund. */
  refundId: string
}

/**
 * Refund completion audit. Fires when a super-admin completes a refund
 * (transitions orders.status `<previousStatus> → refunded` +
 * refunds.status `<previousStatus> → processed`).
 *
 * Two call sites:
 *   1. Phase 2b `markDisputedOrderRefunded` (`disputed → refunded`,
 *      refundReason='manual_refund_after_non_bkash_dispute')
 *   2. Day 41 Sprint 4 `markRefundProcessed` (`refund_requested →
 *      refunded`, refundReason='tenant_initiated_refund')
 *
 * Both paths converge on this single helper to keep the audit row
 * format consistent — the diff payload tells the complete refund
 * story without needing a join. No PII — buyer details stay on the
 * orders row.
 */
export async function writeOrderRefunded(tx: Tx, input: WriteOrderRefundedInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'super_admin',
    actorId: input.refundedBy,
    action: 'order.refunded',
    entityType: 'order',
    entityId: input.orderId,
    diff: {
      previous_status: input.previousStatus,
      new_status: 'refunded',
      refund_reason: input.refundReason,
      amount_paisa: input.amountPaisa.toString(),
      refund_id: input.refundId,
      merchant_transaction_id: input.merchantTransactionId,
    },
    metadata: { source: 'super_admin_manual_refund', event_id: input.eventId },
    ip: null,
    userAgent: null,
  })
}

// ─── writeOrderDelivered (Day 28 Phase 3) ────────────────────────────

export interface WriteOrderDeliveredInput {
  orderId: string
  tenantId: string
  eventId: string
  attendeeCount: number
  /** Locale the buyer + attendee emails were rendered in (en/bn). */
  locale: 'en' | 'bn'
}

/**
 * Delivery audit. Fires after buyer email + per-attendee emails
 * succeed (or dry-run succeeds). The diff captures count + locale
 * for ops triage; no PII (recipient addresses live on the orders +
 * attendees rows; SES message-ids live on the order_events marker).
 */
export async function writeOrderDelivered(tx: Tx, input: WriteOrderDeliveredInput): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: input.tenantId,
    actorType: 'system',
    actorId: null,
    action: 'order.delivery_sent',
    entityType: 'order',
    entityId: input.orderId,
    diff: {
      attendee_count: input.attendeeCount,
      emails_sent: input.attendeeCount + 1, // +1 for buyer summary
      locale: input.locale,
    },
    metadata: { source: 'delivery_worker', event_id: input.eventId },
    ip: null,
    userAgent: null,
  })
}
