/**
 * Unit tests for the legal-documents seed — Sprint 2 Day 19 Item 14.
 *
 * Two layers:
 *   - Pure validation (`validateSeeds`, `buildPlaceholderBodyMd`) — no DB.
 *   - DB-gated idempotency test (run, run again, assert no duplicates +
 *     v0.1 still the current version) — only when DATABASE_URL is set.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  LEGAL_DOCUMENT_SEEDS,
  buildPlaceholderBodyMd,
  validateSeeds,
} from './seed-legal-documents.js'

describe('LEGAL_DOCUMENT_SEEDS — shape', () => {
  it('lists exactly 18 documents (§20.2 verbatim)', () => {
    expect(LEGAL_DOCUMENT_SEEDS).toHaveLength(18)
  })

  it('contains 6 contracts + 12 artefacts', () => {
    const contracts = LEGAL_DOCUMENT_SEEDS.filter((d) => d.category === 'legal_contract')
    const artefacts = LEGAL_DOCUMENT_SEEDS.filter((d) => d.category === 'trust_artefact')
    expect(contracts).toHaveLength(6)
    expect(artefacts).toHaveLength(12)
  })

  it('contracts all require_signature; artefacts do not', () => {
    for (const doc of LEGAL_DOCUMENT_SEEDS) {
      expect(doc.requiresSignature).toBe(doc.category === 'legal_contract')
    }
  })

  it('all canonicalUrlPath values are unique + start with /', () => {
    const paths = new Set<string>()
    for (const doc of LEGAL_DOCUMENT_SEEDS) {
      expect(doc.canonicalUrlPath.startsWith('/')).toBe(true)
      expect(paths.has(doc.canonicalUrlPath)).toBe(false)
      paths.add(doc.canonicalUrlPath)
    }
  })

  it('all slugs are unique + flat (no slashes)', () => {
    const slugs = new Set<string>()
    for (const doc of LEGAL_DOCUMENT_SEEDS) {
      expect(doc.slug.includes('/')).toBe(false)
      expect(slugs.has(doc.slug)).toBe(false)
      slugs.add(doc.slug)
    }
  })

  it('vulnerability disclosure has flat slug + nested URL (Decision M.3 example)', () => {
    const doc = LEGAL_DOCUMENT_SEEDS.find((d) => d.slug === 'security-disclosure')
    expect(doc).toBeDefined()
    expect(doc!.canonicalUrlPath).toBe('/trust/security/disclosure')
  })

  it('passes validateSeeds without error', () => {
    expect(() => validateSeeds(LEGAL_DOCUMENT_SEEDS)).not.toThrow()
  })
})

describe('validateSeeds — error cases', () => {
  const ok = LEGAL_DOCUMENT_SEEDS[0]!

  it('rejects duplicate slugs', () => {
    expect(() => validateSeeds([ok, { ...ok, canonicalUrlPath: '/different' }])).toThrow(
      /duplicate slug/,
    )
  })

  it('rejects duplicate canonicalUrlPath', () => {
    expect(() => validateSeeds([ok, { ...ok, slug: 'different' }])).toThrow(
      /duplicate canonicalUrlPath/,
    )
  })

  it('rejects canonicalUrlPath without leading /', () => {
    expect(() => validateSeeds([{ ...ok, slug: 'x', canonicalUrlPath: 'privacy' }])).toThrow(
      /must start with '\/'/,
    )
  })

  it('rejects contract with requires_signature=false', () => {
    expect(() =>
      validateSeeds([{ ...ok, slug: 'x', canonicalUrlPath: '/x', requiresSignature: false }]),
    ).toThrow(/requires_signature must be true/)
  })

  it('rejects artefact with requires_signature=true', () => {
    const artefact = LEGAL_DOCUMENT_SEEDS.find((d) => d.category === 'trust_artefact')!
    expect(() =>
      validateSeeds([{ ...artefact, slug: 'y', canonicalUrlPath: '/y', requiresSignature: true }]),
    ).toThrow(/requires_signature must be false/)
  })

  it('rejects wrong count', () => {
    expect(() => validateSeeds([ok])).toThrow(/expected 18 documents/)
  })
})

describe('buildPlaceholderBodyMd — Decision M.2 skeleton', () => {
  const sample = LEGAL_DOCUMENT_SEEDS[0]!

  it('starts with an H1 of the title', () => {
    const body = buildPlaceholderBodyMd(sample)
    expect(body).toMatch(new RegExp(`^# ${sample.title}\\b`))
  })

  it('includes the DRAFT banner blockquote', () => {
    const body = buildPlaceholderBodyMd(sample)
    expect(body).toContain('> **DRAFT — not yet legally reviewed**')
  })

  it('includes the Status section with v0.1 wording', () => {
    const body = buildPlaceholderBodyMd(sample)
    expect(body).toContain('## Status')
    expect(body).toContain('version v0.1')
    expect(body).toContain('No legal effect is intended or implied')
  })

  it('includes the "What this document will cover" section with the one-liner', () => {
    const body = buildPlaceholderBodyMd(sample)
    expect(body).toContain('## What this document will cover (provisional)')
    // One-liner is rendered lower-first
    expect(body).toContain(sample.title)
    // First word of the one-liner is lowercased in the rendered sentence.
    const lowerFirst = sample.oneLiner.charAt(0).toLowerCase() + sample.oneLiner.slice(1)
    expect(body).toContain(lowerFirst)
  })

  it('uses "contract" label for legal_contract category', () => {
    const contract = LEGAL_DOCUMENT_SEEDS.find((d) => d.category === 'legal_contract')!
    const body = buildPlaceholderBodyMd(contract)
    expect(body).toContain('contact legal@eventpulse.com.bd')
    expect(body).toContain('about this contract')
  })

  it('uses "policy" label for trust_artefact category', () => {
    const artefact = LEGAL_DOCUMENT_SEEDS.find((d) => d.category === 'trust_artefact')!
    const body = buildPlaceholderBodyMd(artefact)
    expect(body).toContain('about this policy')
  })
})

// ─── DB-gated idempotency test ───────────────────────────────────────

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('seed-legal-documents — idempotency (DB)', () => {
  beforeAll(async () => {
    // Clean slate for this test run. Reseed-test asserts the seed creates
    // rows; we delete any pre-existing rows so the count assertions are
    // meaningful. Safe because legal_documents/legal_document_versions
    // are platform-global and not used by other tests in this suite.
    const { withSuperAdmin } = await import('../client.js')
    const { consentRecords, legalDocuments, legalDocumentVersions } =
      await import('../schema/index.js')
    const { sql } = await import('drizzle-orm')

    await withSuperAdmin(async (tx) => {
      // Day 39 Phase 2: consent_records carries FK references to BOTH
      // legal_documents and legal_document_versions. Delete consent
      // rows first or the version delete below fails with
      // "consent_records_version_id_fkey violates foreign key
      // constraint". This is a TEST-only over-aggressive clean — prod
      // never deletes legal_documents rows by design (append-only spirit).
      await tx.delete(consentRecords).where(sql`true`)
      // null out current_version_id next so the doc/version deletes work
      // in any order (versions are referenced by current_version_id).
      await tx.update(legalDocuments).set({ currentVersionId: null })
      await tx.delete(legalDocumentVersions).where(sql`true`)
      await tx.delete(legalDocuments).where(sql`true`)
    })
  })

  afterAll(async () => {
    const { resetPool } = await import('../client.js')
    await resetPool()
  })

  it('first run seeds 18 documents + 18 v0.1 versions; second run is a no-op', async () => {
    const { run } = await import('./seed-legal-documents.js')
    const { withSuperAdmin } = await import('../client.js')
    const { legalDocuments, legalDocumentVersions } = await import('../schema/index.js')
    const { sql } = await import('drizzle-orm')

    await run()

    const afterFirst = await withSuperAdmin(async (tx) => {
      const docs = await tx.select({ id: legalDocuments.id }).from(legalDocuments)
      const versions = await tx.select({ id: legalDocumentVersions.id }).from(legalDocumentVersions)
      const docsWithCurrent = await tx
        .select({ id: legalDocuments.id })
        .from(legalDocuments)
        .where(sql`current_version_id is not null`)
      return {
        docCount: docs.length,
        versionCount: versions.length,
        docsWithCurrentCount: docsWithCurrent.length,
      }
    })

    expect(afterFirst.docCount).toBe(18)
    expect(afterFirst.versionCount).toBe(18)
    expect(afterFirst.docsWithCurrentCount).toBe(18)

    // Re-run is a no-op.
    await run()

    const afterSecond = await withSuperAdmin(async (tx) => {
      const docs = await tx.select({ id: legalDocuments.id }).from(legalDocuments)
      const versions = await tx.select({ id: legalDocumentVersions.id }).from(legalDocumentVersions)
      return { docCount: docs.length, versionCount: versions.length }
    })

    expect(afterSecond.docCount).toBe(18)
    expect(afterSecond.versionCount).toBe(18)
  })

  it('re-run does NOT revert current_version_id once a "v1.0.0" exists', async () => {
    const { run } = await import('./seed-legal-documents.js')
    const { withSuperAdmin } = await import('../client.js')
    const { legalDocuments, legalDocumentVersions } = await import('../schema/index.js')
    const { eq, sql } = await import('drizzle-orm')

    // Insert a fake v1.0.0 row for the 'privacy' document; bump
    // current_version_id to point at it.
    const v1Id = await withSuperAdmin(async (tx) => {
      const doc = await tx
        .select({ id: legalDocuments.id })
        .from(legalDocuments)
        .where(eq(legalDocuments.slug, 'privacy'))
        .limit(1)
      const docId = doc[0]!.id
      const inserted = await tx
        .insert(legalDocumentVersions)
        .values({
          documentId: docId,
          version: 'v1.0.0',
          effectiveAt: new Date(),
          bodyMd: '# v1\n\nbody',
          bodyHtml: '<h1>v1</h1>',
          summaryOfChanges: 'real publish',
          materialChange: true,
          createdBy: null,
        })
        .returning({ id: legalDocumentVersions.id })
      const versionId = inserted[0]!.id
      await tx
        .update(legalDocuments)
        .set({ currentVersionId: versionId, updatedAt: sql`now()` })
        .where(eq(legalDocuments.id, docId))
      return versionId
    })

    // Re-run the seed; current_version_id for 'privacy' must NOT revert.
    await run()

    const current = await withSuperAdmin(async (tx) => {
      const rows = await tx
        .select({ currentVersionId: legalDocuments.currentVersionId })
        .from(legalDocuments)
        .where(eq(legalDocuments.slug, 'privacy'))
        .limit(1)
      return rows[0]!.currentVersionId
    })

    expect(current).toBe(v1Id)
  })
})
