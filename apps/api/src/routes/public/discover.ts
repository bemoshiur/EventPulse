/**
 * Public event discovery routes (§2.7). Mounted at /api/v1/public/discover.
 *
 *   GET /         — list discoverable events; filters: category, city, q, limit
 *   GET /cities   — distinct areas present across discoverable events
 *
 * No auth: only publicly-visible, currently-open events are returned (the
 * domain query enforces visibility='public' + status + not-ended).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import { fetchDiscoverCities, fetchDiscoverEvents } from '../../domain/public-events/discover.js'

export const publicDiscoverRoutes = new Hono()

const querySchema = z.object({
  category: z.string().max(40).optional(),
  city: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(96).optional(),
})

publicDiscoverRoutes.get('/', zValidator('query', querySchema), async (c) => {
  const { category, city, q, limit } = c.req.valid('query')
  const data = await fetchDiscoverEvents({ category, city, q, limit })
  return c.json({ data })
})

publicDiscoverRoutes.get('/cities', async (c) => {
  const data = await fetchDiscoverCities()
  return c.json({ data })
})
