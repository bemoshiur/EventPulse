/**
 * Seed `legal_documents` + `legal_document_versions` v0.1 — Sprint 2
 * Day 19 Item 14.
 *
 * Inserts the canonical 18 Trust Center documents (6 legal contracts +
 * 12 trust artefacts) per §20.2 and Decision M.1 (2026-05-19, defer to
 * §20 verbatim). Each document seeds one v0.1 version row with the
 * skeleton DRAFT placeholder body per Decision M.2.
 *
 * Idempotent: re-running refreshes document metadata (title, one-liner,
 * canonical_url_path, requires_signature) but never overwrites an
 * existing version row. `current_version_id` is bumped to the v0.1 row
 * only when currently NULL — once a counsel-produced v1.0 ships and
 * `current_version_id` points there, re-running the seed never reverts
 * the pointer.
 *
 * Run at deploy and during dev DB bootstrap. Skips DB writes when
 * `DATABASE_URL` is not set so the file can serve as a CI-time lint of
 * the canonical list shape.
 */

import { renderLegalMarkdown } from '../../domain/legal/render.js'

/**
 * Canonical document definitions per §20.2 + Decision M.3.
 *
 * - `category`            — 'legal_contract' or 'trust_artefact'
 * - `slug`                — flat database slug (not URL-encoded)
 * - `canonicalUrlPath`    — public URL per §20.1
 * - `title`               — display title
 * - `oneLiner`            — verbatim from §20.2 (used both for landing
 *                          card copy and for generating the placeholder
 *                          body's "what this will cover" paragraph)
 * - `requiresSignature`   — true for the 6 contracts, false for the 12
 *                          artefacts (per §20.2 header text)
 */
interface LegalDocumentSeed {
  slug: string
  canonicalUrlPath: string
  category: 'legal_contract' | 'trust_artefact'
  title: string
  oneLiner: string
  requiresSignature: boolean
}

export const LEGAL_DOCUMENT_SEEDS: ReadonlyArray<LegalDocumentSeed> = [
  // ─── 6 LEGAL CONTRACTS (signed at consent) ────────────────────────
  {
    slug: 'privacy',
    canonicalUrlPath: '/privacy',
    category: 'legal_contract',
    title: 'Privacy Policy',
    oneLiner: 'How we handle your data, what your 9 rights are, who our sub-processors are.',
    requiresSignature: true,
  },
  {
    slug: 'terms',
    canonicalUrlPath: '/terms',
    category: 'legal_contract',
    title: 'Terms of Service',
    oneLiner: 'The deal between you and Event Pulse, written plainly. Pro-user framing throughout.',
    requiresSignature: true,
  },
  {
    slug: 'eula',
    canonicalUrlPath: '/eula',
    category: 'legal_contract',
    title: 'End-User Licence Agreement',
    oneLiner:
      'Your licence to use Event Pulse — and confirmation you own every output, every page, every form.',
    requiresSignature: true,
  },
  {
    slug: 'dpa',
    canonicalUrlPath: '/dpa',
    category: 'legal_contract',
    title: 'Data Processing Addendum',
    oneLiner: 'GDPR-compliant DPA for B2B customers handling controller-to-processor obligations.',
    requiresSignature: true,
  },
  {
    slug: 'cookies',
    canonicalUrlPath: '/cookies',
    category: 'legal_contract',
    title: 'Cookie Policy',
    oneLiner: 'Every cookie we set, its purpose, and how to opt out.',
    requiresSignature: true,
  },
  {
    slug: 'refund-policy',
    canonicalUrlPath: '/refund-policy',
    category: 'legal_contract',
    title: 'Refund Policy',
    oneLiner:
      'When buyers can get their money back, the SLA-credit schedule, the EPS chargeback path.',
    requiresSignature: true,
  },

  // ─── 12 TRUST ARTEFACTS (published policies) ──────────────────────
  {
    slug: 'security',
    canonicalUrlPath: '/trust/security',
    category: 'trust_artefact',
    title: 'Security & Infrastructure',
    oneLiner: 'Cloud architecture, encryption, KMS, ISO 27001 alignment, pen-test cadence.',
    requiresSignature: false,
  },
  {
    slug: 'sub-processors',
    canonicalUrlPath: '/trust/sub-processors',
    category: 'trust_artefact',
    title: 'Sub-processors',
    oneLiner:
      'Live list of every third party that touches your data, with purpose, location, and DPA link.',
    requiresSignature: false,
  },
  {
    slug: 'security-disclosure',
    canonicalUrlPath: '/trust/security/disclosure',
    category: 'trust_artefact',
    title: 'Vulnerability Disclosure',
    oneLiner: 'Safe-harbour policy for security researchers. We respond within 72 hours.',
    requiresSignature: false,
  },
  {
    slug: 'sla',
    canonicalUrlPath: '/trust/sla',
    category: 'trust_artefact',
    title: 'Service Level Agreement',
    oneLiner: 'Our 99.5% monthly uptime commitment and the credit schedule when we fall short.',
    requiresSignature: false,
  },
  {
    slug: 'acceptable-use',
    canonicalUrlPath: '/trust/acceptable-use',
    category: 'trust_artefact',
    title: 'Acceptable Use Policy',
    oneLiner: "What you can and can't do with Event Pulse. The suspension + appeal path.",
    requiresSignature: false,
  },
  {
    slug: 'anti-bribery',
    canonicalUrlPath: '/trust/anti-bribery',
    category: 'trust_artefact',
    title: 'Anti-Bribery & Anti-Corruption',
    oneLiner: 'Our procurement-grade integrity policy. UK Bribery Act, FCPA, BD ACC Act 2004.',
    requiresSignature: false,
  },
  {
    slug: 'ai-policy',
    canonicalUrlPath: '/trust/ai-policy',
    category: 'trust_artefact',
    title: 'Responsible AI Policy',
    oneLiner:
      "Which models we use, how, what we don't allow, and our no-training-on-customer-data guarantee.",
    requiresSignature: false,
  },
  {
    slug: 'bangladesh-compliance',
    canonicalUrlPath: '/trust/bangladesh-compliance',
    category: 'trust_artefact',
    title: 'Bangladesh Compliance',
    oneLiner: 'Per-clause mapping to DSA 2018 §29–§32, BTRC notice handling, ICT Act 2006.',
    requiresSignature: false,
  },
  {
    slug: 'gdpr',
    canonicalUrlPath: '/trust/gdpr',
    category: 'trust_artefact',
    title: 'GDPR Compliance',
    oneLiner: 'Per-Article walk-through, SCCs + UK IDTA, EU representative info.',
    requiresSignature: false,
  },
  {
    slug: 'accessibility',
    canonicalUrlPath: '/trust/accessibility',
    category: 'trust_artefact',
    title: 'Accessibility Statement',
    oneLiner: 'Our WCAG 2.1 AA conformance status, known issues, remediation timeline.',
    requiresSignature: false,
  },
  {
    slug: 'transparency',
    canonicalUrlPath: '/trust/transparency',
    category: 'trust_artefact',
    title: 'Transparency Report',
    oneLiner:
      'Government requests received in the year, refusal rate, our gag-order disclosure approach.',
    requiresSignature: false,
  },
  {
    slug: 'retention',
    canonicalUrlPath: '/trust/retention',
    category: 'trust_artefact',
    title: 'Data Retention Schedule',
    oneLiner:
      'Per-data-type retention windows. KYC docs: 5 years. Invoices: 7 years. Event logs: 1 year.',
    requiresSignature: false,
  },
]

