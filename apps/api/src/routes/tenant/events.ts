/**
 * Event routes — tenant context. Mounted at /api/v1/tenant/events.
 *
 * Sprint 3 Day 23 Workstream 1. Surface today:
 *
 *   POST   /                       — create draft event
 *   GET    /                       — list (cursor-paginated, status+type filters)
 *   GET    /:id                    — single fetch
 *   PATCH  /:id                    — partial update (draft + published only)
 *   POST   /:id/transition         — state-machine-gated status change
 *   DELETE /:id                    — soft delete
 *
 * Auth: requireTenantAuth + requireTenantType. Type must be set before
 * creating events (Item 11 post-login Account-Type modal gates this).
 * No KYC gate — self-service path A free-events can publish without KYC
 * per §13.5. KYC requirement layers in at "add paid tier" (Day 25+).
 *
 * RLS: every service call is under withTenant(c.get('tenantId')), which
 * sets app.current_tenant_id. Postgres enforces the cross-tenant
 * isolation via §4.3 events policies regardless of the application
 * layer. RLS isolation tests in services/events/events.rls.test.ts.
 *
 * Error mapping (per §6.3 canonical codes):
 *   EventNotFoundError              → 404 NOT_FOUND
 *   EventSlugConflictError          → 409 CONFLICT
 *   EventInvalidTransitionError     → 409 CONFLICT (state machine)
 *   EventInvalidStatusForEditError  → 409 CONFLICT (status-gated edit)
 *   ZodError (via zValidator)       → 400 VALIDATION_ERROR (handled by middleware)
 */

import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import {
  EventCreateSchema,
  EventListFilterSchema,
  EventTransitionSchema,
  EventUpdateSchema,
} from '@eventpulse/shared-types'

import { requireTenantAuth } from '../../auth/middleware.js'
import { requireTenantType } from '../../auth/tenant-type-gate.js'
import { logger } from '../../lib/logger.js'
import {
  EventInvalidStatusForEditError,
  EventInvalidTransitionError,
  EventNotFoundError,
  EventSlugConflictError,
  createEvent,
  getEvent,
  listEvents,
  softDeleteEvent,
  transitionEvent,
  updateEvent,
} from '../../services/events/index.js'

const eventsApp = new Hono()

eventsApp.use('*', requireTenantAuth)
eventsApp.use('*', requireTenantType)

function reqMeta(c: Context): {
  requestId: string | null
  ip: string | null
  userAgent: string | null
} {
  return {
    requestId: c.req.header('x-request-id') ?? null,
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  }
}

// ─── POST / ────────────────────────────────────────────────────────────

eventsApp.post('/', zValidator('json', EventCreateSchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')!
  const auth = c.get('auth')!
  const { requestId, ip, userAgent } = reqMeta(c)

  try {
    const created = await createEvent({
      tenantId,
      actorUserId: auth.sub,
      type: input.type,
      title: input.title,
      titleBn: input.titleBn ?? null,
      description: input.description ?? null,
      descriptionBn: input.descriptionBn ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      venue: input.venue,
      capacity: input.capacity ?? null,
      visibility: input.visibility,
      bannerImageUrl: input.bannerImageUrl ?? null,
      ogImageUrl: input.ogImageUrl ?? null,
      refundPolicy: input.refundPolicy,
      platformFeeHandling: input.platformFeeHandling,
      epsFeeHandling: input.epsFeeHandling,
      ip,
      userAgent,
    })
    return c.json({ data: created }, 201)
  } catch (err) {
    if (err instanceof EventSlugConflictError) {
      return c.json(
        {
          error: {
            code: 'CONFLICT',
            message: 'event slug already in use within this tenant; rename the event',
            request_id: requestId,
          },
        },
        409,
      )
    }
    logger.error({ err, tenantId, request_id: requestId }, 'event create failed')
    return c.json(
      {
        error: { code: 'INTERNAL_ERROR', message: 'failed to create event', request_id: requestId },
      },
      500,
    )
  }
})

// ─── GET / ─────────────────────────────────────────────────────────────

