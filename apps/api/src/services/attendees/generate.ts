/**
 * Attendee row generation service — Sprint 3 Day 28 Phase 1.
 *
 * Fired on `order.paid` transition (Day 27 settle service's `kind:
 * 'settled', newStatus: 'paid'` branch). Creates one attendees row
 * per `(order_item × quantity)` with a unique QR token (per
 * qr-token.ts).
 *
 * ════════════════════════════════════════════════════════════════════
 * Why this is a SEPARATE service from `settle.ts` (and not inlined
 * in the settle service's paid branch):
 * ════════════════════════════════════════════════════════════════════
 *
 *   - **Settlement reliability MUST be independent of delivery.** A
 *     verified payment that succeeds settlement but fails attendee
 *     generation (e.g. transient DB blip) must still see status=paid.
 *     The settlement decision is authoritative; delivery is a
 *     downstream consequence that can be retried. The Phase 3 worker
 *     pattern enforces this separation: the settle service enqueues
 *     a delivery job; the worker invokes THIS service.
 *
 *   - **Idempotency is a first-class concern.** A re-delivered webhook
 *     or a manual retry must not double-write attendee rows. This
 *     service guards on the existence of an `order.attendees_generated`
 *     order_events row (append-only marker) and returns
 *     `'already_generated'` cleanly on re-invocation.
 *
 *   - **Same withSuperAdmin pattern as settle.ts.** No tenant session
 *     in the buyer-paid path. Route handler / worker is the trust
 *     boundary; service sets tenant_id from the looked-up order row.
 *
 * ════════════════════════════════════════════════════════════════════
 * MVP attendee name/email policy:
 * ════════════════════════════════════════════════════════════════════
 *
 *   - For MVP, all attendees on an order inherit `buyer_name` /
 *     `buyer_email` / `buyer_phone` from the orders row. The
 *     attendees row's `submission_data` is `{}` (empty).
 *   - When quantity > 1 for a tier, attendee_name is suffixed with
 *     " (Ticket N of M)" so the buyer can distinguish multi-ticket
 *     orders at check-in. Future form-builder work (Phase 2) lets
 *     organisers capture per-attendee details — at that point this
 *     service reads from `order_items.attendee_data` (a follow-up
 *     schema addition) and writes per-attendee names/emails.
 *
 * ════════════════════════════════════════════════════════════════════
 * QR token collision handling:
 * ════════════════════════════════════════════════════════════════════
 *
 * The DB UNIQUE constraint on `attendees.qr_code` is the hard
 * backstop. With 256 bits of entropy per token (per qr-token.ts),
 * collision probability is vanishingly small (birthday paradox:
 * ~10^38 tokens). A collision would surface as a Postgres unique
 * violation; the service deliberately does NOT swallow it — the tx
 * rolls back, the worker retries the job, the next attempt uses
 * fresh random tokens. This is the right pattern: a collision is
 * either a CSPRNG malfunction (worth surfacing) or a code bug
 * (worth surfacing).
 */

