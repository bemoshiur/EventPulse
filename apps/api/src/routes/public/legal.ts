/**
 * Public Trust Center read endpoints — Sprint 2 Day 19 Item 14.
 *
 * Two endpoints under /api/v1/public/legal — unauthenticated, served to
 * the web app's public Server Components per Decision K (2026-05-19):
 * "Public Trust Center pages are Next.js Server Components with direct
 * service-layer DB reads." In practice the Server Component fetches over
 * HTTP from this module (cross-app direct imports are forbidden by §3.2);
 * the cache layer makes the HTTP hop ~free in practice.
 *
 *   GET /landing                 — list shape for /trust landing page
 *   GET /by-url-path?path=...    — single document by canonical URL
 *
 * No auth. The data is platform-global + already public-facing — the
 * editor is the gate, not the read path. The endpoint just returns
 * what the editor has published.
 *
 * Cache-Control: `public, max-age=300, s-maxage=3600`. Edge caches
 * one hour; client browsers five minutes. Matches the Next.js
 * `revalidate: 3600` on the consuming Server Component.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

import {
  fetchLegalDocumentByUrlPath,
  listLegalDocumentsForTrustCenterLanding,
} from '../../domain/legal/queries.js'

export const publicLegalRoutes = new Hono()

publicLegalRoutes.get('/landing', async (c) => {
  const rows = await listLegalDocumentsForTrustCenterLanding()
  c.header('cache-control', 'public, max-age=300, s-maxage=3600')
  return c.json({ data: rows })
})

publicLegalRoutes.get(
  '/by-url-path',
  zValidator(
    'query',
    z.object({
      path: z
        .string()
        .min(2)
        .max(120)
        .regex(/^\/[a-z0-9/-]*[a-z0-9]$/i, 'must be a normalised URL path'),
    }),
  ),
  async (c) => {
    const { path } = c.req.valid('query')
    const doc = await fetchLegalDocumentByUrlPath(path)
    if (!doc) {
      return c.json(
        { error: { code: 'DOCUMENT_NOT_FOUND', message: `No document at "${path}"` } },
        404,
      )
    }
    c.header('cache-control', 'public, max-age=300, s-maxage=3600')
    return c.json({ data: doc })
  },
)
