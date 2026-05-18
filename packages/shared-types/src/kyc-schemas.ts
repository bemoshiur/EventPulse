/**
 * KYC submission zod schemas — Sprint 2 Day 16 Item 12.
 *
 * Single source of truth for per-tier KYC validation. Used by both:
 *   - Server route handlers (apps/api/src/routes/tenant/kyc-drafts.ts +
 *     apps/api/src/routes/tenant/kyc.ts) for runtime validation.
 *   - Frontend react-hook-form resolvers (apps/web/src/components/
 *     kyc-wizard/individual-tier1/*.tsx) — same schemas, same types,
 *     no drift.
 *
 * Decision: .claude/memory/decisions.md 2026-05-18
 *   "Per-tier KYC schemas are discriminated unions, exported from
 *    apps/api/src/schemas/kyc.ts — single source of truth shared
 *    between server validation and client form schema."
 *
 * Shape conventions (load-bearing):
 *
 *   `kyc_submissions.fields` is nested by step for wizard-shaped rows:
 *     { identity: {...}, address: {...}, financial: {...} }
 *   This lets a PATCH that targets one step REPLACE that sub-object
 *   atomically via `jsonb || '{"identity": {...}}'::jsonb`, while
 *   preserving the OTHER steps' sub-objects untouched. The "Step N PATCH
 *   cannot wipe Step <N fields" invariant from Decision A relies on this
 *   shape (server-enforced merge; client is not trusted to send full
 *   state).
 *
 *   `kyc_submissions.documents` stays flat (keyed by KycDocumentType):
 *     { nid_front: 's3://...', nid_back: '...', photograph: '...',
 *       address_proof: '...' }
 *   Documents don't need a "step" grouping at storage time — they're
 *   identified by their type. The wizard knows which document slots
 *   belong to which step from this file's per-step PATCH schemas.
 *
 * Item 9's `POST /tenant/kyc/submissions` endpoint keeps its inline
 * (flat-shaped) schemas — that endpoint is the programmatic-client
 * back-compat path with no production UI consumer; refactoring it now
 * would be pure churn. The wizard's submit endpoint (`POST /tenant/kyc/
 * drafts/:id/submit`) uses the canonical schemas from this file. The
 * reviewer queue (Item 13, Day 18) will handle both shapes; in practice
 * the wizard is the only source of production submission data, so the
 * back-compat shape only surfaces in test runs.
 */

import { z } from 'zod'

// All imports here MUST stay frontend-safe — this module is consumed
// by both `apps/api/src/routes/tenant/kyc-drafts.ts` (server) and
// `apps/web/src/components/kyc-wizard/...` (browser, via PR 3). Pulling
// in a Node-only module (DB client, AWS SDK, fs) would break the
// frontend bundle. The KYC document-type enum + allowed-content-type
// map live in `packages/shared-types/src/kyc.ts` for this exact reason
// (Day 16 /review #1, confidence 92).
//
// Same-package imports use relative paths (./bd.js + ./kyc.js) to
// avoid the self-import cycle. Day 16 PR 3 moved this file from
// apps/api into packages/shared-types so the frontend can import the
// same schemas the backend validates against — single source of
// truth, no duplication.
import { BD_DIVISIONS } from './bd.js'
import { ALLOWED_CONTENT_TYPES } from './kyc.js'

// ─── document declaration shape ───────────────────────────────────────
//
// The wizard reports document uploads as `{ <documentType>: { contentType } }`,
// mirroring the upload-url endpoint's request shape. Server materialises
// the S3 URI from tenantId + submissionId + documentType + contentType
// via buildKycObjectUri() before persisting. Client cannot smuggle in
// arbitrary S3 paths; the wizard's PATCH body only carries enough
// information to identify which slot has been filled and with what
// content-type.

const allowedContentTypeKeys = Object.keys(ALLOWED_CONTENT_TYPES) as [
  keyof typeof ALLOWED_CONTENT_TYPES,
  ...(keyof typeof ALLOWED_CONTENT_TYPES)[],
]

const documentDeclSchema = z.object({
  contentType: z.enum(allowedContentTypeKeys),
})

