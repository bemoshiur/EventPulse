/**
 * GET /api/v1/public/handles/resolve?slug=<old> — resolve a possibly-renamed
 * tenant slug to its current value via handle_history (§9.14). Returns
 * `{ data: { newSlug: string | null } }`. The public event page calls this when
 * an event 404s, so an old `{handle}/{event}` URL 301s to the new handle for the
 * 30-day redirect window. No auth — public read.
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { logger } from '../../lib/logger.js'
import { resolveHandleRedirect } from '../../services/handles/index.js'

const handles = new Hono()

const querySchema = z.object({ slug: z.string().min(1).max(40) })

handles.get('/resolve', zValidator('query', querySchema), async (c) => {
  const { slug } = c.req.valid('query')
  try {
    const newSlug = await resolveHandleRedirect(slug)
    return c.json({ data: { newSlug } })
  } catch (err) {
    logger.error({ err, slug }, 'handle redirect resolve failed')
    // Fail soft — a redirect-resolve failure should not 500 the page; the
    // caller treats null as "no redirect" and renders its own 404.
    return c.json({ data: { newSlug: null } })
  }
})

export { handles as publicHandlesRoutes }
