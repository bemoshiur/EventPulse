/**
 * Ticket-tier routes — tenant context. Mounted at
 * /api/v1/tenant/events/:eventId/tickets.
 *
 * Sprint 3 Day 25. Surface today:
 *
 *   POST   /                       — create tier
 *   GET    /                       — list (active by default; ?includeArchived=true)
 *   GET    /:tierId                — single fetch
 *   PATCH  /:tierId                — partial update (archived tiers reject)
 *   POST   /:tierId/archive        — soft archive (sets archived_at)
 *
 * Auth: requireTenantAuth + requireTenantType. Mirrors events.ts gating.
 * No KYC gate at this surface — KYC requirement layers in at order
 * creation (Day 26+); a tenant can configure paid tiers as draft data
 * without KYC, but cannot publish/sell tickets without it.
 *
 * RLS: every service call is under withTenant(c.get('tenantId')), which
 * Postgres uses to filter ticket_tiers + events to the active tenant.
 * Cross-tenant attempts return 404 (event-not-found in tenant scope).
 *
 * No money math at this surface: tiers store price_paisa raw; the
 * fee-calculator (Day 21) is the only consumer at order time.
 */

import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { TicketTierCreateSchema, TicketTierUpdateSchema } from '@eventpulse/shared-types'

import { requireTenantAuth } from '../../auth/middleware.js'
import { requireTenantType } from '../../auth/tenant-type-gate.js'
import { logger } from '../../lib/logger.js'
import {
  TierArchivedError,
  TierEventNotFoundError,
  TierNotFoundError,
  archiveTier,
  createTier,
  getTier,
  listTiersByEvent,
  updateTier,
} from '../../services/ticket-tiers/index.js'

const ticketTiersApp = new Hono()

ticketTiersApp.use('*', requireTenantAuth)
ticketTiersApp.use('*', requireTenantType)

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

// ─── path / query schemas ──────────────────────────────────────────────

const eventParam = z.object({ eventId: z.string().uuid() })
const eventAndTierParam = z.object({
  eventId: z.string().uuid(),
  tierId: z.string().uuid(),
})
const listQuery = z.object({
  includeArchived: z.coerce.boolean().optional(),
})
const archiveBody = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .optional()

// ─── POST / ────────────────────────────────────────────────────────────