/**
 * Validate the seed list at module load — exported so test code can run
 * the same check without touching the DB. Catches duplicate slugs /
 * URL paths and category-vs-requires_signature consistency.
 */
export function validateSeeds(list: ReadonlyArray<LegalDocumentSeed>): void {
  const slugs = new Set<string>()
  const urls = new Set<string>()

  for (const doc of list) {
    if (slugs.has(doc.slug)) throw new RangeError(`duplicate slug: "${doc.slug}"`)
    if (urls.has(doc.canonicalUrlPath)) {
      throw new RangeError(`duplicate canonicalUrlPath: "${doc.canonicalUrlPath}"`)
    }
    if (!doc.canonicalUrlPath.startsWith('/')) {
      throw new RangeError(`canonicalUrlPath must start with '/': "${doc.canonicalUrlPath}"`)
    }
    // §20.2 contract: contracts require signature, artefacts do not.
    const expected = doc.category === 'legal_contract'
    if (doc.requiresSignature !== expected) {
      throw new RangeError(
        `requires_signature must be ${expected} for category=${doc.category} (slug=${doc.slug})`,
      )
    }
    slugs.add(doc.slug)
    urls.add(doc.canonicalUrlPath)
  }

  if (list.length !== 18) {
    throw new RangeError(`expected 18 documents per §20.2; got ${list.length}`)
  }
  const contracts = list.filter((d) => d.category === 'legal_contract').length
  const artefacts = list.filter((d) => d.category === 'trust_artefact').length
  if (contracts !== 6) throw new RangeError(`expected 6 contracts; got ${contracts}`)
  if (artefacts !== 12) throw new RangeError(`expected 12 artefacts; got ${artefacts}`)
}

/**
 * Build the v0.1 placeholder body per Decision M.2.
 *
 * The "what this document will cover" paragraph is derived from the
 * one-liner — no AI-generated full text. Per `Trust Center v0.1
 * placeholders — skeleton-only, no AI-generated full text` (2026-05-17,
 * load-bearing) + Decision M.2.
 */
export function buildPlaceholderBodyMd(doc: LegalDocumentSeed): string {
  const documentTypeLabel = doc.category === 'legal_contract' ? 'contract' : 'policy'

  return `# ${doc.title}

> **DRAFT — not yet legally reviewed**
>
> This document is a placeholder. Final legal content will be drafted by counsel before MVP launch. The structure shown here represents a starting frame; actual section headings and content will be determined by counsel based on Bangladesh law and the platform's specific operations.

## Status

This document is currently at version v0.1 — a structural placeholder published to establish the URL, rendering pipeline, and consent capture infrastructure. **No legal effect is intended or implied.** Tenants are not bound by this version; consent capture is explicitly blocked on documents at v0.x versions (see registration flow §20.4).

## What this document will cover (provisional)

"${doc.title}" will cover ${lowerFirst(doc.oneLiner)}

## Contact

For questions about this ${documentTypeLabel}, contact legal@eventpulse.com.bd.
`
}

