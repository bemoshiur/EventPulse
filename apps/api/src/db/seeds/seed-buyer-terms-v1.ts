/**
 * Seed Buyer-Terms-Lite v1.0 — Day 39 Phase 2.
 *
 * UPSERTs the `buyer-terms` legal_documents row + INSERTs the v1.0
 * legal_document_versions row + bumps current_version_id to v1.0
 * where currently NULL.
 *
 * Idempotent + safe:
 *   - Re-running refreshes document metadata (title, one-liner, etc.)
 *     but NEVER overwrites an existing v1.0 version row (ON CONFLICT DO
 *     NOTHING on the (document_id, version) unique).
 *   - current_version_id is bumped to v1.0 ONLY where currently NULL.
 *     Once a future v1.1 or v2.0 ships and current_version_id points
 *     there, re-running this seed never reverts to v1.0.
 *
 * Body content is the constant `BUYER_TERMS_V1_BODY_MD` from
 * `./buyer-terms-v1-body.ts` — the source-of-truth for what shipped at
 * v1.0. Any future content change requires a new version constant and
 * a new seed (e.g. `seed-buyer-terms-v1-1.ts`) — silent body drift at
 * a fixed version is a legal-risk pattern we won't enable.
 *
 * Body HTML is precomputed via `renderLegalMarkdown()` so the cached
 * `body_html` column is the canonical sanitized output of our pipeline
 * (Decision J 2026-05-19); public pages serve it directly without
 * re-sanitizing per request.
 *
 * Run at deploy (post-migrate) per `infra/deploy/deploy.sh` and during
 * CI integration (after `db:migrate`). Skips DB writes when
 * `DATABASE_URL` is unset so the file works as a CI-time lint of the
 * body constant.
 */

import { renderLegalMarkdown } from '../../domain/legal/render.js'

import {
  BUYER_TERMS_DOC_CANONICAL_URL_PATH,
  BUYER_TERMS_DOC_ONE_LINER,
  BUYER_TERMS_DOC_SLUG,
  BUYER_TERMS_DOC_TITLE,
  BUYER_TERMS_DOC_VERSION,
  BUYER_TERMS_V1_BODY_MD,
} from './buyer-terms-v1-body.js'

export async function run(): Promise<void> {
  // Render at module-load-time-ish: catch render failures BEFORE we
  // touch the DB (so CI/dry-run shows a parse error rather than an
  // inconsistent partial seed).
  const bodyHtml = await renderLegalMarkdown(BUYER_TERMS_V1_BODY_MD)

  if (!process.env['DATABASE_URL']) {
    // eslint-disable-next-line no-console
    console.log(
      `buyer-terms ${BUYER_TERMS_DOC_VERSION}: body validated + rendered (${bodyHtml.length} bytes HTML; DATABASE_URL not set; skipping insert)`,
    )
    return
  }

  // Dynamic imports so the body/render-validation path stays cheap
  // (no pg + drizzle pull) when DATABASE_URL is absent.
  const { withSuperAdmin, resetPool } = await import('../client.js')
  const { legalDocuments, legalDocumentVersions } = await import('../schema/index.js')
  const { and, eq, isNull, sql } = await import('drizzle-orm')

  try {
    await withSuperAdmin(async (tx) => {
      // ─── 1. UPSERT document row (don't touch current_version_id) ──
      await tx
        .insert(legalDocuments)
        .values({
          slug: BUYER_TERMS_DOC_SLUG,
          canonicalUrlPath: BUYER_TERMS_DOC_CANONICAL_URL_PATH,
          category: 'legal_contract',
          title: BUYER_TERMS_DOC_TITLE,
          oneLiner: BUYER_TERMS_DOC_ONE_LINER,
          requiresSignature: true,
        })
        .onConflictDoUpdate({
          target: legalDocuments.slug,
          set: {
            canonicalUrlPath: BUYER_TERMS_DOC_CANONICAL_URL_PATH,
            category: 'legal_contract',
            title: BUYER_TERMS_DOC_TITLE,
            oneLiner: BUYER_TERMS_DOC_ONE_LINER,
            requiresSignature: true,
            updatedAt: sql`now()`,
          },
        })

      // ─── 2. INSERT v1.0 version row (ON CONFLICT DO NOTHING) ──────
      const docRows = await tx
        .select({ id: legalDocuments.id })
        .from(legalDocuments)
        .where(eq(legalDocuments.slug, BUYER_TERMS_DOC_SLUG))
        .limit(1)
      const documentId = docRows[0]?.id
      if (!documentId) {
        throw new Error(`document not found after upsert: ${BUYER_TERMS_DOC_SLUG}`)
      }

      await tx
        .insert(legalDocumentVersions)
        .values({
          documentId,
          version: BUYER_TERMS_DOC_VERSION,
          effectiveAt: new Date(),
          bodyMd: BUYER_TERMS_V1_BODY_MD,
          bodyHtml,
          summaryOfChanges: 'Initial v1.0 — Salehin-approved 2026-05-31.',
          materialChange: false,
          createdBy: null,
        })
        .onConflictDoNothing({
          target: [legalDocumentVersions.documentId, legalDocumentVersions.version],
        })

      // ─── 3. Bump current_version_id to v1.0 where currently NULL ──
      const versionRows = await tx
        .select({ id: legalDocumentVersions.id })
        .from(legalDocumentVersions)
        .where(
          and(
            eq(legalDocumentVersions.documentId, documentId),
            eq(legalDocumentVersions.version, BUYER_TERMS_DOC_VERSION),
          ),
        )
        .limit(1)
      const versionId = versionRows[0]?.id
      if (versionId) {
        await tx
          .update(legalDocuments)
          .set({ currentVersionId: versionId, updatedAt: sql`now()` })
          .where(
            and(
              eq(legalDocuments.slug, BUYER_TERMS_DOC_SLUG),
              isNull(legalDocuments.currentVersionId),
            ),
          )
      }
    })
    // eslint-disable-next-line no-console
    console.log(
      `buyer-terms ${BUYER_TERMS_DOC_VERSION}: seeded (${bodyHtml.length} bytes HTML cached on legal_document_versions.body_html)`,
    )
  } finally {
    await resetPool()
  }
}

// CLI entrypoint: `pnpm --filter @eventpulse/api db:seed:buyer-terms-v1`
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  run().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('buyer-terms v1.0 seed failed:', err)
    process.exit(1)
  })
}
