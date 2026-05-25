/**
 * Public order creation service — Sprint 3 Day 26 Phase 4.
 *
 * The MONEY ENDPOINT's service layer. Every paisa amount on the
 * order row originates from the fee-calculator at
 * `apps/api/src/domain/payments/fee-calculator.ts` (§14.3 single
 * source of truth). NO fee arithmetic anywhere in this file —
 * `/review` greps for it.
 *
 * **Flow:**
 *
 *   1. Resolve event → tenant_id, validate event is in a sellable
 *      state (per §2.4), validate event not soft-deleted.
 *   2. Resolve ticket tiers → exist + on-sale window + not archived;
 *      compute subtotal as Σ(unit_price × quantity). (Soft check; the
 *      hard FOR UPDATE capacity lock is Day 29 — this layer does NOT
 *      decrement sold counts.)
 *   3. `getEffectiveFees(tenantId)` → platform_fee_bps (Day-23 single
 *      source).
 *   4. `calculateOrderFees(...)` → snapshot the result into the
 *      orders row VERBATIM. The 4 fee-snapshot extension columns
 *      (platform_fee_bps, eps_fee_bps, platform_fee_handling,
 *      eps_fee_handling) are written alongside the paisa fields so
 *      post-mortem reconciliation has the inputs the calculator was
 *      fed (per §14.4 + Decision N).
 *   5. Mint `merchantTransactionId` per §11.4 conventions.
 *   6. INSERT orders + order_items + order_events (audit-of-order) +
 *      audit_logs (platform audit) in a single `withSuperAdmin` tx.
 *      Use `withSuperAdmin` because the buyer has no tenant session
 *      (§4.3 RLS — the public path is the documented exception per
 *      decisions.md "Public event reads use withSuperAdmin" pattern;
 *      mirrored here for the WRITE path).
 *   7. Call `eps.initialiseOrder()`. The STAGING_PAYMENT_BLOCK guard
 *      throws `StagingPaymentBlockedError` BEFORE any HTTP fires
 *      (Day 26 Phase 1 invariant). Catch it and return a structured
 *      response indicating "order created but payment-init blocked"
 *      — order persists in `awaiting_payment`. The real init fires
 *      at truth-gate time.
 *
 * **What this file does NOT do (deferred):**
 *   - FOR UPDATE capacity lock on ticket_tiers (Day 29)
 *   - Idempotency middleware integration (Day 29 — column is in
 *     the schema, middleware reads it, but service doesn't enforce)
 *   - QR code generation per attendee (Day 28)
 *   - Email + PDF delivery (Day 28)
 *   - EPS callback / Verify reconciliation (Day 27)
 *
 * **Money-truth invariants pinned in tests:**
 *   - For every §14.2 mode, the orders row's snapshot fields equal
 *     the calculator's `FeeCalcResult` field-for-field.
 *   - The platform_fee_bps + eps_fee_bps + handling fields are
 *     snapshotted from cfg / input — NOT re-derived after.
 *   - The block path persists the order; the EPS-init failure is
 *     orthogonal to order persistence.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import {
  events,
  orderEvents,
  orderItems,
  orders,
  tenants,
  ticketTiers,
} from '../../db/schema/index.js'
import {
  calculateOrderFees,
  type FeeCalcResult,
  type FeeHandling,
} from '../../domain/payments/fee-calculator.js'
import { initialiseOrder, StagingPaymentBlockedError } from '../../infra/eps/client.js'
import { logger } from '../../lib/logger.js'
import { writeOrderCreated } from '../audit/orders.js'
import { getEffectiveFees } from '../fee-config/index.js'
import { mintMerchantTransactionId } from './order-id.js'

// ─── error types ────────────────────────────────────────────────────

export class EventNotFoundError extends Error {
  constructor() {
    super('event not found')
    this.name = 'EventNotFoundError'
  }
}

export class EventNotSellableError extends Error {
  public readonly status: string
  constructor(status: string) {
    super(`event is not in a sellable state (current: ${status})`)
    this.name = 'EventNotSellableError'
    this.status = status
  }
}

export class TierNotFoundError extends Error {
  public readonly tierId: string
  constructor(tierId: string) {
    super(`ticket tier not found or not in this event: ${tierId}`)
    this.name = 'TierNotFoundError'
    this.tierId = tierId
  }
}

export class TierNotOnSaleError extends Error {
  public readonly tierId: string
  public readonly reason: string
  constructor(tierId: string, reason: string) {
    super(`ticket tier ${tierId} is not on sale: ${reason}`)
    this.name = 'TierNotOnSaleError'
    this.tierId = tierId
    this.reason = reason
  }
}

// ─── input/output shapes ────────────────────────────────────────────

export interface OrderTierSelection {
  /** ticket_tiers.id */
  tierId: string
  /** quantity (must be >= 1; service enforces min/max per tier) */
  quantity: number
}

