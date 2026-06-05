/**
 * seed-legal-v1 — promote the six binding legal contracts from v0.1 placeholder
 * to v1.0 real content (bodies in ./legal-bodies-v1.ts).
 *
 * For each document: INSERT the v1.0 version (idempotent — ON CONFLICT DO
 * NOTHING on (document_id, version)), then point `current_version_id` at the
 * v1.0 row. Unlike seed-buyer-terms-v1 (which bumps only where current is NULL),
 * this DELIBERATELY moves `current_version_id` off the v0.1 placeholder to v1.0
 * — that is the whole point: replace the "pending counsel" placeholder with the
 * real document. Re-running is a no-op once current already points at v1.0.
 *
 * Body validation/render runs even without DATABASE_URL (cheap, no insert), so
 * `tsx seed-legal-v1.ts` is a safe local check. The actual prod go-live is a
 * deliberate step (run with DATABASE_URL against prod) — not automatic.
 */

import { renderLegalMarkdown } from '../../domain/legal/render.js'
import { LEGAL_BODIES_V1, LEGAL_V1_VERSION } from './legal-bodies-v1.js'
import { TRUST_BODIES_V1 } from './trust-bodies-v1.js'

const ALL_BODIES = [...LEGAL_BODIES_V1, ...TRUST_BODIES_V1]

export async function run(): Promise<void> {
  // 1. Validate + render every body up front (fails loud on bad markdown).
  const rendered = await Promise.all(
    ALL_BODIES.map(async (b) => ({
      slug: b.slug,
      bodyMd: b.bodyMd,
      bodyHtml: await renderLegalMarkdown(b.bodyMd),
    })),
  )

  if (!process.env['DATABASE_URL']) {
    for (const r of rendered) {
      // eslint-disable-next-line no-console
      console.log(
        `legal ${r.slug} ${LEGAL_V1_VERSION}: validated + rendered (${r.bodyHtml.length} bytes HTML; DATABASE_URL not set; skipping insert)`,
      )
    }
    return
  }

  const { withSuperAdmin, resetPool } = await import('../client.js')
  const { legalDocuments, legalDocumentVersions } = await import('../schema/index.js')
  const { and, eq } = await import('drizzle-orm')

  try {
    await withSuperAdmin(async (tx) => {
      for (const r of rendered) {
        const docRows = await tx
          .select({ id: legalDocuments.id })
          .from(legalDocuments)
          .where(eq(legalDocuments.slug, r.slug))
          .limit(1)
        const documentId = docRows[0]?.id
        if (!documentId) throw new Error(`legal document not found: ${r.slug}`)

        await tx
          .insert(legalDocumentVersions)
          .values({
            documentId,
            version: LEGAL_V1_VERSION,
            effectiveAt: new Date(),
            bodyMd: r.bodyMd,
            bodyHtml: r.bodyHtml,
            summaryOfChanges: 'Initial v1.0 — real content replaces the v0.1 placeholder.',
            materialChange: true,
            createdBy: null,
          })
          .onConflictDoNothing({
            target: [legalDocumentVersions.documentId, legalDocumentVersions.version],
          })

        const versionRows = await tx
          .select({ id: legalDocumentVersions.id })
          .from(legalDocumentVersions)
          .where(
            and(
              eq(legalDocumentVersions.documentId, documentId),
              eq(legalDocumentVersions.version, LEGAL_V1_VERSION),
            ),
          )
          .limit(1)
        const versionId = versionRows[0]?.id
        if (!versionId) throw new Error(`v1.0 version row missing after insert: ${r.slug}`)

        // Point the live version at v1.0 (off the v0.1 placeholder).
        await tx
          .update(legalDocuments)
          .set({ currentVersionId: versionId, updatedAt: new Date() })
          .where(eq(legalDocuments.id, documentId))

        // eslint-disable-next-line no-console
        console.log(`legal ${r.slug}: current_version → ${LEGAL_V1_VERSION}`)
      }
    })
  } finally {
    await resetPool()
  }
}

// Allow `tsx seed-legal-v1.ts` direct execution.
if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err)
      process.exit(1)
    })
}
