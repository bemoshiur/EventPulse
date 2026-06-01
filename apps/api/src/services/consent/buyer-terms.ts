/**
 * Buyer-Terms-Lite v1.0 consent helpers — Day 39 Phase 2.
 *
 * Resolves the current legal_documents row + legal_document_versions
 * row for `buyer-terms` so the order-creation tx-seam INSERT can
 * anchor consent_records by (document_id, version_id) without
 * embedding any UUIDs at code-level.
 *
 * Why the lookup runs in-tx, not at boot:
 *   - Lets `withSuperAdmin` capture render+lookup+INSERT in one atomic
 *     unit; if anything in the chain fails, the order is rolled back.
 *   - Avoids stale-cache risk: when a future v1.1 / v2.0 publishes,
 *     the next order picks up the new currentVersionId without a
 *     deploy.
 *   - Per-order cost is negligible (one indexed lookup, sub-ms).
 *
 * Failure mode: if `buyer-terms` is missing or its currentVersionId
 * is NULL, throws `BuyerTermsNotSeededError`. The caller's tx rolls
 * back, the order is not persisted, and the EPS Initialize call is
 * never made. This is the operator-spec'd precondition behavior
 * ("consent capture is a precondition, not a side effect").
 */

import { and, eq, isNotNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from '../../db/schema/index.js'
import { legalDocumentVersions, legalDocuments } from '../../db/schema/index.js'

type Tx = NodePgDatabase<typeof schema>

export const BUYER_TERMS_SLUG = 'buyer-terms' as const

export class BuyerTermsNotSeededError extends Error {
  constructor() {
    super(
      `Buyer Terms (slug='${BUYER_TERMS_SLUG}') is not seeded or has no current_version_id. ` +
        `Run \`pnpm --filter @eventpulse/api db:seed:buyer-terms-v1\` to seed v1.0. ` +
        `Order creation refuses to proceed without a current Buyer Terms version per the ` +
        `Phase 2 consent precondition.`,
    )
    this.name = 'BuyerTermsNotSeededError'
  }
}

export interface BuyerTermsVersionRef {
  documentId: string
  versionId: string
}

/**
 * Resolves the current Buyer Terms (document_id, version_id) inside
 * an existing tx. Caller is responsible for the withSuperAdmin scope.
 */
export async function resolveBuyerTermsCurrentVersion(tx: Tx): Promise<BuyerTermsVersionRef> {
  const rows = await tx
    .select({
      documentId: legalDocuments.id,
      versionId: legalDocuments.currentVersionId,
    })
    .from(legalDocuments)
    .where(
      and(eq(legalDocuments.slug, BUYER_TERMS_SLUG), isNotNull(legalDocuments.currentVersionId)),
    )
    .limit(1)

  const row = rows[0]
  if (!row || !row.versionId) {
    throw new BuyerTermsNotSeededError()
  }

  // Defence-in-depth: confirm the referenced version row still exists.
  // legal_document_versions is append-only so this is essentially a
  // sanity check, but cheap.
  const versionRows = await tx
    .select({ id: legalDocumentVersions.id })
    .from(legalDocumentVersions)
    .where(eq(legalDocumentVersions.id, row.versionId))
    .limit(1)
  if (versionRows.length === 0) {
    throw new BuyerTermsNotSeededError()
  }

  return { documentId: row.documentId, versionId: row.versionId }
}
