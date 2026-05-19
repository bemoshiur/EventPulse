/**
 * Trust Center service-layer reads — Sprint 2 Day 19 Item 14
 * (Decision K 2026-05-19).
 *
 * Read-only queries for public Trust Center pages (Next.js Server
 * Components) and the super admin Legal & Trust editor. All queries run
 * under `withSuperAdmin()` — legal documents are platform-global, not
 * tenant-scoped, and the only application role with grants on
 * `legal_documents` / `legal_document_versions` is `eventpulse_admin`
 * (per migration 0008 + §4.2.1.1).
 *
 * Mutation paths (create-version, bump-current-pointer) live in
 * `apps/api/src/routes/super-admin/legal.ts` so the route handler can
 * compose the transaction + audit write atomically.
 */

import { asc, desc, eq } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { legalDocuments, legalDocumentVersions } from '../../db/schema/index.js'

// ─── public Decision-K shape ─────────────────────────────────────────

/**
 * Shape returned to the public Trust Center Server Components.
 * Matches the contract documented in Decision K (2026-05-19).
 *
 * `currentVersion.isDraft` is derived server-side from the version
 * string — any `v0.x` is considered DRAFT. Once counsel publishes
 * `v1.0.0` the DRAFT banner stops rendering automatically with no
 * code change required.
 */
export interface LegalDocumentRender {
  slug: string
  category: 'legal_contract' | 'trust_artefact'
  title: string
  oneLiner: string
  canonicalUrlPath: string
  requiresSignature: boolean
  currentVersion: {
    version: string
    effectiveAt: string
    bodyHtml: string
    materialChange: boolean
    isDraft: boolean
  }
}

/**
 * Lightweight shape used on the Trust Center landing page (`/trust`).
 * Omits `bodyHtml` to keep the landing payload small — the landing
 * shows category cards + titles + one-liners only, not body content.
 */
export interface LegalDocumentLandingRow {
  slug: string
  category: 'legal_contract' | 'trust_artefact'
  title: string
  oneLiner: string
  canonicalUrlPath: string
  currentVersion: { version: string; isDraft: boolean }
}

/**
 * Version history entry for the admin editor's "Versions" view.
 */
export interface LegalDocumentVersionSummary {
  id: string
  version: string
  effectiveAt: string
  materialChange: boolean
  summaryOfChanges: string | null
  createdBy: string | null
  createdAt: string
  isCurrent: boolean
}

// ─── helpers ─────────────────────────────────────────────────────────

function isDraftVersion(version: string): boolean {
  return /^v0\./i.test(version)
}

function narrowCategory(value: string): 'legal_contract' | 'trust_artefact' {
  if (value === 'legal_contract' || value === 'trust_artefact') return value
  // Schema CHECK constraint guarantees this; the narrowing exists so the
  // function signature returns the union, not raw `string`.
  throw new Error(`legal_documents.category corrupt: ${value}`)
}

// ─── queries ─────────────────────────────────────────────────────────

/**
 * Fetch a single legal document + its current version body, keyed by
 * the public URL path (e.g. `/privacy`, `/trust/security/disclosure`).
 *
 * Returns `null` when the path has no matching row OR when the matching
 * row has no current version (e.g. mid-deploy seed in flight). The
 * Server Component should 404 in either case.
 */