function lowerFirst(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * Idempotent seed runner.
 *
 * Three-step shape:
 *   1. UPSERT every document row (refreshes title/one_liner/url/etc.
 *      on re-run; does NOT touch current_version_id).
 *   2. INSERT v0.1 version rows with ON CONFLICT DO NOTHING (skip if
 *      already seeded).
 *   3. UPDATE current_version_id = (this v0.1 row's id) ONLY for
 *      documents where current_version_id IS NULL — first seed sets
 *      the pointer; subsequent seeds never revert it.
 *
 * Re-run safety: a counsel-produced v1.0 publish bumps
 * current_version_id to point at the v1.0 row; re-running this seed
 * never reverts that pointer back to v0.1.
 */
export async function run(): Promise<void> {
  validateSeeds(LEGAL_DOCUMENT_SEEDS)

  if (!process.env['DATABASE_URL']) {
    // eslint-disable-next-line no-console
    console.log(
      `legal documents: ${LEGAL_DOCUMENT_SEEDS.length} entries validated (DATABASE_URL not set; skipping insert)`,
    )
    return
  }

  // Dynamic imports so consumers / tests can pull the seed array and
  // the body builder without paying for pg + drizzle.
  const { withSuperAdmin, resetPool } = await import('../client.js')
  const { legalDocuments, legalDocumentVersions } = await import('../schema/index.js')
  const { sql, eq, isNull, and } = await import('drizzle-orm')

  try {
    await withSuperAdmin(async (tx) => {
      // ─── 1. UPSERT documents (don't touch current_version_id) ────
      for (const doc of LEGAL_DOCUMENT_SEEDS) {
        await tx
          .insert(legalDocuments)
          .values({
            slug: doc.slug,
            canonicalUrlPath: doc.canonicalUrlPath,
            category: doc.category,
            title: doc.title,
            oneLiner: doc.oneLiner,
            requiresSignature: doc.requiresSignature,
          })
          .onConflictDoUpdate({
            target: legalDocuments.slug,
            set: {
              canonicalUrlPath: doc.canonicalUrlPath,
              category: doc.category,
              title: doc.title,
              oneLiner: doc.oneLiner,
              requiresSignature: doc.requiresSignature,
              updatedAt: sql`now()`,
            },
          })
      }

      // ─── 2. INSERT v0.1 version rows (ON CONFLICT DO NOTHING) ────
      for (const doc of LEGAL_DOCUMENT_SEEDS) {
        const docRows = await tx
          .select({ id: legalDocuments.id })
          .from(legalDocuments)
          .where(eq(legalDocuments.slug, doc.slug))
          .limit(1)
        const documentId = docRows[0]?.id
        if (!documentId) {
          throw new Error(`document not found after upsert: ${doc.slug}`)
        }

        const bodyMd = buildPlaceholderBodyMd(doc)
        const bodyHtml = await renderLegalMarkdown(bodyMd)

        await tx
          .insert(legalDocumentVersions)
          .values({
            documentId,
            version: 'v0.1',
            effectiveAt: new Date(),
            bodyMd,
            bodyHtml,
            summaryOfChanges: 'Initial v0.1 placeholder.',
            materialChange: false,
            createdBy: null,
          })
          .onConflictDoNothing({
            target: [legalDocumentVersions.documentId, legalDocumentVersions.version],
          })
      }

      // ─── 3. Bump current_version_id ONLY where currently NULL ───
      // We do this as one statement per document to keep the SQL simple
      // and to avoid a window-function on a small (18-row) set.
      for (const doc of LEGAL_DOCUMENT_SEEDS) {
        const versionRows = await tx
          .select({ id: legalDocumentVersions.id })
          .from(legalDocumentVersions)
          .innerJoin(legalDocuments, eq(legalDocumentVersions.documentId, legalDocuments.id))
          .where(and(eq(legalDocuments.slug, doc.slug), eq(legalDocumentVersions.version, 'v0.1')))
          .limit(1)
        const versionId = versionRows[0]?.id
        if (!versionId) continue

        await tx
          .update(legalDocuments)
          .set({ currentVersionId: versionId, updatedAt: sql`now()` })
          .where(and(eq(legalDocuments.slug, doc.slug), isNull(legalDocuments.currentVersionId)))
      }
    })
    // eslint-disable-next-line no-console
    console.log(`legal documents: ${LEGAL_DOCUMENT_SEEDS.length} entries seeded (v0.1 placeholder)`)
  } finally {
    await resetPool()
  }
}

// CLI entrypoint: `pnpm --filter @eventpulse/api db:seed:legal-documents`
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
