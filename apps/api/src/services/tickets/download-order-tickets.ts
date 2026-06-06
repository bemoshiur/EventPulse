/**
 * On-demand ticket-PDF builder — backs the "Download tickets" button on the
 * post-payment success page (`GET /api/v1/public/orders/:id/tickets.pdf`).
 *
 * Loads the order's attendees (same join the email-delivery path uses) and
 * renders ONE multi-page PDF via `renderOrderTicketsPdf`. Only paid orders with
 * issued tickets produce a PDF. Cross-tenant read via withSuperAdmin — the
 * orderId (uuid) is the bearer capability, mirroring the status endpoint.
 */

import { eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { attendees, events, orders, tenants, ticketTiers } from '../../db/schema/index.js'
import { selectLocale } from '../notifications/locale.js'
import {
  renderOrderTicketsPdf,
  type RenderedTicketPdf,
  type RenderTicketPdfInput,
} from './render-ticket-pdf.js'

const PAID_STATUSES = new Set(['paid', 'completed'])

/** Narrow the stored venue jsonb into the PDF venue shape. */
function parseVenueForPdf(venue: unknown): { name: string; address?: string; city?: string } {
  if (venue && typeof venue === 'object') {
    const v = venue as Record<string, unknown>
    const out: { name: string; address?: string; city?: string } = {
      name: typeof v['name'] === 'string' ? v['name'] : 'Venue',
    }
    if (typeof v['address'] === 'string') out.address = v['address']
    if (typeof v['city'] === 'string') out.city = v['city']
    return out
  }
  return { name: 'Venue' }
}

export type DownloadTicketsResult =
  | { kind: 'ok'; pdf: RenderedTicketPdf; filename: string }
  | { kind: 'not_found' }
  | { kind: 'not_paid'; status: string }
  | { kind: 'no_tickets' }

export async function buildOrderTicketsPdf(orderId: string): Promise<DownloadTicketsResult> {
  const ctx = await withSuperAdmin(async (db) => {
    const [order] = await db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        eventId: orders.eventId,
        status: orders.status,
        merchantTransactionId: orders.merchantTransactionId,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    if (!order) return null

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
      .where(eq(events.id, order.eventId))
      .limit(1)

    const [tenant] = await db
      .select({ name: tenants.name, brandColorPrimary: tenants.brandColorPrimary })
      .from(tenants)
      .where(eq(tenants.id, order.tenantId))
      .limit(1)

    const attendeeRows = await db
      .select({
        attendeeName: attendees.attendeeName,
        qrCode: attendees.qrCode,
        tierName: ticketTiers.name,
      })
      .from(attendees)
      .innerJoin(ticketTiers, eq(attendees.ticketTierId, ticketTiers.id))
      .where(eq(attendees.orderId, order.id))

    return { order, evt, tenant, attendeeRows }
  })

  if (!ctx || !ctx.evt || !ctx.tenant) return { kind: 'not_found' }
  if (!PAID_STATUSES.has(ctx.order.status)) return { kind: 'not_paid', status: ctx.order.status }
  if (ctx.attendeeRows.length === 0) return { kind: 'no_tickets' }

  const locale = await selectLocale({ tenantId: ctx.order.tenantId })
  const { evt, tenant, order } = ctx

  const inputs: RenderTicketPdfInput[] = ctx.attendeeRows.map((att) => ({
    eventTitle: evt.title,
    ...(evt.titleBn ? { eventTitleBn: evt.titleBn } : {}),
    eventStartsAt: evt.startsAt,
    eventEndsAt: evt.endsAt,
    eventTimezone: evt.timezone,
    venue: parseVenueForPdf(evt.venue),
    tenantName: tenant.name,
    brandColorPrimary: tenant.brandColorPrimary,
    attendeeName: att.attendeeName,
    tierName: att.tierName,
    qrToken: att.qrCode,
    merchantTransactionId: order.merchantTransactionId,
    locale,
  }))

  const pdf = await renderOrderTicketsPdf(inputs)
  return { kind: 'ok', pdf, filename: `eventpulse-tickets-${order.merchantTransactionId}.pdf` }
}
