/**
 * Order delivery service — Sprint 3 Day 28 Phase 3.
 *
 * The orchestration layer the BullMQ delivery worker calls. End-to-
 * end post-paid delivery:
 *
 *   1. Load order + event + tenant + venue (read-only, under
 *      withSuperAdmin — same trust-boundary pattern as settle.ts).
 *   2. Generate attendee rows + QR tokens via
 *      `generateAttendeesForOrder()` (Phase 1; idempotent).
 *   3. Render one PDF per attendee via `renderTicketPdf()` (Phase 2).
 *   4. Send the buyer `order_confirmed` email (no attachment).
 *   5. Send each attendee `attendee_ticket` email (PDF attached).
 *   6. Write `order.delivery_sent` append-only marker + audit row.
 *
 * ════════════════════════════════════════════════════════════════════
 * Idempotency — guard against re-delivery
 * ════════════════════════════════════════════════════════════════════
 *
 * The `order.delivery_sent` event_type marker in order_events is the
 * durable guard. If a row with this event_type exists for the order,
 * the function returns `'already_delivered'` cleanly — no PDFs
 * regenerated, no emails resent.
 *
 * Two markers fire in sequence:
 *   - `order.attendees_generated` (Phase 1) — attendee rows + QR exist
 *   - `order.delivery_sent` (here) — emails dispatched (or dry-run logged)
 *
 * Why two markers (not one): attendee rows must exist BEFORE delivery
 * can start, but delivery might fail (SES throttle, etc.) while
 * attendee rows succeeded. With two markers the worker can retry the
 * delivery half without re-generating attendees.
 *
 * ════════════════════════════════════════════════════════════════════
 * Failure semantics — settlement reliability is non-negotiable
 * ════════════════════════════════════════════════════════════════════
 *
 *   - A delivery failure does NOT roll back the order's paid status.
 *     The settle service (Day 27) commits paid status independently;
 *     delivery is a downstream consequence.
 *   - If ANY email send fails:
 *       - The function throws so BullMQ retries with exponential
 *         backoff (configured in delivery-worker.ts).
 *       - The `order.delivery_sent` marker is NOT written, so the
 *         next attempt re-runs delivery cleanly.
 *       - Partial-send risk: if buyer email succeeds + attendee 2 of
 *         3 fails, the next retry will send buyer email AGAIN +
 *         attendee 1 AGAIN. This is documented as the tradeoff for
 *         not needing per-recipient idempotency tracking. For MVP
 *         scale this is acceptable; future improvement: per-recipient
 *         markers (e.g. `attendee.<id>.delivery_sent`).
 *   - If max retries exhausted, BullMQ moves the job to the DLQ;
 *     operator inspects + re-runs manually.
 *
 * ════════════════════════════════════════════════════════════════════
 * SES sandbox / MAIL_DRY_RUN — testing without real sends
 * ════════════════════════════════════════════════════════════════════
 *
 * The SES client + raw-email module honour MAIL_DRY_RUN=1 (Day 21
 * convention). In staging where SES is in sandbox, MAIL_DRY_RUN can
 * be either 1 (no AWS call at all) or 0 (real call; recipients must
 * be SES-verified). Either way, delivery LOGIC executes end-to-end
 * — the service doesn't know it's a dry-run.
 */

