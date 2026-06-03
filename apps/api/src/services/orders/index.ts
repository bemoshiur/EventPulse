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

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import {
  consentRecords,
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
import { resolveBuyerTermsCurrentVersion } from '../consent/buyer-terms.js'
import { getEffectiveFees } from '../fee-config/index.js'
import { enqueueOrderDelivery } from '../../workers/delivery-queue.js'
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

/**
 * Thrown when a tier's remaining capacity (`capacity - sold`) cannot
 * absorb the requested quantity, AFTER the FOR UPDATE lock has been
 * acquired. Day 29 Phase 2 — closes the oversell race left open by
 * the soft availability check.
 *
 * The route handler maps this to HTTP 409 with code `TIER_SOLD_OUT`
 * (per §6.3 canonical error code list).
 */
export class InsufficientCapacityError extends Error {
  public readonly tierId: string
  public readonly requested: number
  public readonly available: number
  constructor(tierId: string, requested: number, available: number) {
    super(`tier ${tierId} sold out — requested ${requested}, available ${available}`)
    this.name = 'InsufficientCapacityError'
    this.tierId = tierId
    this.requested = requested
    this.available = available
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
   *  DEFAULT_EPS_FEE_BPS_ESTIMATE (175 = 1.75%, bKash rate per the
   *  v1.0 single-method launch decision; see DEFAULT_EPS_FEE_BPS_ESTIMATE
   *  JSDoc below). Real reconciliation against EPS settlement reports
   *  lands Day 27+. */
  epsFeeBpsEstimate?: number
  /** Buyer-side metadata captured for audit + abuse triage. */
  ip?: string | null
  userAgent?: string | null
  utm?: Record<string, unknown> | null
}

/**
 * Result of order creation. `paymentInitState` distinguishes:
 *   - `'ready'`     — EPS init succeeded; `redirectUrl` non-null;
 *                     buyer can proceed to checkout. Order status:
 *                     `awaiting_payment`.
 *   - `'blocked'`   — STAGING_PAYMENT_BLOCK refused the init; order
 *                     persists in `awaiting_payment`; redirectUrl
 *                     is null. This is the documented Day 26 state
 *                     under the block — order pipeline works through
 *                     the init step; real init fires at truth-gate.
 */
export interface CreateOrderResult {
  orderId: string
  merchantTransactionId: string
  /**
   * Order status at return time. `awaiting_payment` for paid events
   * (buyer must complete EPS hosted checkout); `paid` for free events
   * (per §13.5 — born-paid, no EPS call, delivery enqueued
   * immediately).
   */
  status: 'awaiting_payment' | 'paid'
  /**
   * Discriminator for what happened on the payment-init step:
   *   - `'ready'`   — paid event, EPS init succeeded
   *   - `'blocked'` — paid event, STAGING_PAYMENT_BLOCK refused init
   *   - `'free'`    — free event (every tier price_paisa = 0n);
   *                   bypassed EPS entirely per §13.5; order born
   *                   `paid`; delivery enqueued in same flow
   */
  paymentInitState: 'ready' | 'blocked' | 'free'
  redirectUrl: string | null
  /** The full calculator snapshot — useful for receipt rendering + tests. */
  fees: FeeCalcResult
}

/**
 * Default EPS fee bps used when caller doesn't supply one. **175 = 1.75%,
 * which is the bKash MFS rate per the v1.0 single-method launch decision**
 * (see `.claude/memory/decisions.md` "EPS fee-model structural decision —
 * Option 3 (single-method launch, bKash-only for v1.0) CHOSEN" dated
 * 2026-05-31). The empirical truth-gate observation was BDT 17.47 EPS fee
 * on a BDT 1,000 face = 1.747% on face — rounded to 175 bps (1.75%).
 *
 * Under Option 3, the EPS hosted checkout is restricted to bKash; every
 * paid order at launch flows through bKash; this single rate is the
 * actual rate for every transaction. Calculator prediction matches
 * reality (within 7-paisa floor-rounding) on every order.
 *
 * Important — bps is applied to the CAPTURE BASE (subtotal + platform_fee
 * if pass-through), not to face value, per §14.2 Mode D footnote. The
 * 1.747% empirical observation was on face (BDT 17.47 / BDT 1,000); on a
 * capture base of BDT 1,002.50 (subtotal + 0.25% platform PT), the actual
 * EPS rate is closer to 174.27 bps. 175 bps applied here produces
 * BDT 17.54 (7 paisa over the BDT 17.47 observation) — the rounding cost
 * of single-bps modelling. The 7-paisa delta is invisible at BDT 1,000
 * face and absorbed into the integer-paisa floor; never round-trips back
 * to the buyer.
 *
 * Card / Nagad / Rocket / Upay / bank-transfer rates are NOT modelled
 * at v1.0 — those methods are restricted at the EPS init step (Phase 2
 * of Day 38 implementation). Card support is the immediate post-launch
 * roadmap item (week 1) per decisions.md 2026-05-31 Option 3 entry's
 * implication (d); each new method requires its own production
 * rate-confirmation smoke before going live, same discipline as v1.0
 * bKash.
 *
 * Previous value: 250 bps (2.5%, card-rate estimate). Historical 250
 * preserved in git history; the §14.2 worked-example tests at 250 bps
 * remain in fee-calculator.test.ts as spec-archaeology (they pin the
 * §14.2 narrative math, not the runtime default).
 */
export const DEFAULT_EPS_FEE_BPS_ESTIMATE = 175

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
  // Day 29 Phase 2 adds the FOR UPDATE capacity lock INSIDE this tx,
  // before any inserts. See the long comment inside.
  const orderId = await withSuperAdmin(async (db) => {
    // ════════════════════════════════════════════════════════════════
    // FOR UPDATE capacity lock — Day 29 Phase 2.
    // ════════════════════════════════════════════════════════════════
    //
    // Closes the oversell race that the soft availability check from
    // Day 26 left open. Without this lock, N concurrent buyers can
    // all read sold=K, all compute K+q <= capacity, all insert their
    // orders, and the tier silently oversells.
    //
    // The SELECT ... FOR UPDATE acquires a row-level write lock on
    // each ticket_tiers row in the order; the lock holds until this
    // tx commits or rolls back. Concurrent buyers on the same tier
    // wait at the SELECT FOR UPDATE; they see the updated sold count
    // when their lock acquires and can accept-or-reject based on
    // fresh state.
    //
    // **Deadlock avoidance — ORDER BY id.** When a buyer purchases
    // multiple tiers in one order, we lock them ALL in a single
    // SELECT. Postgres acquires locks in scan order. If two orders
    // touch overlapping tier sets but in DIFFERENT orders, classic
    // deadlock: A holds tier X waiting for tier Y; B holds Y waiting
    // for X. ORDER BY id makes the scan order consistent — both
    // orders acquire locks in the same id order, so the second blocks
    // on the FIRST's lock and waits cleanly instead of dead-locking.
    //
    // **Lock scope — minimal.** Row-level FOR UPDATE on ticket_tiers
    // only. The orders / order_items / order_events INSERTs that
    // follow don't take row locks (the rows don't exist yet); they
    // do take normal MVCC write locks on their own new rows, but no
    // contention with concurrent buyers on other orders.
    //
    // **Why not SELECT FOR NO KEY UPDATE.** §9.3 ticket_tiers has FK
    // references (events, tenants) but no incoming FK references
    // pointing AT it that would benefit from the weaker lock. FOR
    // UPDATE is the simpler choice with no observable cost.
    //
    // **Pinned by test** `db-gated-oversell-race` (Phase 2 test
    // file): N concurrent buyers racing for M < N tickets — exactly
    // M succeed, N-M get InsufficientCapacityError; sold NEVER
    // exceeds capacity. The test runs the racers via Promise.all
    // against a real Postgres so the lock semantics are exercised.
    //
    // **Note on decrement.** Phase 2 increments sold at order-create
    // time. Decrement on cancellation / failure / chargeback is NOT
    // in Day 29 scope (handoff documents this as a future cleanup
    // sweep + Day 30+ work). Abandoned `awaiting_payment` orders
    // permanently consume capacity until a future timeout sweep
    // OR a manual super-admin void. Acceptable for MVP given the
    // EPS hosted-page checkout speed (sub-minute typical) + the
    // Decision N truth-gate test set (4 small transactions).
    const tierIdsAsc = input.tierSelections.map((s) => s.tierId)
    const lockedRows = await db
      .select({
        id: ticketTiers.id,
        sold: ticketTiers.sold,
        capacity: ticketTiers.capacity,
      })
      .from(ticketTiers)
      .where(inArray(ticketTiers.id, tierIdsAsc))
      .orderBy(asc(ticketTiers.id))
      .for('update')

    const lockedById = new Map<string, { sold: number; capacity: number }>()
    for (const row of lockedRows) {
      lockedById.set(row.id, { sold: row.sold, capacity: row.capacity })
    }

    // Capacity check against locked rows. The order of selections
    // matters for the error: the first tier that fails is reported.
    for (const sel of input.tierSelections) {
      const locked = lockedById.get(sel.tierId)
      if (!locked) {
        // Shouldn't happen — earlier resolve step verified tier
        // existence — but defence in depth.
        throw new TierNotFoundError(sel.tierId)
      }
      const available = locked.capacity - locked.sold
      if (sel.quantity > available) {
        throw new InsufficientCapacityError(sel.tierId, sel.quantity, available)
      }
    }

    // Increment sold per tier. Each UPDATE runs against a row we
    // already hold the FOR UPDATE lock on, so no contention.
    for (const sel of input.tierSelections) {
      await db
        .update(ticketTiers)
        .set({ sold: sql`${ticketTiers.sold} + ${sel.quantity}` })
        .where(eq(ticketTiers.id, sel.tierId))
    }

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

    // Day 30 Phase 1a — §13.5 free-event auto-settle.
    //
    // Per §13.5: "Events where every ticket tier has price_paisa = 0
    // → No payment integration (no EPS call, no order in
    // awaiting_payment state). Order goes pending → paid immediately
    // on form submission (paid for 0 paisa = paid)."
    //
    // Implementation: when the calculator's buyer total is 0n (every
    // tier in the selection is free), we (a) flip the just-inserted
    // order's status from `awaiting_payment` to `paid` inside the
    // SAME tx + (b) write the `order.paid` event-sourcing row with
    // source='free_event_auto_settle'. STEP 7 below SKIPS the EPS
    // init for these orders + enqueues delivery directly.
    //
    // The orders row started life with status='awaiting_payment'
    // (the calculator runs against the same data path for paid
    // events, per §13.5: "the fee calculator is called regardless
    // — never branch on is-this-free? elsewhere"); we transition it
    // to paid in this tx rather than INSERT it as paid because the
    // §14.4 fee-snapshot invariants are easier to keep symmetric
    // with the paid path that always starts in awaiting_payment.
    if (calc.buyerTotalPaisa === 0n) {
      await db.update(orders).set({ status: 'paid', paidAt: new Date() }).where(eq(orders.id, oid))

      await db.insert(orderEvents).values({
        tenantId: event.tenantId,
        orderId: oid,
        eventType: 'order.paid',
        actorType: 'system',
        actorId: null,
        payload: {
          merchant_transaction_id: merchantTransactionId,
          source: 'free_event_auto_settle',
          total_paisa: '0',
        },
      })
    }

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

    // ────────────────────────────────────────────────────────────────
    // Day 39 Phase 2 — consent_records anchor to Buyer Terms v1.0.
    // ────────────────────────────────────────────────────────────────
    //
    // Operator-spec'd precondition semantics ("consent capture is a
    // precondition, not a side effect"): the INSERT lives INSIDE this
    // tx so failure modes are:
    //
    //   - resolveBuyerTermsCurrentVersion throws (e.g. seed not run,
    //     currentVersionId NULL) → tx rolls back → orders row never
    //     persists → STEP 7 EPS init below never fires.
    //   - consent_records INSERT throws (e.g. FK constraint, RLS, DB
    //     hiccup) → same rollback chain → no order, no EPS.
    //   - tx commits successfully but STEP 7 EPS init fails → order
    //     persists in awaiting_payment WITH consent captured (correct
    //     — consent IS captured pre-EPS).
    //
    // Both free and paid events get a consent row: the document covers
    // ALL platform usage (data processing, platform's limited role,
    // liability), not just payment. The bilingual clickwrap line on
    // the buyer form varies by button label ("Continue with bKash" vs.
    // "Confirm registration") but the consent semantics are identical.
    //
    // Anchor: order_id (the new column on consent_records — guest
    // buyers have no user_id at checkout). tenant_id is denormalised
    // for compliance-dashboard queries.
    const buyerTermsRef = await resolveBuyerTermsCurrentVersion(db)
    await db.insert(consentRecords).values({
      userId: null,
      orderId: oid,
      tenantId: event.tenantId,
      documentId: buyerTermsRef.documentId,
      versionId: buyerTermsRef.versionId,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })

    return oid
  })

  // STEP 7 — EPS init OR free-event auto-settle delivery.
  //
  // Day 30 Phase 1a: §13.5 free-event branch SKIPS EPS entirely +
  // enqueues delivery directly. The tx already transitioned the
  // order to `paid` (born-paid for free events); now we kick the
  // post-paid delivery pipeline the same way the Day 27 settle
  // service does for paid events. enqueueOrderDelivery never throws
  // (Day 28 settlement reliability invariant) — a Redis blip leaves
  // the order paid + delivery deferrable.
  if (calc.buyerTotalPaisa === 0n) {
    await enqueueOrderDelivery({ orderId })
    logger.info({ orderId, merchantTransactionId }, 'order.created.free_event_auto_settled')
    return {
      orderId,
      merchantTransactionId,
      status: 'paid',
      paymentInitState: 'free',
      redirectUrl: null,
      fees: calc,
    }
  }

  // STEP 7 — EPS init (outside the tx; block-guard fires first if on).
  try {
    const initResult = await initialiseOrder({
      merchantTransactionId,
      totalPaisa: calc.buyerTotalPaisa,
      // Thread the real buyer so EPS records + receipts carry them (the wire
      // protocol falls back to placeholders for any blank field). PII stays in
      // the request body only — never logged (§1.3 R5).
      buyer: {
        name: input.buyer.name,
        email: input.buyer.email,
        phone: input.buyer.phone,
      },
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