// ─── Individual Tier 1 — per-step field schemas ───────────────────────
//
// Each step's schema validates the fields THE USER ENTERS at that step.
// The wizard's PATCH body for step N includes:
//   - step: <step name>
//   - fields[<step name>]: <step's fields schema>
//   - documents (optional): partial documents map for slots filled at this step
//
// Submit-time validation runs the full-tier schema against the
// accumulated `kyc_submissions.fields` + `kyc_submissions.documents`,
// rejecting any missing or invalid step.

/**
 * BD postal code: four-digit numeric. (BD postal codes are 4 digits.)
 */
const bdPostalCodeRegex = /^\d{4}$/

/**
 * ISO date YYYY-MM-DD shape. Frontend date pickers produce this format;
 * server enforces ≥ 18 years ago via a refinement. The refinement
 * deliberately runs on the parsed Date (no timezone surprise — BDT vs
 * UTC ambiguity doesn't matter for an age cutoff measured in years).
 */
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/

function isAtLeastEighteen(yyyyMmDd: string): boolean {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  if (!y || !m || !d) return false
  // Compare against today's wall-clock date in BDT — the precision is
  // years, so timezone slack of ±a day at the boundary is acceptable.
  const today = new Date()
  let age = today.getUTCFullYear() - y
  const monthDelta = today.getUTCMonth() + 1 - m
  if (monthDelta < 0 || (monthDelta === 0 && today.getUTCDate() < d)) age -= 1
  return age >= 18
}

export const IndividualTier1IdentitySchema = z.object({
  /** Full legal name as printed on the NID card. 2–120 chars. */
  fullName: z.string().trim().min(2).max(120),
  /** ISO date YYYY-MM-DD; tenant must be ≥ 18 years old. */
  dateOfBirth: z
    .string()
    .regex(isoDateRegex, 'date of birth must be YYYY-MM-DD')
    .refine(isAtLeastEighteen, 'must be at least 18 years old'),
  /**
   * NID number as a plain string — no format regex. Bangladesh NID
   * formats vary (10-digit smart NID, 13-digit old NID, 17-digit
   * registration form); a regex would reject valid NIDs. Reviewer
   * compares the submitted value against the uploaded NID image by eye
   * per decisions.md 2026-05-17 "Porichoy deferred — manual NID review
   * for MVP" + "Sprint 2 Item 10 scope amendment".
   */
  nidNumber: z.string().trim().min(10).max(20),
})

export const IndividualTier1AddressSchema = z.object({
  addressLine1: z.string().trim().min(1).max(200),
  /** Optional second line (apartment, suite, etc.). Empty string normalised to undefined. */
  addressLine2: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  city: z.string().trim().min(1).max(80),
  division: z.enum(BD_DIVISIONS),
  postalCode: z.string().trim().regex(bdPostalCodeRegex, 'BD postal code must be 4 digits'),
})

export const IndividualTier1FinancialSchema = z
  .object({
    /** Bank account or one of four BD MFS providers. */
    accountType: z.enum(['bank', 'bkash', 'nagad', 'rocket', 'upay']),
    /** Account holder name as registered. Soft-checked against fullName at submit-time. */
    accountName: z.string().trim().min(2).max(120),
    /** Account number / wallet number. Format varies by accountType; reviewer validates. */
    accountNumber: z.string().trim().min(8).max(32),
    /** Required iff accountType === 'bank'. Refined below. */
    branchName: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    /** eTIN: plain capture per Item 10 deferral. 10–13 digits in practice, no regex enforcement. */
    etinNumber: z.string().trim().min(10).max(13),
  })
  .refine((data) => data.accountType !== 'bank' || !!data.branchName, {
    message: 'branchName is required when accountType is "bank"',
    path: ['branchName'],
  })

// ─── Individual Tier 1 — submit-time full schema ──────────────────────
//
// Validates the accumulated `kyc_submissions.fields` + `documents` at
// the moment of `POST /tenant/kyc/drafts/:id/submit`. Every required
// step and every required document must be present.

const individualTier1DocumentsSchema = z.object({
  nid_front: z.string().min(1, 'NID front document required'),
  nid_back: z.string().min(1, 'NID back document required'),
  photograph: z.string().min(1, 'photograph (selfie) document required'),
  address_proof: z.string().min(1, 'address proof document required'),
})

