/**
 * Check-in route — Sprint 4 Day 31 Phase 1.
 *
 * Per §10.2:
 *   POST /api/v1/tenant/events/:eventId/checkin   body: { qr_code, gate }
 *   GET  /api/v1/tenant/events/:eventId/checkin/stats
 *
 * Auth: requireTenantAuth (any tenant member; per-role gate is a
 * Sprint 4+ carry — §5.4 says Owner/Admin/Editor/Scanner can check-in
 * but Finance cannot; we don't yet have a `requireRole` middleware
 * so MVP allows any tenant member). The endpoint is NOT public.
 *
 * The route is intentionally THIN — all decision logic lives in
 * `services/checkin/checkin.ts`. The route maps the discriminated
 * `CheckInResult` to HTTP status + the §6.2 envelope.
 */

import type { Context } from 'hono'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { logger } from '../../lib/logger.js'
import { checkInAttendee, getCheckInStats } from '../../services/checkin/checkin.js'

export const checkInRoutes = new Hono()

checkInRoutes.use('*', requireTenantAuth)

// ─── input schemas ──────────────────────────────────────────────────

const checkInBodySchema = z.object({
  // QR token is 43-char base64url per Day 28 design. Allow a small
  // band around that for tolerance to future format changes; the
  // service still validates against the actual stored value.
  qrCode: z.string().min(20).max(128),
  gate: z.string().max(64).optional().nullable(),
})

function reqMeta(c: Context): {
  ip: string | null
  userAgent: string | null
} {
  return {
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  }
}

// ─── POST /:eventId/checkin ──────────────────────────────────────────

checkInRoutes.post('/:eventId/checkin', zValidator('json', checkInBodySchema), async (c) => {
  const eventId = c.req.param('eventId')
  const body = c.req.valid('json')
  const tenantId = c.get('tenantId') as string
  const userId = c.get('auth')!.sub
  const { ip, userAgent } = reqMeta(c)

  try {
    const result = await checkInAttendee({
      tenantId,
      eventId,
      qrCode: body.qrCode,
      userId,
      gate: body.gate ?? null,
      ip,
      userAgent,
    })

    switch (result.kind) {
      case 'checked_in':
        return c.json(
          {
            data: {
              outcome: 'CHECKED_IN',
              attendee: {
                id: result.attendeeId,
                name: result.attendeeName,
                tier: result.tierName,
              },
              checkedInAt: result.checkedInAt.toISOString(),
            },
          },
          200,
        )
      case 'already_checked_in':
        return c.json(
          {
            error: {
              code: 'ATTENDEE_ALREADY_CHECKED_IN',
              message: 'this ticket has already been used; the original scan time is in details',
              details: {
                attendee: {
                  id: result.attendeeId,
                  name: result.attendeeName,
                  tier: result.tierName,
                },
                originalCheckInAt: result.checkedInAt.toISOString(),
                originalGate: result.checkedInGate,
              },
            },
          },
          409,
        )
      case 'wrong_event':
        return c.json(
          {
            error: {
              code: 'TICKET_WRONG_EVENT',
              message: 'this ticket is for a different event',
            },
          },
          409,
        )
      case 'invalid':
        return c.json(
          {
            error: {
              code: result.reason === 'voided' ? 'TICKET_VOIDED' : 'TICKET_INVALID',
              message:
                result.reason === 'voided'
                  ? 'this ticket has been voided'
                  : 'no ticket found for this QR code',
            },
          },
          404,
        )
    }
  } catch (err) {
    logger.error({ err: (err as Error).message, eventId }, 'checkin.unhandled_error')
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'failed to process check-in' } }, 500)
  }
})

// ─── GET /:eventId/checkin/stats ─────────────────────────────────────

checkInRoutes.get('/:eventId/checkin/stats', async (c) => {
  const eventId = c.req.param('eventId')
  const tenantId = c.get('tenantId') as string
  try {
    const stats = await getCheckInStats({ tenantId, eventId })
    return c.json({ data: stats }, 200)
  } catch (err) {
    logger.error({ err: (err as Error).message, eventId }, 'checkin.stats.unhandled_error')
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'failed to load check-in stats' } },
      500,
    )
  }
})
