/**
 * Order settlement service — Sprint 3 Day 27 Phase 2.
 *
 * The service-layer consumer of the Day-27 Phase-1 pure state
 * machine + the Day-26 Phase-1 verifyOrder real-HTTP wrapper.
 * Settles an order to its EPS-determined terminal status (paid /
 * failed / cancelled) inside one withSuperAdmin transaction.
 *
 * **Verify-by-callback is the AUTHORITY (per the Day 27 brief +
 * §11.1 step 11):** the trigger source (webhook payload OR a
 * success-redirect browser landing) is only a NOTIFICATION. The
 * `merchant_transaction_id` is the only field this service consumes
 * from the trigger — and it is consumed only as a DB lookup key.
 *
 * The settlement decision flow:
 *
 *   1. Look up the order by `merchant_transaction_id`. Not found →
 *      `UNKNOWN_TRANSACTION` (caller decides whether to log + 200 OK
 *      ignored, or 404, etc.).
 *   2. **Idempotent fast-path:** if the order is already at a terminal
 *      settled status (`paid` / `failed` / `cancelled` / `completed` /
 *      `refunded` / `reversed`), return `'idempotent_noop'` WITHOUT
 *      calling EPS verify. Re-delivered webhooks / browser back-button
 *      hits for already-settled orders cost nothing.
 *   3. Call `verifyOrder()` against EPS — the AUTHORITATIVE status read.
 *      Per Day-26 verify-order.ts: not gated by STAGING_PAYMENT_BLOCK
 *      (Verify is read-only).
 *   4. Pipe the EPS response through `mapEpsStatusToOrderTransition`.
 *      `null` (pending / unknown) → `'verify_inconclusive'` no-op.
 *   5. Apply the state-machine `validateTransition(currentStatus,
 *      target)`. Invalid → `'invalid_transition'` (logged; usually a
 *      race condition with another callback path that already settled).
 *   6. Inside one withSuperAdmin transaction:
 *      - UPDATE orders set status=target, paid_at|cancelled_at, +
 *        EPS-side identifiers (epsTransactionId, epsPaymentMethod)
 *        when present, + epsVerifiedAt.
 *      - INSERT order_events row (`'order.<target>'` event_type;
 *        actorType='system'; payload includes source + verify status).
 *      - INSERT audit_logs row via `writeOrderSettled`.
 *
 * **Why withSuperAdmin (BYPASSRLS):** the trigger source has no
 * tenant session (the webhook is from EPS; the redirect-page handler
 * runs in the public browser context). Mirrors the Day-25 public
 * event read pattern + the Day-26 Phase-3 buyer-write decision
 * (`decisions.md` "Day 26 architectural choices" Choice B). The
 * service is the trust boundary — it sets tenant_id from the
 * looked-up order row, never from the trigger payload.
 *
 * **`order_events` is APPEND-ONLY** at the GRANT layer (`eventpulse_app`
 * has no UPDATE/DELETE on this table — verified Phase 0). The
 * service runs under withSuperAdmin (BYPASSRLS + retains grants per
 * the regulator-redaction-path invariant) so the INSERT works.
 *
 * **No-PII rule (§1.3 R5):** the settlement audit row carries
 * non-PII metadata only (order id, merchant_transaction_id,
 * eps_transaction_id, target status, eps verify status). Buyer
 * name/email/phone stay on the orders row, NOT in the audit trail.
 */

import { eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { orderEvents, orders } from '../../db/schema/index.js'
import {
  mapEpsStatusToOrderTransition,
  validateTransition,
  type OrderStatus,
} from '../../domain/order-state-machine.js'
import { isBkashFinancialEntity } from '../../infra/eps/bkash-financial-entity.js'
import { verifyOrder } from '../../infra/eps/client.js'
import { logger } from '../../lib/logger.js'
import { enqueueOrderDelivery } from '../../workers/delivery-queue.js'
import { writeOrderDisputed, writeOrderSettled } from '../audit/orders.js'

// ─── error / outcome types ──────────────────────────────────────────

export type SettlementSource = 'webhook' | 'redirect_success' | 'redirect_fail' | 'redirect_cancel'

/**
 * Discriminated-union result. Designed so every branch is a
 * distinguishable, non-throwing outcome the caller can map to an
 * HTTP response cleanly. Throwing is reserved for upstream-EPS
 * failures (network, malformed) that the caller bubbles to a 500
 * (or, for webhook callers, swallows + 200s to suppress EPS retries).
 */
export type SettlementResult =
  | { kind: 'settled'; orderId: string; previousStatus: OrderStatus; newStatus: OrderStatus }
  | { kind: 'idempotent_noop'; orderId: string; currentStatus: OrderStatus }
  | { kind: 'verify_inconclusive'; orderId: string; epsStatus: 'pending' | 'unknown' }
  | {
      kind: 'invalid_transition'
      orderId: string
      currentStatus: OrderStatus
      attemptedTarget: OrderStatus
      reason: string
    }
  | { kind: 'unknown_transaction'; merchantTransactionId: string }

export interface SettleOrderInput {
  merchantTransactionId: string
  source: SettlementSource
}

/**
 * Terminal SETTLED statuses — the idempotent fast-path short-circuits
 * on any of these. `completed` / `refunded` / `reversed` are
 * post-settlement statuses that should never need re-verification
 * either (a webhook arriving for a completed order is a no-op).
 */
const TERMINAL_SETTLED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'paid',
  'failed',
  'cancelled',
  'completed',
  'refunded',
  'reversed',
])