export const IndividualTier1SubmissionSchema = z.object({
  fields: z.object({
    identity: IndividualTier1IdentitySchema,
    address: IndividualTier1AddressSchema,
    financial: IndividualTier1FinancialSchema,
  }),
  documents: individualTier1DocumentsSchema,
})

// ─── Individual Tier 1 — PATCH body schemas (per-step) ────────────────
//
// The wizard's PATCH body is discriminated on `step`. Each branch
// requires the fields for that step, plus optional document declarations
// for slots filled at that step. The server merges into the row
// field-by-field (step's sub-object replaced; other steps preserved;
// documents map shallow-merged).

// `fields` is **optional** on identity + address PATCH branches so a
// document-only PATCH (e.g. when an upload completes and the wizard
// registers the slot without re-sending typed values) doesn't
// inadvertently wipe the user's prior step fields via the server's
// `||` shallow merge. See Day 16 PR 3 /review BLOCKER 1: if the
// frontend sent `fields: {}`, the server would `fields || '{"identity":
// {}}'::jsonb` and replace the typed identity sub-object with `{}`.
// The server's PATCH handler now skips the fields merge when `fields`
// is undefined (or empty), preserving prior typed values.
const identityPatchSchema = z.object({
  step: z.literal('identity'),
  fields: IndividualTier1IdentitySchema.partial().optional(),
  documents: z
    .object({
      nid_front: documentDeclSchema.optional(),
      nid_back: documentDeclSchema.optional(),
      photograph: documentDeclSchema.optional(),
    })
    .optional(),
})

const addressPatchSchema = z.object({
  step: z.literal('address'),
  fields: IndividualTier1AddressSchema.partial().optional(),
  documents: z
    .object({
      address_proof: documentDeclSchema.optional(),
    })
    .optional(),
})

const financialPatchSchema = z.object({
  step: z.literal('financial'),
  // Don't `.partial()` the financial schema — the .refine on branchName
  // doesn't survive .partial() cleanly. Wizard PATCHes the whole step's
  // payload at once (the user fills the step then clicks Save & Continue);
  // partial PATCHes within a step aren't a Day 16 requirement.
  fields: IndividualTier1FinancialSchema,
  documents: z.never().optional(),
})

export const IndividualTier1PatchSchema = z.discriminatedUnion('step', [
  identityPatchSchema,
  addressPatchSchema,
  financialPatchSchema,
])

// ─── Inferred TS types (for frontend + server convenience) ────────────

export type IndividualTier1Identity = z.infer<typeof IndividualTier1IdentitySchema>
export type IndividualTier1Address = z.infer<typeof IndividualTier1AddressSchema>
export type IndividualTier1Financial = z.infer<typeof IndividualTier1FinancialSchema>
export type IndividualTier1Submission = z.infer<typeof IndividualTier1SubmissionSchema>
export type IndividualTier1Patch = z.infer<typeof IndividualTier1PatchSchema>
export type IndividualTier1Step = IndividualTier1Patch['step']

// ─── Step → required-documents map (drives the wizard UI + submit) ────
//
// Frontend uses this to know which document slots to render per step
// (and to display "X of Y uploaded" progress). Server uses it implicitly
// via the submit-time documents schema. Single source of truth.

export const INDIVIDUAL_TIER1_STEP_DOCUMENTS: Record<
  IndividualTier1Step,
  readonly ('nid_front' | 'nid_back' | 'photograph' | 'address_proof')[]
> = {
  identity: ['nid_front', 'nid_back', 'photograph'],
  address: ['address_proof'],
  financial: [],
}

export const INDIVIDUAL_TIER1_REQUIRED_DOCUMENTS = [
  'nid_front',
  'nid_back',
  'photograph',
  'address_proof',
] as const

// ─── Step enum for wizard navigation ──────────────────────────────────
//
// The wizard's navigation order. Step 4 ('review') is a UI-only step
// with no fields to PATCH — submit happens from review.

export const INDIVIDUAL_TIER1_STEPS = ['identity', 'address', 'financial', 'review'] as const
export type IndividualTier1WizardStep = (typeof INDIVIDUAL_TIER1_STEPS)[number]

