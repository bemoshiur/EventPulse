/**
 * KYC-shared constants used by both apps/web and apps/api.
 *
 * Sprint 2 Day 16 Item 12 — moved here from `apps/api/src/infra/s3/client.ts`
 * because `apps/api/src/schemas/kyc.ts` re-exports the per-tier schemas to
 * the frontend (PR 3), and a transitive import of `s3/client.ts` would
 * pull `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` into the
 * browser bundle. The KYC document-type enum and the allowed-content-
 * type map are zero-dependency lookup tables; they belong here so the
 * frontend form layer can render upload widgets without ever touching
 * a Node-only module.
 *
 * Per §3.2: types/constants shared between frontend and backend live
 * in `packages/shared-types`. Per Day 16 /review #1 (confidence 92).
 */

export const ALLOWED_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const

export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES

/**
 * KYC document type enum (Sprint 2 minimal set).
 *
 * Tier 1 individual: nid_front, nid_back, photograph, address_proof
 *   (bank_statement is captured as a text-only set of fields per the
 *    Day 16 wizard spec; reviewer can request bank_statement upload
 *    out-of-band at the Item 13 review queue if needed)
 * Tier 2+ individual: + etin_certificate, + bank_statement
 * Org Tier A/B/C: trade_license, moa, aoa, + above
 *
 * `address_proof` added in Sprint 2 Day 16 Item 12 for the Tier 1
 * wizard's Step 2 (Address); doc-type-agnostic from an S3 perspective.
 */
export const KYC_DOCUMENT_TYPES = [
  'nid_front',
  'nid_back',
  'photograph',
  'address_proof',
  'etin_certificate',
  'bank_statement',
  'trade_license',
  'moa',
  'aoa',
] as const

export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number]
