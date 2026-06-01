/**
 * Public changelog read endpoints — Day 42 Sprint 4 §26.1 Day 9 part 3.
 *
 *   GET /api/v1/public/changelog                  → list public entries
 *   GET /api/v1/public/changelog/by-slug?slug=... → single entry
 *   GET /api/v1/public/changelog/by-version/:v    → entries for a version
 *
 * No auth — public-facing per §22.2. Edge-cacheable
 * (Cache-Control: public, max-age=300, s-maxage=3600 — matches the
 * Trust Center pattern).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import {
  getChangelogEntryBySlug,
  listChangelogByVersion,
  listPublishedChangelog,
} from '../../services/changelog/changelog-queries.js'

export const publicChangelogRoutes = new Hono()

publicChangelogRoutes.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'public, max-age=300, s-maxage=3600')
})

publicChangelogRoutes.get('/', async (c) => {
  const items = await listPublishedChangelog('public')
  return c.json({ data: items })
})

const bySlugQuerySchema = z.object({ slug: z.string().min(1).max(200) })

publicChangelogRoutes.get('/by-slug', zValidator('query', bySlugQuerySchema), async (c) => {
  const { slug } = c.req.valid('query')
  const entry = await getChangelogEntryBySlug(slug, 'public')
  if (!entry) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `Changelog entry '${slug}' not found` } },
      404,
    )
  }
  return c.json({ data: entry })
})

const versionParamSchema = z.object({ version: z.string().min(1).max(50) })

publicChangelogRoutes.get(
  '/by-version/:version',
  zValidator('param', versionParamSchema),
  async (c) => {
    const { version } = c.req.valid('param')
    const items = await listChangelogByVersion(version, 'public')
    return c.json({ data: items })
  },
)
