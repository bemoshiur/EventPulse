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
