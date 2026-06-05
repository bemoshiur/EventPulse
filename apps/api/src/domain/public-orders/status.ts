/**
 * Public order-status read — backs the post-payment `/orders/return/*` pages.
 *
 * Fetched by orderId (a uuid — not guessable, not PII) after the buyer returns
 * from EPS. Returns the order outcome + a buyer-safe summary + the issued
 * tickets (attendee name + QR token) so the success page can show + offer the
 * ticket. Public cross-tenant read via withSuperAdmin (mirrors public-events).
 */

import { and, eq, isNull } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { attendees, events, orders, tenants } from '../../db/schema/index.js'

export interface PublicOrderTicket {
  attendeeName: string
  qrCode: string
}

export interface PublicOrderStatus {
  orderId: string
  status: string
  buyerName: string
  buyerEmail: string
  subtotalPaisa: string
  platformFeePaisa: string
  epsFeePaisa: string
  totalPaisa: string
  currency: string
  paidAt: string | null
  createdAt: string
  event: {
    title: string
    startsAt: string
    slug: string
    tenantSlug: string
    tenantName: string
    venue: unknown
  }
  tickets: PublicOrderTicket[]
}

export async function fetchOrderStatus(orderId: string): Promise<PublicOrderStatus | null> {
  return withSuperAdmin(async (tx) => {
    const rows = await tx
      .select({ order: orders, event: events, tenant: tenants })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .innerJoin(tenants, eq(orders.tenantId, tenants.id))
      .where(eq(orders.id, orderId))
      .limit(1)
    if (rows.length === 0) return null
    const { order, event, tenant } = rows[0]!

    const tix = await tx
      .select({ attendeeName: attendees.attendeeName, qrCode: attendees.qrCode })
      .from(attendees)
      .where(and(eq(attendees.orderId, orderId), isNull(attendees.voidedAt)))

    return {
      orderId: order.id,
      status: order.status,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      subtotalPaisa: order.subtotalPaisa.toString(),
      platformFeePaisa: order.platformFeePaisa.toString(),
      epsFeePaisa: order.epsFeePaisa.toString(),
      totalPaisa: order.totalPaisa.toString(),
      currency: order.currency,
      paidAt: order.paidAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      event: {
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        slug: event.slug,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        venue: event.venue,
      },
      tickets: tix.map((t) => ({ attendeeName: t.attendeeName, qrCode: t.qrCode })),
    }
  })
}