ticketTiersApp.post(
  '/',
  zValidator('param', eventParam),
  zValidator('json', TicketTierCreateSchema),
  async (c) => {
    const { eventId } = c.req.valid('param')
    const input = c.req.valid('json')
    const tenantId = c.get('tenantId')!
    const auth = c.get('auth')!
    const { requestId, ip, userAgent } = reqMeta(c)
    try {
      const created = await createTier({
        tenantId,
        eventId,
        actorUserId: auth.sub,
        name: input.name,
        description: input.description ?? null,
        pricePaisa: input.pricePaisa,
        capacity: input.capacity,
        salesStartAt: input.salesStartAt ?? null,
        salesEndAt: input.salesEndAt ?? null,
        minPerOrder: input.minPerOrder,
        maxPerOrder: input.maxPerOrder,
        isComplimentary: input.isComplimentary,
        sortOrder: input.sortOrder,
        ip,
        userAgent,
      })
      return c.json({ data: serialise(created) }, 201)
    } catch (err) {
      if (err instanceof TierEventNotFoundError) {
        return c.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: `event ${eventId} not found in tenant scope`,
              request_id: requestId,
            },
          },
          404,
        )
      }
      logger.error({ err, tenantId, eventId, request_id: requestId }, 'ticket tier create failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to create ticket tier',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

// ─── GET / ─────────────────────────────────────────────────────────────

ticketTiersApp.get(
  '/',
  zValidator('param', eventParam),
  zValidator('query', listQuery),
  async (c) => {
    const { eventId } = c.req.valid('param')
    const { includeArchived } = c.req.valid('query')
    const tenantId = c.get('tenantId')!
    const { requestId } = reqMeta(c)
    try {
      const tiers = await listTiersByEvent(tenantId, eventId, {
        includeArchived: includeArchived === true,
      })
      return c.json({ data: tiers.map(serialise) })
    } catch (err) {
      logger.error({ err, tenantId, eventId, request_id: requestId }, 'ticket tier list failed')
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
  },
)

// ─── GET /:tierId ──────────────────────────────────────────────────────

ticketTiersApp.get('/:tierId', zValidator('param', eventAndTierParam), async (c) => {
  const { tierId } = c.req.valid('param')
  const tenantId = c.get('tenantId')!
  const { requestId } = reqMeta(c)
  try {
    const tier = await getTier(tenantId, tierId)
    return c.json({ data: serialise(tier) })
  } catch (err) {
    if (err instanceof TierNotFoundError) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'ticket tier not found', request_id: requestId } },
        404,
      )
    }
    logger.error({ err, tenantId, tierId, request_id: requestId }, 'ticket tier get failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to load ticket tier',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

// ─── PATCH /:tierId ────────────────────────────────────────────────────

ticketTiersApp.patch(
  '/:tierId',
  zValidator('param', eventAndTierParam),
  zValidator('json', TicketTierUpdateSchema),
  async (c) => {
    const { tierId } = c.req.valid('param')
    const patch = c.req.valid('json')
    const tenantId = c.get('tenantId')!
    const auth = c.get('auth')!
    const { requestId, ip, userAgent } = reqMeta(c)
    try {
      const updated = await updateTier({
        tenantId,
        tierId,
        actorUserId: auth.sub,
        patch,
        ip,
        userAgent,
      })
      return c.json({ data: serialise(updated) })
    } catch (err) {
      if (err instanceof TierNotFoundError) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'ticket tier not found', request_id: requestId } },
          404,
        )
      }
      if (err instanceof TierArchivedError) {
        return c.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'ticket tier is archived; mutations are not allowed',
              request_id: requestId,
            },
          },
          409,
        )
      }
      logger.error({ err, tenantId, tierId, request_id: requestId }, 'ticket tier update failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to update ticket tier',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

// ─── POST /:tierId/archive ─────────────────────────────────────────────

ticketTiersApp.post(
  '/:tierId/archive',
  zValidator('param', eventAndTierParam),
  zValidator('json', archiveBody),
  async (c) => {
    const { tierId } = c.req.valid('param')
    const body = c.req.valid('json') ?? {}
    const tenantId = c.get('tenantId')!
    const auth = c.get('auth')!
    const { requestId, ip, userAgent } = reqMeta(c)
    try {
      const archived = await archiveTier({
        tenantId,
        tierId,
        actorUserId: auth.sub,
        reason: body.reason ?? null,
        ip,
        userAgent,
      })
      return c.json({ data: serialise(archived) })
    } catch (err) {
      if (err instanceof TierNotFoundError) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'ticket tier not found', request_id: requestId } },
          404,
        )
      }
      if (err instanceof TierArchivedError) {
        return c.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'ticket tier already archived',
              request_id: requestId,
            },
          },
          409,
        )
      }
      logger.error({ err, tenantId, tierId, request_id: requestId }, 'ticket tier archive failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to archive ticket tier',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

// ─── helpers ───────────────────────────────────────────────────────────

/**
 * Wire-serialise a TierRecord — bigint price_paisa → string (JSON
 * doesn't support bigint). Frontend coerces back to bigint via
 * `BigInt(...)` when needed.
 */
function serialise(row: {
  id: string
  tenantId: string
  eventId: string
  name: string
  description: string | null
  pricePaisa: bigint
  capacity: number
  sold: number
  salesStartAt: Date | null
  salesEndAt: Date | null
  minPerOrder: number
  maxPerOrder: number
  isComplimentary: boolean
  sortOrder: number
  archivedAt: Date | null
  createdAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventId: row.eventId,
    name: row.name,
    description: row.description,
    pricePaisa: row.pricePaisa.toString(),
    capacity: row.capacity,
    sold: row.sold,
    salesStartAt: row.salesStartAt?.toISOString() ?? null,
    salesEndAt: row.salesEndAt?.toISOString() ?? null,
    minPerOrder: row.minPerOrder,
    maxPerOrder: row.maxPerOrder,
    isComplimentary: row.isComplimentary,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export { ticketTiersApp as tenantTicketTiersRoutes }
