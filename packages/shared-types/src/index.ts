/**
 * Shared zod schemas + inferred types used by both apps/web and apps/api.
 * Per §3.2: if a type is used by both frontend and backend, it lives here.
 *
 * Populated as routes and domain entities land. First inhabitant is the
 * Bangladesh division enum (Sprint 2 Day 16 Item 12 — shared by KYC
 * address forms, future tenant profile forms, future event venue forms).
 */

export {
  BD_DIVISIONS,
  BD_DIVISION_LABELS_BN,
  BD_DIVISION_LABELS_EN,
  type BdDivision,
} from './bd.js'

export {
  ALLOWED_CONTENT_TYPES,
  KYC_DOCUMENT_TYPES,
  type AllowedContentType,
  type KycDocumentType,
} from './kyc.js'

// KYC zod schemas — Sprint 2 Day 16 PR 3. Shared between server
// route validation (apps/api/src/routes/tenant/kyc-drafts.ts) and
// frontend react-hook-form resolvers (apps/web/src/components/
// kyc-wizard/...). Single source of truth.
export {
  IndividualTier1AddressSchema,
  IndividualTier1FinancialSchema,
  IndividualTier1IdentitySchema,
  IndividualTier1PatchSchema,
  IndividualTier1SubmissionSchema,
  INDIVIDUAL_TIER1_REQUIRED_DOCUMENTS,
  INDIVIDUAL_TIER1_STEP_DOCUMENTS,
  INDIVIDUAL_TIER1_STEPS,
  wizardVariantForTenantType,
  type IndividualTier1Address,
  type IndividualTier1Financial,
  type IndividualTier1Identity,
  type IndividualTier1Patch,
  type IndividualTier1Step,
  type IndividualTier1Submission,
  type IndividualTier1WizardStep,
  type WizardVariant,
} from './kyc-schemas.js'