export interface OrderBuyerInfo {
  name: string
  email: string
  phone: string
  /** Optional NID last-4 — captured if provided; never stored full. */
  nidLast4?: string | null
}

export interface CreateOrderInput {
  eventId: string
  tierSelections: OrderTierSelection[]
  buyer: OrderBuyerInfo
  /** Optional idempotency key (Day 29 middleware reads at request layer). */
  idempotencyKey?: string | null
  /** Optional EPS-fee bps override at order time — defaults to
   *  DEFAULT_EPS_FEE_BPS_ESTIMATE (250 = 2.5%, card-rate estimate).
   *  Real reconciliation against EPS settlement reports lands Day 27+. */
  epsFeeBpsEstimate?: number
  /** Buyer-side metadata captured for audit + abuse triage. */
  ip?: string | null
  userAgent?: string | null
  utm?: Record<string, unknown> | null
}

/**
 * Result of order creation. `paymentInitState` distinguishes:
 *   - `'ready'`     — EPS init succeeded; `redirectUrl` non-null;
 *                     buyer can proceed to checkout.
 *   - `'blocked'`   — STAGING_PAYMENT_BLOCK refused the init; order
 *                     persists in `awaiting_payment`; redirectUrl
 *                     is null. This is the documented Day 26 state
 *                     under the block — order pipeline works through
 *                     the init step; real init fires at truth-gate.
 */
export interface CreateOrderResult {
  orderId: string
  merchantTransactionId: string
  status: 'awaiting_payment'
  paymentInitState: 'ready' | 'blocked'
  redirectUrl: string | null
  /** The full calculator snapshot — useful for receipt rendering + tests. */
  fees: FeeCalcResult
}

/**
 * Default EPS fee bps used when caller doesn't supply one. 250 =
 * 2.5% which matches the §14.2 worked examples + card-rate estimate.
 * Buyer hasn't chosen a payment method yet at order-create time
 * (the method picker is on EPS's hosted page); the real fee comes in
 * the settlement report Day 27+.
 */
export const DEFAULT_EPS_FEE_BPS_ESTIMATE = 250

/**
 * Sellable event statuses per §2.4 event lifecycle. Only events in
 * one of these states accept new orders.
 *
 * - 'published' / 'on_sale' / 'live' — all accept orders
 * - 'sold_out' — does NOT accept (full)
 * - 'draft' / 'completed' / 'archived' — do NOT accept (wrong phase)
 */
const SELLABLE_STATUSES = ['published', 'on_sale', 'live'] as const

// ─── createOrder ────────────────────────────────────────────────────