export async function fetchLegalDocumentByUrlPath(
  urlPath: string,
): Promise<LegalDocumentRender | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        slug: legalDocuments.slug,
        category: legalDocuments.category,
        title: legalDocuments.title,
        oneLiner: legalDocuments.oneLiner,
        canonicalUrlPath: legalDocuments.canonicalUrlPath,
        requiresSignature: legalDocuments.requiresSignature,
        currentVersionId: legalDocuments.currentVersionId,
        versionId: legalDocumentVersions.id,
        version: legalDocumentVersions.version,
        effectiveAt: legalDocumentVersions.effectiveAt,
        bodyHtml: legalDocumentVersions.bodyHtml,
        materialChange: legalDocumentVersions.materialChange,
      })
      .from(legalDocuments)
      .leftJoin(
        legalDocumentVersions,
        eq(legalDocumentVersions.id, legalDocuments.currentVersionId),
      )
      .where(eq(legalDocuments.canonicalUrlPath, urlPath))
      .limit(1)

    const row = rows[0]
    if (!row || row.versionId === null || row.version === null) return null

    return {
      slug: row.slug,
      category: narrowCategory(row.category),
      title: row.title,
      oneLiner: row.oneLiner,
      canonicalUrlPath: row.canonicalUrlPath,
      requiresSignature: row.requiresSignature,
      currentVersion: {
        version: row.version,
        effectiveAt: row.effectiveAt!.toISOString(),
        bodyHtml: row.bodyHtml!,
        materialChange: row.materialChange!,
        isDraft: isDraftVersion(row.version),
      },
    }
  })
}

/**
 * Fetch a single legal document keyed by slug — used by the admin
 * Legal & Trust editor when navigating from the document list. Same
 * payload shape as `fetchLegalDocumentByUrlPath`.
 */
export async function fetchLegalDocumentBySlug(slug: string): Promise<LegalDocumentRender | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        slug: legalDocuments.slug,
        category: legalDocuments.category,
        title: legalDocuments.title,
        oneLiner: legalDocuments.oneLiner,
        canonicalUrlPath: legalDocuments.canonicalUrlPath,
        requiresSignature: legalDocuments.requiresSignature,
        currentVersionId: legalDocuments.currentVersionId,
        versionId: legalDocumentVersions.id,
        version: legalDocumentVersions.version,
        effectiveAt: legalDocumentVersions.effectiveAt,
        bodyHtml: legalDocumentVersions.bodyHtml,
        materialChange: legalDocumentVersions.materialChange,
      })
      .from(legalDocuments)
      .leftJoin(
        legalDocumentVersions,
        eq(legalDocumentVersions.id, legalDocuments.currentVersionId),
      )
      .where(eq(legalDocuments.slug, slug))
      .limit(1)

    const row = rows[0]
    if (!row || row.versionId === null || row.version === null) return null

    return {
      slug: row.slug,
      category: narrowCategory(row.category),
      title: row.title,
      oneLiner: row.oneLiner,
      canonicalUrlPath: row.canonicalUrlPath,
      requiresSignature: row.requiresSignature,
      currentVersion: {
        version: row.version,
        effectiveAt: row.effectiveAt!.toISOString(),
        bodyHtml: row.bodyHtml!,
        materialChange: row.materialChange!,
        isDraft: isDraftVersion(row.version),
      },
    }
  })
}

/**
 * List all documents for the Trust Center landing page (`/trust`).
 * Ordered by category (contracts first), then alphabetically by title.
 * Omits `bodyHtml` to keep the payload small.
 *
 * Filters out rows with no current version — those exist briefly
 * during deploy when the seed has inserted the document row but not
 * yet the v0.1 version row. The landing renders the published surface
 * only.
 */
export async function listLegalDocumentsForTrustCenterLanding(): Promise<
  LegalDocumentLandingRow[]
> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        slug: legalDocuments.slug,
        category: legalDocuments.category,
        title: legalDocuments.title,
        oneLiner: legalDocuments.oneLiner,
        canonicalUrlPath: legalDocuments.canonicalUrlPath,
        version: legalDocumentVersions.version,
        versionId: legalDocumentVersions.id,
      })
      .from(legalDocuments)
      .leftJoin(
        legalDocumentVersions,
        eq(legalDocumentVersions.id, legalDocuments.currentVersionId),
      )
      .orderBy(asc(legalDocuments.category), asc(legalDocuments.title))

    return rows
      .filter((r) => r.versionId !== null && r.version !== null)
      .map((r) => ({
        slug: r.slug,
        category: narrowCategory(r.category),
        title: r.title,
        oneLiner: r.oneLiner,
        canonicalUrlPath: r.canonicalUrlPath,
        currentVersion: { version: r.version!, isDraft: isDraftVersion(r.version!) },
      }))
  })
}

