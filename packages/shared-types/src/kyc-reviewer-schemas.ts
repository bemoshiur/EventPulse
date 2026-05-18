/**
 * Reviewer-side KYC schemas — Sprint 2 Day 18 Item 13.
 *
 * Single source of truth for the super admin KYC review queue's
 * reviewer state. Per `.claude/memory/decisions.md` 2026-05-19
 * "Item 13 super admin KYC review queue — pre-code architecture
 * (Decisions G, H, I)" — particularly Decision I (reviewer checklist
 * as structured tracking).
 *
 * Shared between server (apps/api enforces approve action against
 * required-keys completeness) and frontend (apps/web disables the
 * approve button until required keys are checked). NO PII fields
 * shipped here — only structural metadata + per-tier required-keys
 * vocabulary.
 *
 * Three exports:
 *   - REQUIRED_CHECKLIST_KEYS consts (per tier)
 *   - ReviewerChecklistEntrySchema + ReviewerChecklistSchema
 *   - ReviewerDecisionSchema (discriminated union: approve | reject)
 */

import { z } from 'zod'

// ─── per-tier required checklist keys ──────────────────────────────────
//
// These are the keys the reviewer MUST tick before the approve action
// is allowed at the server. The frontend reads the same arrays to
// compute the approve-button-disabled gate (client convenience; the
// server is the security boundary).
//
// Vocabulary mirrors §13.3 KYC requirements:
//   - Individual Tier 1: NID front/back + selfie, identity cross-checks
//     against NID, address + address-proof doc, bank/MFS account name
//     match + eTIN format reference.
//   - Organisation Tier A: trade license + MOA + AOA documents, BIN
//     format reference, RJSC certificate, authorised signatory
//     identity + selfie + designation + board resolution, bank/MFS
//     account name match + eTIN format reference.
//
// Adding a key here is a schema-level change. The Phase 3 automation
// integrations would land flag artefacts under a separate column; the
// checklist vocabulary stays reviewer-judgment-oriented.

export const INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS = [
  // Documents
  'nid_front',
  'nid_back',
  'selfie',
  // Identity cross-checks against NID image
  'dob_matches_nid',
  'full_name_matches_nid',
  // Address
  'address',
  'address_proof',
  // Financial
  'bank_account_name_match',
  'etin',
] as const

export type IndividualTier1ChecklistKey = (typeof INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS)[number]

export const ORGANISATION_TIER_A_REQUIRED_CHECKLIST_KEYS = [
  // Org documents
  'trade_license',
  'moa',
  'aoa',
  // Org identity
  'bin_format',
  'rjsc_certificate',
  // Signatory
  'signatory_nid_front',
  'signatory_nid_back',
  'signatory_selfie',
  // Authority
  'signatory_designation',
  'board_resolution',
  // Financial
  'bank_account_name_match',
  'etin',
] as const

export type OrganisationTierAChecklistKey =
  (typeof ORGANISATION_TIER_A_REQUIRED_CHECKLIST_KEYS)[number]

/**
 * Compute the required keys for a given tier. Server uses this in the
 * approve action's completeness check; frontend uses it to render the
 * checklist + compute the disabled state.
 */
export function requiredChecklistKeysFor(
  submissionType: 'individual' | 'organisation',
): readonly string[] {
  switch (submissionType) {
    case 'individual':
      return INDIVIDUAL_TIER_1_REQUIRED_CHECKLIST_KEYS
    case 'organisation':
      return ORGANISATION_TIER_A_REQUIRED_CHECKLIST_KEYS
  }
}

// ─── checklist entry + checklist schemas ───────────────────────────────

/**
 * One checklist entry. Reviewer can tick + later untick; each toggle
 * writes its own audit_log row per Decision I. Storage is per-key in
 * the `kyc_submissions.reviewer_checklist` jsonb column.
 *
 * checked_by is the reviewer's user id (not their email or name) so
 * the audit trail joins back to `users` cleanly without staling on a
 * name change.
 */
export const ReviewerChecklistEntrySchema = z.object({
  checked: z.boolean(),
  checkedAt: z.string().datetime(),
  checkedBy: z.string().uuid(),
})
export type ReviewerChecklistEntry = z.infer<typeof ReviewerChecklistEntrySchema>

/**
 * Full per-submission checklist. Keys are free-form so a future
 * non-required key can land (e.g. an optional "phone_verified"
 * checkbox the reviewer ticks when they call the tenant). Required
 * keys are enforced separately via the `requiredChecklistKeysFor`
 * helper at decision time, not at storage time.
 */
export const ReviewerChecklistSchema = z.record(z.string(), ReviewerChecklistEntrySchema)
export type ReviewerChecklist = z.infer<typeof ReviewerChecklistSchema>

// ─── per-key toggle PATCH schema ───────────────────────────────────────
//
// One PATCH per toggle. The server populates checkedAt + checkedBy
// from the request context (timestamp + JWT sub) so the client can't
// fake them.

export const ReviewerChecklistTogglePatchSchema = z.object({
  /** Which key to toggle. The server validates against the tier's
   *  union of required-or-optional keys; an unknown key is 400. */
  key: z.string().min(1).max(64),
  /** New checked state. */
  checked: z.boolean(),
})
export type ReviewerChecklistTogglePatch = z.infer<typeof ReviewerChecklistTogglePatchSchema>

// ─── reviewer notes PATCH schema ───────────────────────────────────────
//
// Single text field; reviewer overwrites the column on each PATCH.
// Audit row diff captures the old + new text truncated to 500 chars
// per Decision I.

export const ReviewerNotesPatchSchema = z.object({
  notes: z.string().max(8000),
})
export type ReviewerNotesPatch = z.infer<typeof ReviewerNotesPatchSchema>

// ─── decision schema (approve | reject discriminated union) ────────────
//
// Server-side: approve requires all required-for-tier checklist keys to
// be checked (returns 409 CHECKLIST_INCOMPLETE with missing keys list
// otherwise). Reject requires a non-empty reason (min 10 chars).
//
// Optional rejection category for downstream analytics (which kinds of
// submissions get rejected most). NOT shown to the tenant (they get
// the reason verbatim).

export const REJECTION_CATEGORIES = [
  'document_quality',
  'data_mismatch',
  'sanctions_concern',
  'incomplete',
  'other',
] as const
export type RejectionCategory = (typeof REJECTION_CATEGORIES)[number]

export const ReviewerDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
  }),
  z.object({
    action: z.literal('reject'),
    reason: z
      .string()
      .min(10, 'reason must be at least 10 characters')
      .max(1000, 'reason must be at most 1000 characters'),
    category: z.enum(REJECTION_CATEGORIES).optional(),
  }),
])
export type ReviewerDecision = z.infer<typeof ReviewerDecisionSchema>

// ─── list-view filter schema ───────────────────────────────────────────
//
// Default status filter is 'submitted' so the queue surfaces work that
// needs triage. Reviewer can switch to 'under_review' (their own
// claimed work), 'approved', 'rejected', or 'draft' (which they should
// never see — tenant-state — but the filter accepts it for completeness).

export const KycSubmissionListFilterSchema = z.object({
  status: z
    .enum(['draft', 'submitted', 'under_review', 'approved', 'rejected'])
    .optional()
    .default('submitted'),
  tier: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})
export type KycSubmissionListFilter = z.infer<typeof KycSubmissionListFilterSchema>