import { eq, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import {
  attendees,
  events,
  notificationLog,
  orderEvents,
  orders,
  tenants,
  ticketTiers,
} from '../../db/schema/index.js'
import { renderAttendeeTicket } from '../../infra/ses/templates/attendee-ticket.js'
import { renderOrderConfirmed } from '../../infra/ses/templates/order-confirmed.js'
import { sendEmailRaw } from '../../infra/ses/raw-email.js'
import { logger } from '../../lib/logger.js'

import { writeOrderDelivered } from '../audit/orders.js'
import { selectLocale } from '../notifications/locale.js'
import {
  buildEmailNotificationRows,
  type SentEmailRecord,
} from '../notifications/notification-log.js'

import { generateAttendeesForOrder } from '../attendees/generate.js'
import { renderTicketPdf } from './render-ticket-pdf.js'

// ─── outcome types ──────────────────────────────────────────────────

export type DeliverOrderResult =
  | {
      kind: 'delivered'
      orderId: string
      attendeeCount: number
      emailsSent: number
      buyerMessageId: string
      attendeeMessageIds: string[]
    }
  | {
      kind: 'already_delivered'
      orderId: string
    }
  | {
      kind: 'order_not_found'
      orderId: string
    }
  | {
      kind: 'order_not_eligible'
      orderId: string
      currentStatus: string
    }

export interface DeliverOrderInput {
  orderId: string
}

const DELIVERY_SENT_EVENT_TYPE = 'order.delivery_sent'

/**
 * Statuses eligible for delivery. Mirrors
 * ATTENDEE_GENERATION_ELIGIBLE_STATUSES from generate.ts (paid +
 * completed, never pending/failed/cancelled).
 */
const DELIVERY_ELIGIBLE_STATUSES = new Set<string>(['paid', 'completed'])

/**
 * End-to-end delivery orchestration. Throws on infra failure (DB,
 * SES, PDF render) so the worker retries. Returns a discriminated
 * union for business outcomes (no exceptions for known states).
 */
export async function deliverOrder(input: DeliverOrderInput): Promise<DeliverOrderResult> {
  // STEP 1 — load + check eligibility.
  const orderRow = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        eventId: orders.eventId,
        status: orders.status,
        merchantTransactionId: orders.merchantTransactionId,
        buyerName: orders.buyerName,
        buyerEmail: orders.buyerEmail,
        totalPaisa: orders.totalPaisa,
      })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!orderRow) {
    logger.warn({ orderId: input.orderId }, 'tickets.deliver.order_not_found')
    return { kind: 'order_not_found', orderId: input.orderId }
  }

  if (!DELIVERY_ELIGIBLE_STATUSES.has(orderRow.status)) {
    logger.warn(
      { orderId: orderRow.id, currentStatus: orderRow.status },
      'tickets.deliver.order_not_eligible',
    )
    return { kind: 'order_not_eligible', orderId: orderRow.id, currentStatus: orderRow.status }
  }

  // STEP 2 — idempotency guard on delivery marker.
  const alreadyDelivered = await withSuperAdmin(async (db) => {
    const rows = await db
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(
        sql`${orderEvents.orderId} = ${orderRow.id} AND ${orderEvents.eventType} = ${DELIVERY_SENT_EVENT_TYPE}`,
      )
      .limit(1)
    return rows.length > 0
  })

  if (alreadyDelivered) {
    logger.info({ orderId: orderRow.id }, 'tickets.deliver.already_delivered')
    return { kind: 'already_delivered', orderId: orderRow.id }
  }

  // STEP 3 — ensure attendees exist (idempotent on its own marker).
  const attendeeResult = await generateAttendeesForOrder({ orderId: orderRow.id })
  if (attendeeResult.kind === 'order_not_found' || attendeeResult.kind === 'order_not_paid') {
    // Defensive — shouldn't happen given the eligibility check above.
    logger.error(
      { orderId: orderRow.id, kind: attendeeResult.kind },
      'tickets.deliver.attendee_generation_unexpected_outcome',
    )
    return { kind: 'order_not_eligible', orderId: orderRow.id, currentStatus: orderRow.status }
  }

  // STEP 4 — load event + tenant + tier details for PDFs + emails.
  const ctx = await withSuperAdmin(async (db) => {
    const [evt] = await db
      .select({
        title: events.title,
        titleBn: events.titleBn,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        timezone: events.timezone,
        venue: events.venue,
      })
      .from(events)
      .where(eq(events.id, orderRow.eventId))
      .limit(1)

    const [tenant] = await db
      .select({
        name: tenants.name,
        slug: tenants.slug,
        brandColorPrimary: tenants.brandColorPrimary,
      })
      .from(tenants)
      .where(eq(tenants.id, orderRow.tenantId))
      .limit(1)

    const attendeeRows = await db
      .select({
        id: attendees.id,
        attendeeName: attendees.attendeeName,
        attendeeEmail: attendees.attendeeEmail,
        ticketTierId: attendees.ticketTierId,
        qrCode: attendees.qrCode,
        tierName: ticketTiers.name,
      })
      .from(attendees)
      .innerJoin(ticketTiers, eq(attendees.ticketTierId, ticketTiers.id))
      .where(eq(attendees.orderId, orderRow.id))

    return { evt, tenant, attendeeRows }
  })

  if (!ctx.evt || !ctx.tenant) {
    logger.error(
      { orderId: orderRow.id, hasEvent: !!ctx.evt, hasTenant: !!ctx.tenant },
      'tickets.deliver.missing_event_or_tenant',
    )
    return { kind: 'order_not_found', orderId: orderRow.id }
  }

  // STEP 5 — locale (per buyer's tenant).
  const locale = await selectLocale({ tenantId: orderRow.tenantId })

  const venueSummary = formatVenueSummary(ctx.evt.venue)
  const orderUrl = `${process.env['EVENTPULSE_WEB_BASE_URL'] ?? 'https://staging.eventpulse.com.bd'}/orders/${orderRow.id}`

  // STEP 6 — buyer email (no attachment).
  const buyerRendered = renderOrderConfirmed({
    buyerName: orderRow.buyerName,
    eventTitle: ctx.evt.title,
    eventStartsAt: ctx.evt.startsAt,
    eventTimezone: ctx.evt.timezone,
    venue: venueSummary,
    ticketCount: ctx.attendeeRows.length,
    totalPaisa: orderRow.totalPaisa,
    orderUrl,
    locale,
  })
  const buyerResult = await sendEmailRaw({
    to: orderRow.buyerEmail,
    subject: buyerRendered.subject,
    text: buyerRendered.text,
    html: buyerRendered.html,
    tags: { template: 'order_confirmed', order_id: orderRow.id },
  })

  // Collect every send into a notification_log record (§9.10). Recipients are
  // hashed in buildEmailNotificationRows (R5); rows are inserted in STEP 8's tx.
  const sendRecords: SentEmailRecord[] = [
    {
      recipient: orderRow.buyerEmail,
      templateId: 'order_confirmed',
      providerMessageId: buyerResult.messageId,
    },
  ]

  // STEP 7 — per-attendee emails (PDF attached).
  const attendeeMessageIds: string[] = []
  for (const att of ctx.attendeeRows) {
    const pdf = await renderTicketPdf({
      eventTitle: ctx.evt.title,
      ...(ctx.evt.titleBn ? { eventTitleBn: ctx.evt.titleBn } : {}),
      eventStartsAt: ctx.evt.startsAt,
      eventEndsAt: ctx.evt.endsAt,
      eventTimezone: ctx.evt.timezone,
      venue: parseVenueForPdf(ctx.evt.venue),
      tenantName: ctx.tenant.name,
      brandColorPrimary: ctx.tenant.brandColorPrimary,
      attendeeName: att.attendeeName,
      tierName: att.tierName,
      qrToken: att.qrCode,
      merchantTransactionId: orderRow.merchantTransactionId,
      locale,
    })
    const rendered = renderAttendeeTicket({
      attendeeName: att.attendeeName,
      eventTitle: ctx.evt.title,
      eventStartsAt: ctx.evt.startsAt,
      eventTimezone: ctx.evt.timezone,
      venue: venueSummary,
      tierName: att.tierName,
      locale,
    })
    // Attendee email falls back to buyer email when not set (MVP — per-
    // attendee form capture is Phase 2 scope).
    const recipient = att.attendeeEmail ?? orderRow.buyerEmail
    const sendResult = await sendEmailRaw({
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      attachments: [{ filename: 'ticket.pdf', contentType: 'application/pdf', content: pdf.pdf }],
      tags: { template: 'attendee_ticket', order_id: orderRow.id, attendee_id: att.id },
    })
    attendeeMessageIds.push(sendResult.messageId)
    sendRecords.push({
      recipient,
      templateId: 'attendee_ticket',
      providerMessageId: sendResult.messageId,
    })
  }

  // STEP 8 — mark delivered + audit. Single tx.
  await withSuperAdmin(async (db) => {
    await db.insert(orderEvents).values({
      tenantId: orderRow.tenantId,
      orderId: orderRow.id,
      eventType: DELIVERY_SENT_EVENT_TYPE,
      actorType: 'system',
      actorId: null,
      payload: {
        attendee_count: ctx.attendeeRows.length,
        buyer_message_id: buyerResult.messageId,
        attendee_message_ids: attendeeMessageIds,
        locale,
      },
    })
    await writeOrderDelivered(db, {
      orderId: orderRow.id,
      tenantId: orderRow.tenantId,
      eventId: orderRow.eventId,
      attendeeCount: ctx.attendeeRows.length,
      locale,
    })

    // notification_log (§9.10) — one queryable row per email sent for this
    // order. Same tx as the delivery audit so they commit atomically.
    const notificationRows = buildEmailNotificationRows(sendRecords, orderRow.tenantId)
    if (notificationRows.length > 0) {
      await db.insert(notificationLog).values(notificationRows)
    }
  })

  logger.info(
    {
      orderId: orderRow.id,
      attendeeCount: ctx.attendeeRows.length,
      emailsSent: 1 + ctx.attendeeRows.length,
      buyerMessageId: buyerResult.messageId,
      dryRun: buyerResult.dryRun,
    },
    'tickets.deliver.delivered',
  )

  return {
    kind: 'delivered',
    orderId: orderRow.id,
    attendeeCount: ctx.attendeeRows.length,
    emailsSent: 1 + ctx.attendeeRows.length,
    buyerMessageId: buyerResult.messageId,
    attendeeMessageIds,
  }
}