/**
 * List all documents for the admin Legal & Trust editor's document
 * list. Same data as the landing query but UNFILTERED — admins need
 * to see documents that have no current version yet (which should
 * never happen in production but is useful diagnostic surface).
 */
export async function listLegalDocumentsForAdmin(): Promise<
  Array<LegalDocumentLandingRow & { hasCurrentVersion: boolean }>
> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select({
        slug: legalDocuments.slug,
        category: legalDocuments.category,
        title: legalDocuments.title,
        oneLiner: legalDocuments.oneLiner,
        canonicalUrlPath: legalDocuments.canonicalUrlPath,
        version: legalDocumentVersions.version,
        versionId: legalDocumentVersions.id,
      })
      .from(legalDocuments)
      .leftJoin(
        legalDocumentVersions,
        eq(legalDocumentVersions.id, legalDocuments.currentVersionId),
      )
      .orderBy(asc(legalDocuments.category), asc(legalDocuments.title))

    return rows.map((r) => ({
      slug: r.slug,
      category: narrowCategory(r.category),
      title: r.title,
      oneLiner: r.oneLiner,
      canonicalUrlPath: r.canonicalUrlPath,
      currentVersion: {
        version: r.version ?? 'v0.0',
        isDraft: r.version === null ? true : isDraftVersion(r.version),
      },
      hasCurrentVersion: r.versionId !== null,
    }))
  })
}

/**
 * Full version history for a document (admin Legal & Trust editor's
 * version-history view). Ordered most-recent-first. The current
 * version is flagged via `isCurrent` for UI highlight.
 */
export async function fetchVersionHistoryForDocument(documentSlug: string): Promise<{
  document: { id: string; slug: string; title: string; currentVersionId: string | null } | null
  versions: LegalDocumentVersionSummary[]
}> {
  return withSuperAdmin(async (db) => {
    const docRows = await db
      .select({
        id: legalDocuments.id,
        slug: legalDocuments.slug,
        title: legalDocuments.title,
        currentVersionId: legalDocuments.currentVersionId,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.slug, documentSlug))
      .limit(1)

    const doc = docRows[0]
    if (!doc) return { document: null, versions: [] }

    const versionRows = await db
      .select({
        id: legalDocumentVersions.id,
        version: legalDocumentVersions.version,
        effectiveAt: legalDocumentVersions.effectiveAt,
        materialChange: legalDocumentVersions.materialChange,
        summaryOfChanges: legalDocumentVersions.summaryOfChanges,
        createdBy: legalDocumentVersions.createdBy,
        createdAt: legalDocumentVersions.createdAt,
      })
      .from(legalDocumentVersions)
      .where(eq(legalDocumentVersions.documentId, doc.id))
      .orderBy(desc(legalDocumentVersions.effectiveAt))

    return {
      document: doc,
      versions: versionRows.map((v) => ({
        id: v.id,
        version: v.version,
        effectiveAt: v.effectiveAt.toISOString(),
        materialChange: v.materialChange,
        summaryOfChanges: v.summaryOfChanges,
        createdBy: v.createdBy,
        createdAt: v.createdAt.toISOString(),
        isCurrent: v.id === doc.currentVersionId,
      })),
    }
  })
}

/**
 * Fetch a single version's full body — used by the admin editor when
 * opening a past version to compare or branch from.
 */
export async function fetchVersionById(versionId: string): Promise<{
  id: string
  documentId: string
  version: string
  bodyMd: string
  bodyHtml: string
  effectiveAt: string
  summaryOfChanges: string | null
  materialChange: boolean
  createdBy: string | null
  createdAt: string
} | null> {
  return withSuperAdmin(async (db) => {
    const rows = await db
      .select()
      .from(legalDocumentVersions)
      .where(eq(legalDocumentVersions.id, versionId))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      documentId: row.documentId,
      version: row.version,
      bodyMd: row.bodyMd,
      bodyHtml: row.bodyHtml,
      effectiveAt: row.effectiveAt.toISOString(),
      summaryOfChanges: row.summaryOfChanges,
      materialChange: row.materialChange,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    }
  })
}