// ═══════════════════════════════════════════════════════════════════════
// Organisation Tier A — Sprint 2 Day 17 Item 12 Part 2
//
// Six-step decomposition per .claude/memory/decisions.md 2026-05-19
// "Organisation Tier A wizard — 6-step decomposition + reuse Individual
// Tier 1's financial schema":
//
//   1. org_info           — text-only: legal name, trade license, BIN, DOI
//   2. signatory_identity — text-only: full name, NID number
//   3. signatory_docs     — uploads only: nid_front, nid_back, photograph
//   4. org_docs           — uploads only: trade_license, moa, aoa
//   5. financial          — text-only: reuses IndividualTier1FinancialSchema
//   6. review             — read-only summary, submit
//
// fields jsonb shape for Tier A:
//   { org: {...}, signatory: {...}, financial: {...} }
//
// documents jsonb shape:
//   { nid_front: 's3://...', nid_back, photograph, trade_license, moa, aoa }
// ═══════════════════════════════════════════════════════════════════════

// ─── Organisation Tier A — per-step field schemas ─────────────────────

/**
 * Bangladesh Business Identification Number (BIN) — VAT registration.
 *
 * The e-BIN format has been **13 digits** since 30 November 2019 per
 * NBR's mandate; the older 9-digit and 11-digit formats are deprecated
 * and would no longer appear on a current VAT-compliant invoice. Per
 * Day 17 PR 1 /review BLOCKER (confidence 90): accepting 9–12 digits
 * would bless formats that NBR explicitly rejects, leaving the
 * reviewer with no system guard against an outdated document.
 *
 * Sources: NBR's "fourteen-digit BIN search" portal + 2019 Bangladesh
 * Post mandate coverage.
 */
const binRegex = /^\d{13}$/

export const OrganisationTierAOrgInfoSchema = z.object({
  /** Registered legal name as it appears on the trade license. */
  legalName: z.string().trim().min(2).max(200),
  /** Trade license number. Format varies by issuing authority; plain capture. */
  tradeLicenseNumber: z.string().trim().min(3).max(60),
  /** BIN (Business Identification Number) — e-BIN, 13 digits. NBR mandate since 2019-11-30. */
  bin: z.string().trim().regex(binRegex, 'BIN must be 13 digits (NBR e-BIN format)'),
  /** Date of incorporation (ISO YYYY-MM-DD). Must be in the past. */
  dateOfIncorporation: z
    .string()
    .regex(isoDateRegex, 'date of incorporation must be YYYY-MM-DD')
    .refine((d) => {
      const [y, m, day] = d.split('-').map(Number)
      if (!y || !m || !day) return false
      const incorporationDate = new Date(Date.UTC(y, m - 1, day))
      return incorporationDate.getTime() < Date.now()
    }, 'date of incorporation must be in the past'),
})

export const OrganisationTierASignatorySchema = z.object({
  /** Authorised signatory full name as on NID. Soft-checked against accountName at submit. */
  fullName: z.string().trim().min(2).max(120),
  /** Signatory's NID number. Plain capture (Item 10 deferral). */
  nidNumber: z.string().trim().min(10).max(20),
})

// Financial schema is REUSED from Individual Tier 1 — semantically
// identical fields per the 2026-05-19 decision. Awkward naming
// (`IndividualTier1FinancialSchema` on an organisation submission)
// flagged for Sprint 3 rename to `BaseFinancialSchema` or similar.
//
// Note: account name soft-check at submit time should compare against
// the signatory's fullName for Tier A (not against an organisation
// name — the bank account is held in the signatory's capacity as
// authorised representative). The reviewer makes the hard call.

// ─── Organisation Tier A — submit-time full schema ────────────────────

const organisationTierADocumentsSchema = z.object({
  nid_front: z.string().min(1, 'signatory NID front required'),
  nid_back: z.string().min(1, 'signatory NID back required'),
  photograph: z.string().min(1, 'signatory photograph (selfie) required'),
  trade_license: z.string().min(1, 'trade license document required'),
  moa: z.string().min(1, 'memorandum of association required'),
  aoa: z.string().min(1, 'articles of association required'),
})

export const OrganisationTierASubmissionSchema = z.object({
  fields: z.object({
    org: OrganisationTierAOrgInfoSchema,
    signatory: OrganisationTierASignatorySchema,
    financial: IndividualTier1FinancialSchema,
  }),
  documents: organisationTierADocumentsSchema,
})

