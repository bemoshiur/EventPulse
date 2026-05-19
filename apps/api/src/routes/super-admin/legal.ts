/**
 * Super admin Legal & Trust editor routes — Sprint 2 Day 19 Item 15.
 *
 * Five endpoints under /api/v1/admin/legal:
 *
 *   GET    /documents
 *   GET    /documents/:slug
 *   GET    /documents/:slug/versions/:versionId
 *   POST   /documents/:slug/versions
 *
 * (The list + detail + version-fetch are read paths backed by the
 * service-layer queries in apps/api/src/domain/legal/queries.ts; the
 * publish path composes the new-version INSERT, the
 * current_version_id bump, and the writeLegalVersionPublished audit
 * write into one withSuperAdmin transaction.)
 *
 * Per `.claude/memory/decisions.md` 2026-05-19 "Items 14+15 Trust
 * Center scaffolding + super admin Legal & Trust editor — pre-code
 * architecture (Decisions J, K, L, M)":
 *
 *   Decision J — body_md → body_html via the unified pipeline in
 *                domain/legal/render.ts AT PUBLISH TIME. The publish
 *                endpoint only accepts body_md and computes body_html
 *                server-side. Storing client-supplied HTML is
 *                forbidden — the contract is "the server is the
 *                sanitization boundary."
 *   Decision K — Public pages call the service-layer queries
 *                directly (no HTTP hop). Revalidation of the public
 *                page on publish is the Next.js `revalidatePath`
 *                concern — implemented as a fire-and-forget POST to
 *                a Next.js route handler when the env vars are set,
 *                no-op otherwise. Fallback is the `revalidate: 3600`
 *                edge cache.
 *   Decision L — No consent_records writes here. The publish endpoint
 *                does NOT broadcast a re-consent prompt — that lands
 *                in Sprint 3 alongside counsel-produced v1.0.
 *   Decision M — Document set is fixed (§20 verbatim). The list /
 *                detail endpoints make no assumption beyond "every
 *                document in legal_documents has a matching Next.js
 *                route file at its canonical_url_path."
 *
 * Auth: requireSuperAdminAuth on all endpoints. All five run under
 * withSuperAdmin() — legal documents are platform-global, only
 * eventpulse_admin (BYPASSRLS) has grants per migration 0008.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { withSuperAdmin } from '../../db/client.js'
import { legalDocuments, legalDocumentVersions } from '../../db/schema/index.js'
import { renderLegalMarkdown } from '../../domain/legal/render.js'
import {
  fetchLegalDocumentBySlug,
  fetchVersionById,
  fetchVersionHistoryForDocument,
  listLegalDocumentsForAdmin,
} from '../../domain/legal/queries.js'
import { logger } from '../../lib/logger.js'
import { writeLegalVersionPublished } from '../../services/audit/legal.js'

// ─── Zod schemas ─────────────────────────────────────────────────────

const PublishVersionBodySchema = z.object({
  version: z
    .string()
    .min(2)
    .max(40)
    .regex(/^v?\d+(\.\d+){0,3}([-+][\w.]+)?$/, 'must be a semver-ish version string'),
  bodyMd: z.string().min(1).max(200_000),
  effectiveAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO timestamp; defaults to now() server-side'),
  summaryOfChanges: z.string().min(1).max(2000).optional(),
  materialChange: z.boolean().optional().default(false),
})

// ─── error helpers ───────────────────────────────────────────────────

class DocumentNotFoundError extends Error {
  constructor(slug: string) {
    super(`legal document not found: ${slug}`)
    this.name = 'DocumentNotFoundError'
  }
}

class VersionConflictError extends Error {
  constructor(slug: string, version: string) {
    super(`version ${version} already exists for document ${slug}`)
    this.name = 'VersionConflictError'
  }
}

// ─── revalidation hook (Next.js public page cache bust) ──────────────

/**
 * Fire-and-forget POST to the Next.js revalidation endpoint when the
 * env vars are configured. No-op in test/dev. Failures are logged but
 * never block the publish flow — the public page falls through to its
 * 1-hour `revalidate` TTL if invalidation fails.
 *
 * The frontend PR (Day 19 PR 3) wires the matching Next.js route
 * handler at `/api/internal/revalidate-trust` on the web app.
 */