import { eq, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { attendees, orderEvents, orderItems, orders, ticketTiers } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'

import { writeAttendeesGenerated } from '../audit/attendees.js'
import { mintQrToken } from './qr-token.js'

// ─── outcome types ──────────────────────────────────────────────────

export type GenerateAttendeesResult =
  | {
      kind: 'generated'
      orderId: string
      attendeeIds: string[]
      /** QR tokens generated, in the same order as attendeeIds. Used by Phase 2 PDF generation. */
      qrTokens: string[]
    }
  | {
      kind: 'already_generated'
      orderId: string
      /** Existing attendee IDs (queried back so the caller can drive PDF/email regen if needed). */
      attendeeIds: string[]
    }
  | {
      kind: 'order_not_found'
      orderId: string
    }
  | {
      kind: 'order_not_paid'
      orderId: string
      currentStatus: string
    }

export interface GenerateAttendeesInput {
  orderId: string
}

/**
 * Marker event_type stored in `order_events` to record that attendee
 * rows have been generated for this order. Used as the idempotency
 * guard — if a row with this type exists for the order, we skip.
 *
 * Append-only by design (order_events has REVOKE UPDATE/DELETE/
 * TRUNCATE from eventpulse_app per migration 0013); the marker can
 * never be cleared by application code, so the guard is durable.
 */
const ATTENDEES_GENERATED_EVENT_TYPE = 'order.attendees_generated'

/**
 * Sellable statuses that allow attendee generation. Only `paid`
 * orders should reach this service in the normal flow; the guard
 * defends against accidental invocation on pending/failed orders.
 *
 * `completed` is included because a fully-completed order (post-
 * event) might re-trigger a resend; attendee rows persist across
 * the paid → completed transition.
 */
const ATTENDEE_GENERATION_ELIGIBLE_STATUSES = new Set<string>(['paid', 'completed'])

/**
 * Generate one attendees row per (order_item × quantity) with unique
 * QR tokens. Idempotent — re-invoking for an already-generated order
 * returns `'already_generated'` with the existing attendee IDs.
 *
 * Throws ONLY on infrastructure failures (DB connection, CSPRNG
 * failure). Business outcomes are encoded in the discriminated union.
 */
export async function generateAttendeesForOrder(
  input: GenerateAttendeesInput,
): Promise<GenerateAttendeesResult> {
  // STEP 1 — look up order + verify eligibility (under withSuperAdmin;
  // mirrors settle.ts trust-boundary pattern).
  const orderRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        eventId: orders.eventId,
        status: orders.status,
        buyerName: orders.buyerName,
        buyerEmail: orders.buyerEmail,
        buyerPhone: orders.buyerPhone,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!orderRow) {
    logger.warn({ orderId: input.orderId }, 'attendees.generate.order_not_found')
    return { kind: 'order_not_found', orderId: input.orderId }
  }

  if (!ATTENDEE_GENERATION_ELIGIBLE_STATUSES.has(orderRow.status)) {
    logger.warn(
      { orderId: orderRow.id, currentStatus: orderRow.status },
      'attendees.generate.order_not_paid',
    )
    return { kind: 'order_not_paid', orderId: orderRow.id, currentStatus: orderRow.status }
  }

  // STEP 2 — idempotency check. The append-only marker is durable.
  const alreadyGenerated = await withSuperAdmin(async (db) => {
    const markerRows = await db
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(
        sql`${orderEvents.orderId} = ${orderRow.id} AND ${orderEvents.eventType} = ${ATTENDEES_GENERATED_EVENT_TYPE}`,
      )
      .limit(1)
    return markerRows.length > 0
  })

  if (alreadyGenerated) {
    const existingAttendees = await withSuperAdmin(async (db) => {
      const rows = await db
        .select({ id: attendees.id })
        .from(attendees)
        .where(eq(attendees.orderId, orderRow.id))
      return rows.map((r) => r.id)
    })
    logger.info(
      { orderId: orderRow.id, attendeeCount: existingAttendees.length },
      'attendees.generate.already_generated',
    )
    return {
      kind: 'already_generated',
      orderId: orderRow.id,
      attendeeIds: existingAttendees,
    }
  }

  // STEP 3 — load order_items + tier names (for per-attendee labelling).
  const itemRows = await withSuperAdmin(async (db) => {
    return db
      .select({
        orderItemId: orderItems.id,
        ticketTierId: orderItems.ticketTierId,
        quantity: orderItems.quantity,
        tierName: ticketTiers.name,
      })
      .from(orderItems)
      .innerJoin(ticketTiers, eq(orderItems.ticketTierId, ticketTiers.id))
      .where(eq(orderItems.orderId, orderRow.id))
  })

  if (itemRows.length === 0) {
    // Shouldn't happen — order_items FK + createOrder always writes
    // at least one — but defence in depth.
    logger.error({ orderId: orderRow.id }, 'attendees.generate.no_order_items')
    return { kind: 'order_not_found', orderId: orderRow.id }
  }

  // STEP 4 — generate attendee rows + marker + audit in a single tx.
  const tierBreakdown: Record<string, number> = {}
  const result = await withSuperAdmin(async (db) => {
    const insertedIds: string[] = []
    const insertedTokens: string[] = []

    for (const item of itemRows) {
      tierBreakdown[item.ticketTierId] = (tierBreakdown[item.ticketTierId] ?? 0) + item.quantity

      for (let n = 1; n <= item.quantity; n++) {
        const qrToken = mintQrToken()
        const attendeeName =
          item.quantity === 1
            ? orderRow.buyerName
            : `${orderRow.buyerName} (Ticket ${n} of ${item.quantity})`

        const [row] = await db
          .insert(attendees)
          .values({
            tenantId: orderRow.tenantId,
            orderId: orderRow.id,
            orderItemId: item.orderItemId,
            ticketTierId: item.ticketTierId,
            attendeeName,
            attendeeEmail: orderRow.buyerEmail,
            attendeePhone: orderRow.buyerPhone,
            qrCode: qrToken,
            // submission_data left default ({}) — form-builder data
            // capture lands Phase 2.
          })
          .returning({ id: attendees.id })

        insertedIds.push(row!.id)
        insertedTokens.push(qrToken)
      }
    }

    // Append-only marker — idempotency guard for re-invocations.
    await db.insert(orderEvents).values({
      tenantId: orderRow.tenantId,
      orderId: orderRow.id,
      eventType: ATTENDEES_GENERATED_EVENT_TYPE,
      actorType: 'system',
      actorId: null,
      payload: {
        attendee_count: insertedIds.length,
        tier_breakdown: tierBreakdown,
      },
    })

    // Audit row.
    await writeAttendeesGenerated(db, {
      orderId: orderRow.id,
      tenantId: orderRow.tenantId,
      eventId: orderRow.eventId,
      attendeeCount: insertedIds.length,
      tierBreakdown,
    })

    return { ids: insertedIds, tokens: insertedTokens }
  })

  logger.info(
    {
      orderId: orderRow.id,
      attendeeCount: result.ids.length,
      tierBreakdown,
    },
    'attendees.generate.generated',
  )

  return {
    kind: 'generated',
    orderId: orderRow.id,
    attendeeIds: result.ids,
    qrTokens: result.tokens,
  }
}