// ─── Organisation Tier A — PATCH body schemas (per-step) ──────────────

const orgInfoPatchSchema = z.object({
  step: z.literal('org_info'),
  fields: OrganisationTierAOrgInfoSchema.partial().optional(),
  documents: z.never().optional(),
})

const signatoryIdentityPatchSchema = z.object({
  step: z.literal('signatory_identity'),
  fields: OrganisationTierASignatorySchema.partial().optional(),
  documents: z.never().optional(),
})

const signatoryDocsPatchSchema = z.object({
  step: z.literal('signatory_docs'),
  fields: z.never().optional(),
  documents: z
    .object({
      nid_front: documentDeclSchema.optional(),
      nid_back: documentDeclSchema.optional(),
      photograph: documentDeclSchema.optional(),
    })
    .optional(),
})

const orgDocsPatchSchema = z.object({
  step: z.literal('org_docs'),
  fields: z.never().optional(),
  documents: z
    .object({
      trade_license: documentDeclSchema.optional(),
      moa: documentDeclSchema.optional(),
      aoa: documentDeclSchema.optional(),
    })
    .optional(),
})

const orgFinancialPatchSchema = z.object({
  step: z.literal('financial'),
  // Same shape as the Individual Tier 1 financial PATCH branch
  // (full schema, not partial — branchName refine doesn't survive
  // .partial() cleanly per Day 16 PR 1 implementation note).
  fields: IndividualTier1FinancialSchema,
  documents: z.never().optional(),
})

export const OrganisationTierAPatchSchema = z.discriminatedUnion('step', [
  orgInfoPatchSchema,
  signatoryIdentityPatchSchema,
  signatoryDocsPatchSchema,
  orgDocsPatchSchema,
  orgFinancialPatchSchema,
])

// ─── Inferred TS types (Org Tier A) ───────────────────────────────────

export type OrganisationTierAOrgInfo = z.infer<typeof OrganisationTierAOrgInfoSchema>
export type OrganisationTierASignatory = z.infer<typeof OrganisationTierASignatorySchema>
export type OrganisationTierASubmission = z.infer<typeof OrganisationTierASubmissionSchema>
export type OrganisationTierAPatch = z.infer<typeof OrganisationTierAPatchSchema>
export type OrganisationTierAStep = OrganisationTierAPatch['step']

// ─── Org step → required-documents map ────────────────────────────────

export const ORGANISATION_TIER_A_STEP_DOCUMENTS: Record<
  OrganisationTierAStep,
  readonly ('nid_front' | 'nid_back' | 'photograph' | 'trade_license' | 'moa' | 'aoa')[]
> = {
  org_info: [],
  signatory_identity: [],
  signatory_docs: ['nid_front', 'nid_back', 'photograph'],
  org_docs: ['trade_license', 'moa', 'aoa'],
  financial: [],
}

export const ORGANISATION_TIER_A_REQUIRED_DOCUMENTS = [
  'nid_front',
  'nid_back',
  'photograph',
  'trade_license',
  'moa',
  'aoa',
] as const

// ─── Org wizard navigation order ──────────────────────────────────────

export const ORGANISATION_TIER_A_STEPS = [
  'org_info',
  'signatory_identity',
  'signatory_docs',
  'org_docs',
  'financial',
  'review',
] as const
export type OrganisationTierAWizardStep = (typeof ORGANISATION_TIER_A_STEPS)[number]

// ═══════════════════════════════════════════════════════════════════════
// Wizard kind discriminator — updated Day 17 to cover both tiers.
// ═══════════════════════════════════════════════════════════════════════

export type WizardVariant = { kind: 'individual_tier1' } | { kind: 'organisation_tier_a' }

/**
 * Pick the wizard variant from the tenant's type. Both variants now
 * supported (Day 16: Individual Tier 1; Day 17: Organisation Tier A).
 */
export function wizardVariantForTenantType(
  tenantType: 'individual' | 'organisation',
): WizardVariant {
  if (tenantType === 'individual') return { kind: 'individual_tier1' }
  return { kind: 'organisation_tier_a' }
}
