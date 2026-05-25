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
