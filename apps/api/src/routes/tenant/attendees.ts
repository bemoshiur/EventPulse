/**
 * Tenant attendee list route — Sprint 4 Day 32 Phase 1.
 *
 * Per §10.2:
 *   GET /api/v1/tenant/events/:eventId/attendees
 *     ?search=...&tierId=...&checkIn=all|checked_in|not_checked_in
 *     &orderStatus=...&limit=...&cursor=...
 *
 * Auth: requireTenantAuth (any tenant member; per-role gate is the
 * same Sprint 4+ carry as Day 31's check-in route — §5.4 restricts
 * full attendee read to Owner/Admin/Editor/Scanner, NOT Finance,
 * but we don't yet have `requireRole`. Acceptable MVP gap; same
 * shape as the check-in route which has the same gap).
 *
 * RLS + application-layer event/tenant filtering both engage; the
 * cross-tenant negative test pins the security contract.
 *
 * No per-row audit on the list endpoint (Decision G precedent —
 * tenant viewing own data is operational; bulk extraction is what
 * the CSV-export endpoint will audit in Phase 3).
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { logger } from '../../lib/logger.js'
import { exportEventAttendees } from '../../services/attendees/export-csv.js'
import { listEventAttendees } from '../../services/attendees/list.js'

export const attendeeRoutes = new Hono()

attendeeRoutes.use('*', requireTenantAuth)

// ─── helpers (mirrors super-admin/kyc.ts) ──────────────────────────

function envelope<T>(data: T, meta?: Record<string, unknown>) {
  return meta !== undefined ? { data, meta } : { data }
}

function errorEnvelope(code: string, message: string, requestId: string | null) {
  return {
    error: {
      code,
      message,
      request_id: requestId,
    },
  }
}

// ─── input schema ──────────────────────────────────────────────────

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  tierId: z.string().uuid().optional(),
  checkIn: z.enum(['all', 'checked_in', 'not_checked_in']).optional().default('all'),
  orderStatus: z
    .enum([
      'all',
      'pending',
      'awaiting_payment',
      'paid',
      'completed',
      'cancelled',
      'failed',
      'refunded',
    ])
    .optional()
    .default('all'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional(),
})

// ─── GET /:eventId/attendees ────────────────────────────────────────

attendeeRoutes.get('/:eventId/attendees', zValidator('query', listQuerySchema), async (c) => {
  const eventId = c.req.param('eventId')
  const query = c.req.valid('query')
  const tenantId = c.get('tenantId') as string
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const result = await listEventAttendees({
      tenantId,
      eventId,
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.tierId !== undefined ? { tierId: query.tierId } : {}),
      checkInFilter: query.checkIn,
      orderStatusFilter: query.orderStatus,
      limit: query.limit,
      cursor: query.cursor ?? null,
    })

    return c.json(envelope(result.rows, { nextCursor: result.nextCursor, hasMore: result.hasMore }))
  } catch (err) {
    logger.error({ err: (err as Error).message, eventId }, 'tenant.attendees.list.unhandled_error')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to list attendees', requestId), 500)
  }
})

// ─── GET /:eventId/attendees/export — CSV bulk PII extraction ──────

const exportQuerySchema = z.object({
  search: z.string().max(200).optional(),
  tierId: z.string().uuid().optional(),
  checkIn: z.enum(['all', 'checked_in', 'not_checked_in']).optional().default('all'),
  orderStatus: z
    .enum([
      'all',
      'pending',
      'awaiting_payment',
      'paid',
      'completed',
      'cancelled',
      'failed',
      'refunded',
    ])
    .optional()
    .default('all'),
})

attendeeRoutes.get(
  '/:eventId/attendees/export',
  zValidator('query', exportQuerySchema),
  async (c) => {
    const eventId = c.req.param('eventId')
    const query = c.req.valid('query')
    const tenantId = c.get('tenantId') as string
    const userId = c.get('auth')!.sub
    const requestId = c.req.header('x-request-id') ?? null
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = c.req.header('user-agent') ?? null

    try {
      const result = await exportEventAttendees({
        tenantId,
        eventId,
        actorUserId: userId,
        ...(query.search !== undefined ? { search: query.search } : {}),
        ...(query.tierId !== undefined ? { tierId: query.tierId } : {}),
        checkInFilter: query.checkIn,
        orderStatusFilter: query.orderStatus,
        ip,
        userAgent,
      })

      // text/csv with UTF-8 charset declaration + Content-Disposition
      // makes browsers download (not render). The BOM inside the
      // body lets Excel detect UTF-8 correctly.
      return new Response(result.csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${result.filename}"`,
          'cache-control': 'no-store',
          'x-row-count': String(result.rowCount),
        },
      })
    } catch (err) {
      logger.error(
        { err: (err as Error).message, eventId },
        'tenant.attendees.export.unhandled_error',
      )
      return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to export attendees', requestId), 500)
    }
  },
)