/**
 * Public buyer order-creation service. Returns
 * `CreateOrderResult`. Throws typed errors for validation failures;
 * EPS errors are mapped to `paymentInitState`.
 *
 * The single tx wraps DB writes only; the EPS init call runs AFTER
 * the tx commits because EPS is external. Rationale: if EPS init
 * fails (e.g. network), the order row persists (recoverable) — the
 * alternative (rollback on EPS failure) loses the order in a retry-
 * unfriendly way.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (input.tierSelections.length === 0) {
    throw new RangeError('tierSelections must not be empty')
  }
  for (const s of input.tierSelections) {
    if (s.quantity < 1) {
      throw new RangeError(`tier ${s.tierId} quantity must be >= 1`)
    }
  }

  // STEP 1+2 — resolve event + tiers under withSuperAdmin (public path).
  const resolved = await withSuperAdmin(async (db) => {
    // Event lookup (excludes soft-deleted).
    const eventRows = await db
      .select({
        id: events.id,
        tenantId: events.tenantId,
        status: events.status,
        platformFeeHandling: events.platformFeeHandling,
        epsFeeHandling: events.epsFeeHandling,
      })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1)

    if (eventRows.length === 0) {
      throw new EventNotFoundError()
    }
    const event = eventRows[0]!

    if (!(SELLABLE_STATUSES as readonly string[]).includes(event.status)) {
      throw new EventNotSellableError(event.status)
    }

    // Tier lookups (one batch).
    const tierIds = input.tierSelections.map((s) => s.tierId)
    const tierRows = await db
      .select({
        id: ticketTiers.id,
        tenantId: ticketTiers.tenantId,
        eventId: ticketTiers.eventId,
        pricePaisa: ticketTiers.pricePaisa,
        salesStartAt: ticketTiers.salesStartAt,
        salesEndAt: ticketTiers.salesEndAt,
        minPerOrder: ticketTiers.minPerOrder,
        maxPerOrder: ticketTiers.maxPerOrder,
        archivedAt: ticketTiers.archivedAt,
      })
      .from(ticketTiers)
      .where(and(eq(ticketTiers.eventId, event.id), inArray(ticketTiers.id, tierIds)))

    const tierMap = new Map(tierRows.map((t) => [t.id, t]))
    for (const sel of input.tierSelections) {
      const tier = tierMap.get(sel.tierId)
      if (!tier) throw new TierNotFoundError(sel.tierId)
      if (tier.archivedAt) throw new TierNotOnSaleError(sel.tierId, 'tier_archived')
      const now = new Date()
      if (tier.salesStartAt && tier.salesStartAt > now)
        throw new TierNotOnSaleError(sel.tierId, 'sales_not_open')
      if (tier.salesEndAt && tier.salesEndAt <= now)
        throw new TierNotOnSaleError(sel.tierId, 'sales_closed')
      if (sel.quantity < tier.minPerOrder)
        throw new TierNotOnSaleError(sel.tierId, `below min_per_order=${tier.minPerOrder}`)
      if (sel.quantity > tier.maxPerOrder)
        throw new TierNotOnSaleError(sel.tierId, `above max_per_order=${tier.maxPerOrder}`)
    }

    // Tenant slug for mintMerchantTransactionId.
    const tenantRows = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, event.tenantId))
      .limit(1)
    if (tenantRows.length === 0) {
      // Shouldn't happen — events FK to tenants — but defence in depth.
      throw new EventNotFoundError()
    }

    return { event, tierRows, tierMap, tenantSlug: tenantRows[0]!.slug }
  })

  // STEP 3 — fee config + STEP 4 — calculator (NO arithmetic here).
  const { event, tierMap, tenantSlug } = resolved
  const subtotalPaisa = input.tierSelections.reduce((acc, sel) => {
    const tier = tierMap.get(sel.tierId)!
    return acc + tier.pricePaisa * BigInt(sel.quantity)
  }, 0n)

  const fees = await getEffectiveFees(event.tenantId)
  const epsFeeBps = input.epsFeeBpsEstimate ?? DEFAULT_EPS_FEE_BPS_ESTIMATE
  const calc = calculateOrderFees({
    ticketSubtotalPaisa: subtotalPaisa,
    platformFeeBps: fees.platformFeeBps,
    epsFeeBps,
    platformFeeHandling: event.platformFeeHandling as FeeHandling,
    epsFeeHandling: event.epsFeeHandling as FeeHandling,
  })

  // STEP 5 — mint merchantTransactionId.
  const merchantTransactionId = mintMerchantTransactionId(tenantSlug)

  // STEP 6 — INSERT under withSuperAdmin (single tx for atomicity).
  const orderId = await withSuperAdmin(async (db) => {
    const [orderRow] = await db
      .insert(orders)
      .values({
        tenantId: event.tenantId,
        eventId: event.id,
        merchantTransactionId,
        buyerName: input.buyer.name,
        buyerEmail: input.buyer.email,
        buyerPhone: input.buyer.phone,
        buyerNidLast4: input.buyer.nidLast4 ?? null,
        // Money — verbatim from calculator output, no arithmetic.
        subtotalPaisa: calc.subtotalPaisa,
        epsFeePaisa: calc.epsFeePaisa,
        platformFeePaisa: calc.platformFeePaisa,
        totalPaisa: calc.buyerTotalPaisa,
        netToOrganiserPaisa: calc.organiserNetPaisa,
        // Fee-snapshot extension columns (§14.4).
        platformFeeBps: fees.platformFeeBps,
        epsFeeBps,
        platformFeeHandling: event.platformFeeHandling,
        epsFeeHandling: event.epsFeeHandling,
        status: 'awaiting_payment',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        utm: input.utm ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning({ id: orders.id })
    const oid = orderRow!.id

    // order_items — one row per tier selection.
    for (const sel of input.tierSelections) {
      const tier = tierMap.get(sel.tierId)!
      const unit = tier.pricePaisa
      const sub = unit * BigInt(sel.quantity)
      await db.insert(orderItems).values({
        tenantId: event.tenantId,
        orderId: oid,
        ticketTierId: sel.tierId,
        quantity: sel.quantity,
        unitPricePaisa: unit,
        subtotalPaisa: sub,
      })
    }

    // order_events — event-sourcing trail (§2.5).
    await db.insert(orderEvents).values({
      tenantId: event.tenantId,
      orderId: oid,
      eventType: 'order.created',
      actorType: 'system',
      actorId: null,
      payload: { merchant_transaction_id: merchantTransactionId, source: 'public_buyer_route' },
    })

    // audit_logs — platform-wide audit (§1.3 R8).
    await writeOrderCreated(db, {
      orderId: oid,
      tenantId: event.tenantId,
      eventId: event.id,
      merchantTransactionId,
      subtotalPaisa: calc.subtotalPaisa,
      platformFeePaisa: calc.platformFeePaisa,
      epsFeePaisa: calc.epsFeePaisa,
      totalPaisa: calc.buyerTotalPaisa,
      netToOrganiserPaisa: calc.organiserNetPaisa,
      platformFeeBps: fees.platformFeeBps,
      epsFeeBps,
      platformFeeHandling: event.platformFeeHandling as 'absorb' | 'pass_through',
      epsFeeHandling: event.epsFeeHandling as 'absorb' | 'pass_through',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    return oid
  })

  // STEP 7 — EPS init (outside the tx; block-guard fires first if on).
  try {
    const initResult = await initialiseOrder({
      merchantTransactionId,
      totalPaisa: calc.buyerTotalPaisa,
    })
    return {
      orderId,
      merchantTransactionId,
      status: 'awaiting_payment',
      paymentInitState: 'ready',
      redirectUrl: initResult.redirectUrl,
      fees: calc,
    }
  } catch (err) {
    if (err instanceof StagingPaymentBlockedError) {
      logger.info(
        {
          orderId,
          merchantTransactionId,
          totalPaisa: calc.buyerTotalPaisa.toString(),
        },
        'order.created.payment_init_blocked',
      )
      return {
        orderId,
        merchantTransactionId,
        status: 'awaiting_payment',
        paymentInitState: 'blocked',
        redirectUrl: null,
        fees: calc,
      }
    }
    // Any other EPS error (network, schema, 4xx, 5xx) → bubble up.
    // The order is persisted; the caller surfaces a 502 EPS error
    // through the route handler and the buyer can retry the init
    // by re-submitting the form (idempotency middleware Day 29 dedupes).
    throw err
  }
}
