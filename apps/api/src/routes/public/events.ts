/**
 * Public event read endpoint — Sprint 3 Day 25 Phase 2.
 *
 * Single read endpoint under /api/v1/public/events serving the public
 * event landing page. Unauthenticated; visibility + status filtering
 * is application-policy per `fetchPublicEvent()` in domain/public-
 * events/queries.ts.
 *
 *   GET /:tenantSlug/:eventSlug    — event + brand + tiers
 *
 * Cache-Control: `public, max-age=60, s-maxage=300`. Shorter than the
 * Trust Center cache (max 5 min vs 1 hour) because event data changes
 * more often (tier capacity edits, status transitions). Tighten or
 * loosen post-launch based on staging traffic patterns.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import { fetchPublicEvent } from '../../domain/public-events/queries.js'

export const publicEventsRoutes = new Hono()

const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/i, 'must be slug-shaped')

const paramSchema = z.object({
  tenantSlug: slugSchema,
  eventSlug: slugSchema,
})

publicEventsRoutes.get('/:tenantSlug/:eventSlug', zValidator('param', paramSchema), async (c) => {
  const { tenantSlug, eventSlug } = c.req.valid('param')
  const payload = await fetchPublicEvent(tenantSlug, eventSlug)
  if (!payload) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'event not found or not publicly accessible',
        },
      },
      404,
    )
  }
  c.header('cache-control', 'public, max-age=60, s-maxage=300')
  return c.json({ data: payload })
})