async function bestEffortRevalidate(canonicalUrlPath: string): Promise<void> {
  const baseUrl = process.env['WEB_REVALIDATE_URL']
  const secret = process.env['WEB_REVALIDATE_SECRET']
  if (!baseUrl || !secret) return

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: canonicalUrlPath, secret }),
    })
    if (!response.ok) {
      logger.warn(
        { canonicalUrlPath, status: response.status },
        'legal revalidation hook returned non-2xx',
      )
    }
  } catch (err) {
    logger.warn({ canonicalUrlPath, err }, 'legal revalidation hook failed')
  }
}

// ─── router ──────────────────────────────────────────────────────────

export const adminLegalRoutes = new Hono()

adminLegalRoutes.use('*', requireSuperAdminAuth)

/**
 * GET /documents — list all legal documents with their current version
 * metadata. Used by the editor's index view.
 */
adminLegalRoutes.get('/documents', async (c) => {
  const rows = await listLegalDocumentsForAdmin()
  return c.json({ data: rows })
})

/**
 * GET /documents/:slug — single document + full version history. The
 * editor opens this when navigating to a specific document.
 */
adminLegalRoutes.get('/documents/:slug', async (c) => {
  const slug = c.req.param('slug')

  const doc = await fetchLegalDocumentBySlug(slug)
  if (!doc) {
    return c.json(
      {
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: `No legal document with slug "${slug}"`,
        },
      },
      404,
    )
  }

  const history = await fetchVersionHistoryForDocument(slug)
  return c.json({
    data: {
      document: doc,
      versions: history.versions,
    },
  })
})

/**
 * GET /documents/:slug/versions/:versionId — single version body
 * (body_md + body_html) for the editor's compare / branch flow.
 */
adminLegalRoutes.get('/documents/:slug/versions/:versionId', async (c) => {
  const slug = c.req.param('slug')
  const versionId = c.req.param('versionId')

  const version = await fetchVersionById(versionId)
  if (!version) {
    return c.json(
      {
        error: {
          code: 'VERSION_NOT_FOUND',
          message: `No version with id "${versionId}"`,
        },
      },
      404,
    )
  }

  // Cross-check that the version belongs to the named document — guards
  // against URL-tampering / accidental misroute.
  const doc = await fetchLegalDocumentBySlug(slug)
  if (!doc || version.documentId !== (await documentIdFromSlug(slug))) {
    return c.json(
      {
        error: {
          code: 'VERSION_NOT_FOUND',
          message: `Version "${versionId}" does not belong to document "${slug}"`,
        },
      },
      404,
    )
  }

  return c.json({ data: version })
})

/**
 * POST /documents/:slug/versions — publish a new version.
 *
 * Body shape: { version, bodyMd, effectiveAt?, summaryOfChanges?, materialChange? }
 *
 * Server pipeline:
 *   1. resolve documentId from slug (404 if missing)
 *   2. render bodyMd → bodyHtml via renderLegalMarkdown() (Decision J)
 *   3. INSERT legal_document_versions row (409 on (document_id, version) unique violation)
 *   4. UPDATE legal_documents.current_version_id = newId + bump updated_at
 *   5. writeLegalVersionPublished audit row (Decision J + audit-on-publish contract)
 *   6. Commit transaction
 *   7. Fire-and-forget revalidation hook (Decision K)
 */