eventsApp.get('/', zValidator('query', EventListFilterSchema), async (c) => {
  const filter = c.req.valid('query')
  const tenantId = c.get('tenantId')!
  const { requestId } = reqMeta(c)
  try {
    const result = await listEvents({ tenantId, ...filter })
    return c.json({
      data: result.items,
      meta: { next_cursor: result.nextCursor, has_more: result.hasMore },
    })
  } catch (err) {
    logger.error({ err, tenantId, request_id: requestId }, 'event list failed')
    return c.json(
      {
        error: { code: 'INTERNAL_ERROR', message: 'failed to list events', request_id: requestId },
      },
      500,
    )
  }
})

// ─── GET /:id ──────────────────────────────────────────────────────────

const uuidParamSchema = z.object({ id: z.string().uuid() })

eventsApp.get('/:id', zValidator('param', uuidParamSchema), async (c) => {
  const { id } = c.req.valid('param')
  const tenantId = c.get('tenantId')!
  const { requestId } = reqMeta(c)
  try {
    const event = await getEvent({ tenantId, eventId: id })
    return c.json({ data: event })
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'event not found', request_id: requestId } },
        404,
      )
    }
    logger.error({ err, tenantId, eventId: id, request_id: requestId }, 'event get failed')
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'failed to load event', request_id: requestId } },
      500,
    )
  }
})

// ─── PATCH /:id ────────────────────────────────────────────────────────

eventsApp.patch(
  '/:id',
  zValidator('param', uuidParamSchema),
  zValidator('json', EventUpdateSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const patch = c.req.valid('json')
    const tenantId = c.get('tenantId')!
    const auth = c.get('auth')!
    const { requestId, ip, userAgent } = reqMeta(c)
    try {
      await updateEvent({
        tenantId,
        eventId: id,
        actorUserId: auth.sub,
        patch,
        ip,
        userAgent,
      })
      const event = await getEvent({ tenantId, eventId: id })
      return c.json({ data: event })
    } catch (err) {
      if (err instanceof EventNotFoundError) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'event not found', request_id: requestId } },
          404,
        )
      }
      if (err instanceof EventInvalidStatusForEditError) {
        return c.json(
          {
            error: {
              code: 'CONFLICT',
              message: `event in status '${err.currentStatus}' cannot be edited via PATCH; use the transition endpoint`,
              request_id: requestId,
            },
          },
          409,
        )
      }
      logger.error({ err, tenantId, eventId: id, request_id: requestId }, 'event update failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to update event',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

// ─── POST /:id/transition ─────────────────────────────────────────────

eventsApp.post(
  '/:id/transition',
  zValidator('param', uuidParamSchema),
  zValidator('json', EventTransitionSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { to, reason } = c.req.valid('json')
    const tenantId = c.get('tenantId')!
    const auth = c.get('auth')!
    const { requestId, ip, userAgent } = reqMeta(c)
    try {
      const result = await transitionEvent({
        tenantId,
        eventId: id,
        actorUserId: auth.sub,
        toState: to,
        reason: reason ?? null,
        ip,
        userAgent,
      })
      return c.json({ data: result })
    } catch (err) {
      if (err instanceof EventNotFoundError) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'event not found', request_id: requestId } },
          404,
        )
      }
      if (err instanceof EventInvalidTransitionError) {
        return c.json(
          {
            error: {
              code: 'CONFLICT',
              message: err.message,
              details: [{ field: 'to', allowed_next: err.allowedNext }],
              request_id: requestId,
            },
          },
          409,
        )
      }
      logger.error({ err, tenantId, eventId: id, request_id: requestId }, 'event transition failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to transition event',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

// ─── DELETE /:id ──────────────────────────────────────────────────────

eventsApp.delete('/:id', zValidator('param', uuidParamSchema), async (c) => {
  const { id } = c.req.valid('param')
  const tenantId = c.get('tenantId')!
  const auth = c.get('auth')!
  const { requestId, ip, userAgent } = reqMeta(c)
  try {
    await softDeleteEvent({
      tenantId,
      eventId: id,
      actorUserId: auth.sub,
      ip,
      userAgent,
    })
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'event not found', request_id: requestId } },
        404,
      )
    }
    logger.error({ err, tenantId, eventId: id, request_id: requestId }, 'event delete failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to delete event',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

export { eventsApp as eventsRoutes }