// ─── venue helpers ──────────────────────────────────────────────────

/**
 * Extract a human-readable single-line venue summary from the
 * polymorphic venue jsonb (physical | online | tba).
 */
function formatVenueSummary(venue: unknown): string {
  if (!venue || typeof venue !== 'object') return '—'
  const v = venue as Record<string, unknown>
  if (v['type'] === 'online') {
    return typeof v['platform'] === 'string' ? `Online — ${v['platform']}` : 'Online'
  }
  if (v['type'] === 'tba') return 'TBA'
  // physical
  const parts: string[] = []
  if (typeof v['name'] === 'string') parts.push(v['name'])
  if (typeof v['address'] === 'string') parts.push(v['address'])
  if (typeof v['district'] === 'string') parts.push(v['district'])
  return parts.length > 0 ? parts.join(', ') : '—'
}

/**
 * Map the polymorphic venue jsonb to the shape renderTicketPdf needs.
 */
function parseVenueForPdf(venue: unknown): { name: string; address?: string; city?: string } {
  if (!venue || typeof venue !== 'object') return { name: '—' }
  const v = venue as Record<string, unknown>
  if (v['type'] === 'online') {
    return {
      name: typeof v['platform'] === 'string' ? `Online — ${v['platform']}` : 'Online',
    }
  }
  if (v['type'] === 'tba') return { name: 'TBA' }
  const out: { name: string; address?: string; city?: string } = {
    name: typeof v['name'] === 'string' ? v['name'] : '—',
  }
  if (typeof v['address'] === 'string') out.address = v['address']
  if (typeof v['district'] === 'string') out.city = v['district']
  return out
}