adminLegalRoutes.post(
  '/documents/:slug/versions',
  zValidator('json', PublishVersionBodySchema),
  async (c) => {
    const slug = c.req.param('slug')
    const body = c.req.valid('json')
    const auth = c.get('auth')!
    const actorUserId = auth.sub

    let bodyHtml: string
    try {
      bodyHtml = await renderLegalMarkdown(body.bodyMd)
    } catch (err) {
      logger.error({ slug, err }, 'legal markdown render failed')
      return c.json(
        {
          error: {
            code: 'RENDER_FAILED',
            message: 'markdown failed to render — check syntax',
          },
        },
        400,
      )
    }

    try {
      const result = await withSuperAdmin(async (tx) => {
        // 1. Resolve the document.
        const docRows = await tx
          .select({
            id: legalDocuments.id,
            slug: legalDocuments.slug,
            canonicalUrlPath: legalDocuments.canonicalUrlPath,
            currentVersionId: legalDocuments.currentVersionId,
          })
          .from(legalDocuments)
          .where(eq(legalDocuments.slug, slug))
          .limit(1)
        const doc = docRows[0]
        if (!doc) throw new DocumentNotFoundError(slug)

        // 2. Look up the prior version string (for the audit `fromVersion`).
        let fromVersion: string | null = null
        if (doc.currentVersionId) {
          const prior = await tx
            .select({ version: legalDocumentVersions.version })
            .from(legalDocumentVersions)
            .where(eq(legalDocumentVersions.id, doc.currentVersionId))
            .limit(1)
          fromVersion = prior[0]?.version ?? null
        }

        // 3. INSERT new version.
        const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : new Date()
        const inserted = await tx
          .insert(legalDocumentVersions)
          .values({
            documentId: doc.id,
            version: body.version,
            effectiveAt,
            bodyMd: body.bodyMd,
            bodyHtml,
            summaryOfChanges: body.summaryOfChanges ?? null,
            materialChange: body.materialChange ?? false,
            createdBy: actorUserId,
          })
          .returning({ id: legalDocumentVersions.id })

        const newVersionId = inserted[0]?.id
        if (!newVersionId) throw new Error('version insert returned no id')

        // 4. Bump current_version_id + updated_at on the document.
        await tx
          .update(legalDocuments)
          .set({ currentVersionId: newVersionId, updatedAt: sql`now()` })
          .where(eq(legalDocuments.id, doc.id))

        // 5. Audit.
        await writeLegalVersionPublished(tx, {
          versionId: newVersionId,
          documentId: doc.id,
          documentSlug: doc.slug,
          canonicalUrlPath: doc.canonicalUrlPath,
          fromVersion,
          toVersion: body.version,
          effectiveAt,
          materialChange: body.materialChange ?? false,
          summaryOfChanges: body.summaryOfChanges ?? null,
          actorUserId: actorUserId,
        })

        return {
          versionId: newVersionId,
          canonicalUrlPath: doc.canonicalUrlPath,
        }
      })

      // 7. Fire-and-forget revalidation. Awaited so test code can assert
      // it ran without timing flakes; result is intentionally not checked.
      await bestEffortRevalidate(result.canonicalUrlPath)

      return c.json({ data: { versionId: result.versionId } }, 201)
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        return c.json({ error: { code: 'DOCUMENT_NOT_FOUND', message: err.message } }, 404)
      }
      // Postgres unique-constraint violation (23505) on (document_id, version).
      // Drizzle wraps pg errors in DrizzleQueryError; the original pg
      // error sits at err.cause. Check both the top-level err and the
      // cause so we don't miss the wrap.
      if (isUniqueViolation(err)) {
        return c.json(
          {
            error: {
              code: 'VERSION_CONFLICT',
              message: `version "${body.version}" already exists for document "${slug}"`,
            },
          },
          409,
        )
      }
      if (err instanceof VersionConflictError) {
        return c.json({ error: { code: 'VERSION_CONFLICT', message: err.message } }, 409)
      }
      logger.error({ slug, err }, 'legal version publish failed')
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'publish failed' } }, 500)
    }
  },
)

// ─── error-shape sniffer for pg unique-violation under DrizzleQueryError ────

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  if ('code' in err && (err as { code?: unknown }).code === '23505') return true
  if ('cause' in err) {
    const cause = (err as { cause?: unknown }).cause
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      (cause as { code?: unknown }).code === '23505'
    ) {
      return true
    }
  }
  return false
}

// ─── small helper used by the version-fetch cross-check above ────────

async function documentIdFromSlug(slug: string): Promise<string | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(eq(legalDocuments.slug, slug))
      .limit(1)
    return rows[0]?.id ?? null
  })
}