/**
 * Settle an order to its EPS-determined status. Pure orchestration
 * over the state machine + verifyOrder + DB writes. Always returns
 * a `SettlementResult`; throws ONLY on EPS-network/response errors
 * which the caller surfaces or swallows per route policy.
 */
export async function settleOrderFromEps(input: SettleOrderInput): Promise<SettlementResult> {
  // STEP 1 — look up order (under withSuperAdmin; public-trigger path).
  const orderRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        eventId: orders.eventId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.merchantTransactionId, input.merchantTransactionId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!orderRow) {
    logger.warn(
      { merchantTransactionId: input.merchantTransactionId, source: input.source },
      'order.settle.unknown_transaction',
    )
    return { kind: 'unknown_transaction', merchantTransactionId: input.merchantTransactionId }
  }

  const currentStatus = orderRow.status as OrderStatus

  // STEP 2 — idempotent fast-path. Re-delivered webhooks / back-button
  // browser landings for already-settled orders are no-op.
  if (TERMINAL_SETTLED_STATUSES.has(currentStatus)) {
    logger.info(
      {
        orderId: orderRow.id,
        currentStatus,
        merchantTransactionId: input.merchantTransactionId,
        source: input.source,
      },
      'order.settle.idempotent_noop',
    )
    return { kind: 'idempotent_noop', orderId: orderRow.id, currentStatus }
  }

  // STEP 3 — call verifyOrder against EPS. NOT block-guarded (Verify is
  // read-only). Errors propagate to the caller.
  const verifyResult = await verifyOrder({
    merchantTransactionId: input.merchantTransactionId,
  })

  // STEP 4 — map EPS canonical status to order target.
  const epsTarget = mapEpsStatusToOrderTransition(verifyResult.status)

  // STEP 4.5 — v1.0 single-method launch Verify-guard (Day 38 Phase 2
  // mechanism (d), per decisions.md 2026-05-31 "EPS fee-model structural
  // decision — Option 3 (single-method launch, bKash-only for v1.0)
  // CHOSEN"). When EPS Verify returns Success but the buyer used a
  // non-bKash payment method on EPS's hosted checkout page, divert the
  // transition target from 'paid' to 'disputed' — the platform refuses
  // to honor the order because the payment method violates the v1.0
  // single-method constraint. The buyer's money is in EPS's hands; ops
  // initiates a manual refund via the EPS merchant dashboard (V5 has no
  // public refund API per §11.4). The audit row + order_events row
  // both carry the verbatim FinancialEntity value so ops can see what
  // method the buyer actually used.
  //
  // Guard ONLY applies to the success path. EPS-reported failures or
  // cancellations route normally to 'failed' / 'cancelled' regardless
  // of FinancialEntity (those are EPS-side rejection paths).
  const financialEntity = pickStringField(verifyResult.raw, 'FinancialEntity') ?? null
  const isDisputed = epsTarget === 'paid' && !isBkashFinancialEntity(financialEntity)
  const target: OrderStatus | null = isDisputed ? 'disputed' : epsTarget

  if (target === null) {
    // EPS says pending or unknown. Don't transition; the webhook
    // re-delivery (or a manual retry) will reconcile later.
    logger.info(
      {
        orderId: orderRow.id,
        currentStatus,
        epsStatus: verifyResult.status,
        source: input.source,
      },
      'order.settle.verify_inconclusive',
    )
    return {
      kind: 'verify_inconclusive',
      orderId: orderRow.id,
      epsStatus: verifyResult.status as 'pending' | 'unknown',
    }
  }

  // STEP 5 — state-machine validation.
  const t = validateTransition(currentStatus, target)
  if (!t.valid) {
    logger.warn(
      {
        orderId: orderRow.id,
        currentStatus,
        attemptedTarget: target,
        reason: t.reason,
        source: input.source,
      },
      'order.settle.invalid_transition',
    )
    return {
      kind: 'invalid_transition',
      orderId: orderRow.id,
      currentStatus,
      attemptedTarget: target,
      reason: t.reason ?? 'unknown',
    }
  }

  // STEP 6 — apply transition in one tx.
  await withSuperAdmin(async (db) => {
    // Optional EPS-side identifiers from the verify response. They're
    // captured defensively — different EPS verify response shapes
    // surface these in different fields; presence is best-effort.
    const epsTransactionId = pickStringField(verifyResult.raw, 'EPSTransactionId')
    const epsPaymentMethod = pickStringField(verifyResult.raw, 'PaymentMethod')

    const updates: {
      status: OrderStatus
      epsVerifiedAt: Date
      epsTransactionId?: string
      epsPaymentMethod?: string
      paidAt?: Date
      cancelledAt?: Date
    } = {
      status: target,
      epsVerifiedAt: new Date(),
    }
    if (epsTransactionId) updates.epsTransactionId = epsTransactionId
    if (epsPaymentMethod) updates.epsPaymentMethod = epsPaymentMethod
    if (target === 'paid') updates.paidAt = new Date()
    if (target === 'cancelled') updates.cancelledAt = new Date()

    await db.update(orders).set(updates).where(eq(orders.id, orderRow.id))

    // order_events — append-only event-sourcing trail (§2.5). For
    // the v1.0 Verify-guard dispute path, the payload additionally
    // carries `financial_entity` (verbatim from EPS Verify) +
    // `dispute_reason` so the event trail tells the full story
    // without needing to join back to audit_logs.
    await db.insert(orderEvents).values({
      tenantId: orderRow.tenantId,
      orderId: orderRow.id,
      eventType: `order.${target}`,
      actorType: 'system',
      actorId: null,
      payload: {
        source: input.source,
        merchant_transaction_id: input.merchantTransactionId,
        eps_status: verifyResult.status,
        ...(epsTransactionId ? { eps_transaction_id: epsTransactionId } : {}),
        ...(epsPaymentMethod ? { eps_payment_method: epsPaymentMethod } : {}),
        ...(isDisputed
          ? {
              dispute_reason: 'non_bkash_method_at_verify',
              financial_entity: financialEntity,
            }
          : {}),
      },
    })

    // audit_logs — platform audit (§1.3 R8) via the one-per-domain
    // helpers. v1.0 single-method launch Verify-guard disputes route
    // through writeOrderDisputed (which captures dispute_reason +
    // financial_entity); regular settlements (paid / failed /
    // cancelled) route through writeOrderSettled.
    if (isDisputed) {
      await writeOrderDisputed(db, {
        orderId: orderRow.id,
        tenantId: orderRow.tenantId,
        eventId: orderRow.eventId,
        merchantTransactionId: input.merchantTransactionId,
        previousStatus: currentStatus,
        epsStatus: verifyResult.status,
        source: input.source,
        disputeReason: 'non_bkash_method_at_verify',
        financialEntity,
        ...(epsTransactionId ? { epsTransactionId } : {}),
      })
    } else {
      await writeOrderSettled(db, {
        orderId: orderRow.id,
        tenantId: orderRow.tenantId,
        eventId: orderRow.eventId,
        merchantTransactionId: input.merchantTransactionId,
        previousStatus: currentStatus,
        newStatus: target,
        epsStatus: verifyResult.status,
        source: input.source,
        ...(epsTransactionId ? { epsTransactionId } : {}),
      })
    }
  })

  logger.info(
    {
      orderId: orderRow.id,
      previousStatus: currentStatus,
      newStatus: target,
      epsStatus: verifyResult.status,
      source: input.source,
      ...(isDisputed
        ? {
            // v1.0 Verify-guard dispute — separate fields so log
            // aggregation can group + alert on the dispute cohort
            // distinct from regular settlements.
            disputeReason: 'non_bkash_method_at_verify',
            financialEntity,
          }
        : {}),
    },
    isDisputed ? 'order.settle.disputed_non_bkash' : 'order.settle.transitioned',
  )

  // Day 28 Phase 3 — enqueue post-paid delivery (PDF + email). NEVER
  // blocks settlement: `enqueueOrderDelivery` never throws, returns
  // `{enqueued: false}` on Redis-absent / Redis-error and logs. The
  // order stays paid regardless; ops can re-enqueue later. The
  // delivery worker's own idempotency guard (order.delivery_sent
  // marker) makes manual re-enqueue safe.
  if (target === 'paid') {
    await enqueueOrderDelivery({ orderId: orderRow.id })
  }

  return {
    kind: 'settled',
    orderId: orderRow.id,
    previousStatus: currentStatus,
    newStatus: target,
  }
}

function pickStringField(data: unknown, field: string): string | undefined {
  if (data == null || typeof data !== 'object') return undefined
  const value = (data as Record<string, unknown>)[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
