/**
 * Ticket-tier routes — super-admin read context. Mounted at
 * /api/v1/admin/events/:eventId/tickets.
 *
 * Sprint 3 Day 25. Super-admin gets READ access only — no CRUD per
 * Day 25 brief ("tenant CRUD + super-admin read"). Per §14.4 the
 * platform doesn't reach into a tenant's pricing; super-admin
 * adjusts the platform fee + can suspend events via AUP triage
 * (Sprint 6+), but doesn't directly edit tier definitions.
 *
 * Surface today:
 *
 *   GET / — list tiers for an event, including archived
 *
 * Auth: requireSuperAdminAuth. The handler uses withSuperAdmin()
 * which bypasses RLS (per §4.2.1) so super-admin can read any
 * tenant's tiers without knowing the tenant id upfront — the event
 * id alone is the lookup key.
 */

import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { withSuperAdmin } from '../../db/client.js'
import { events, ticketTiers } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'

const adminTicketTiersApp = new Hono()
adminTicketTiersApp.use('*', requireSuperAdminAuth)

const eventParam = z.object({ eventId: z.string().uuid() })

function reqMeta(c: Context): { requestId: string | null } {
  return { requestId: c.req.header('x-request-id') ?? null }
}

// ─── GET / ─────────────────────────────────────────────────────────────

adminTicketTiersApp.get('/', zValidator('param', eventParam), async (c) => {
  const { eventId } = c.req.valid('param')
  const { requestId } = reqMeta(c)
  try {
    const result = await withSuperAdmin(async (tx) => {
      // Verify event exists before returning tier list — keeps 404 vs
      // 200 [] distinction useful for the super-admin UI.
      const eventRow = await tx
        .select({ id: events.id, tenantId: events.tenantId, title: events.title })
        .from(events)
        .where(eq(events.id, eventId))
        .limit(1)
      if (eventRow.length === 0) return null

      const tiers = await tx
        .select()
        .from(ticketTiers)
        .where(and(eq(ticketTiers.eventId, eventId)))
        .orderBy(asc(ticketTiers.sortOrder), asc(ticketTiers.createdAt))
      return { event: eventRow[0]!, tiers }
    })

    if (result === null) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'event not found', request_id: requestId } },
        404,
      )
    }

    return c.json({
      data: {
        event: {
          id: result.event.id,
          tenantId: result.event.tenantId,
          title: result.event.title,
        },
        tiers: result.tiers.map((t) => ({
          id: t.id,
          tenantId: t.tenantId,
          eventId: t.eventId,
          name: t.name,
          description: t.description,
          pricePaisa: t.pricePaisa.toString(),
          capacity: t.capacity,
          sold: t.sold,
          salesStartAt: t.salesStartAt?.toISOString() ?? null,
          salesEndAt: t.salesEndAt?.toISOString() ?? null,
          minPerOrder: t.minPerOrder,
          maxPerOrder: t.maxPerOrder,
          isComplimentary: t.isComplimentary,
          sortOrder: t.sortOrder,
          archivedAt: t.archivedAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
        })),
      },
    })
  } catch (err) {
    logger.error({ err, eventId, request_id: requestId }, 'admin ticket tier list failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to list ticket tiers',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

export { adminTicketTiersApp as adminTicketTiersRoutes }
