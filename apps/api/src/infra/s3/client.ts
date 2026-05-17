/**
 * AWS S3 client + KYC upload-URL generator per CLAUDE.md §1.3 R4 + §17.9.
 *
 * The KYC bucket is dedicated, KMS-encrypted with a per-purpose CMK
 * (alias/eventpulse-kyc-<env>), and gated by a bucket policy that
 * REQUIRES every PUT to carry explicit SSE-KMS + key-id headers — see
 * `infra/scripts/kyc-bucket/bucket-policy.json`. The bucket policy was
 * tightened in Sprint 2 Day 12 (PR #64) to reject any PUT without the
 * explicit key-id header (see `.claude/memory/gotchas.md`
 * "S3 bucket policy `StringNotEqualsIfExists` silently permits PUT
 * without the keyed header"). That means presigned URLs we hand to
 * clients MUST sign both `x-amz-server-side-encryption: aws:kms` AND
 * `x-amz-server-side-encryption-aws-kms-key-id: <our CMK ARN>` — the
 * AWS SDK does this when we pass `ServerSideEncryption` + `SSEKMSKeyId`
 * to `PutObjectCommand` before calling `getSignedUrl`.
 *
 * Env:
 *   KYC_BUCKET_NAME     bucket name (from `eventpulse/<env>/kyc` SM entry)
 *   KYC_KMS_KEY_ARN     full CMK ARN (same SM entry)
 *   AWS_REGION          defaults to ap-southeast-1
 *
 * Dev / test mode:
 *   KYC_S3_DRY_RUN=1    returns a synthetic URL without hitting AWS —
 *                       lets local dev + CI integration tests exercise
 *                       routes that call this module without AWS creds
 *                       or a real bucket.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { logger } from '../../lib/logger.js'

// ─── content-type → extension whitelist ──────────────────────────────
// Whitelist is enforced at the route layer (zod) AND echoed here as the
// single source of truth for the extension mapping the signed URL key
// uses. Adding a type means BOTH the zod enum AND this map need updating.

export const ALLOWED_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const

export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES

// ─── document type enum (Sprint 2 minimal set) ────────────────────────
// Tier 1 individual: nid_front, nid_back, photograph, bank_statement
// Tier 2+ individual: + etin_certificate
// Org Tier A/B/C: trade_license, moa, aoa, + above
// Extending in Sprint 2 Day 18 (review queue) when the wizard's per-tier
// requirements solidify.

export const KYC_DOCUMENT_TYPES = [
  'nid_front',
  'nid_back',
  'photograph',
  'etin_certificate',
  'bank_statement',
  'trade_license',
  'moa',
  'aoa',
] as const

export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number]

// ─── client factory + env helpers ─────────────────────────────────────

let _client: S3Client | undefined

function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env['AWS_REGION'] ?? 'ap-southeast-1',
    })
  }
  return _client
}

/** For tests: reset between runs after env mutation. */
export function resetS3Client(): void {
  _client = undefined
}

function requireBucket(): string {
  const bucket = process.env['KYC_BUCKET_NAME']
  if (!bucket) {
    throw new Error(
      'KYC_BUCKET_NAME is not set. Required for any KYC upload code path. ' +
        'Bootstrap script (infra/scripts/bootstrap-staging.sh) materialises this from Secrets Manager.',
    )
  }
  return bucket
}

function requireKmsKeyArn(): string {
  const arn = process.env['KYC_KMS_KEY_ARN']
  if (!arn) {
    throw new Error(
      'KYC_KMS_KEY_ARN is not set. Required for any KYC upload code path. ' +
        'Bootstrap script (infra/scripts/bootstrap-staging.sh) materialises this from Secrets Manager.',
    )
  }
  return arn
}

function isDryRun(): boolean {
  return process.env['KYC_S3_DRY_RUN'] === '1'
}

// ─── upload-URL generator ─────────────────────────────────────────────

export interface KycUploadUrlInput {
  tenantId: string
  submissionId: string
  documentType: KycDocumentType
  contentType: AllowedContentType
}

export interface KycUploadUrlResult {
  uploadUrl: string
  key: string
  expiresIn: number
  /** Headers the client MUST send when PUTing — they're signed into the URL. */
  requiredHeaders: {
    'Content-Type': string
    'x-amz-server-side-encryption': 'aws:kms'
    'x-amz-server-side-encryption-aws-kms-key-id': string
  }
  dryRun: boolean
}

/**
 * Generate a presigned PUT URL for a single KYC document. The signed
 * URL includes the SSE-KMS headers as signed query params, so the
 * client MUST send matching headers when uploading — otherwise S3
 * returns 403 Forbidden (signature mismatch) and the bucket policy
 * denies the PUT (`DenyPutWithWrongKmsKey` / `DenyPutWithoutExplicitKmsKeyId`).
 *
 * Key shape per Checkpoint #2 (decisions.md 2026-05-17):
 *   tenants/{tenantId}/kyc/{submissionId}/{documentType}.{ext}
 *
 * TTL: 5 minutes. Long enough for slow uploads (PDF/multi-MB images on
 * BD broadband) but short enough that a leaked URL can't be replayed
 * indefinitely.
 */
/**
 * Single source of truth for KYC S3 object keys. Used by both the
 * presigned-URL generator and the submit endpoint so client-supplied
 * key fragments can never drift from the server-side construction.
 *
 * Format (per Checkpoint #2, decisions.md 2026-05-17):
 *   tenants/{tenantId}/kyc/{submissionId}/{documentType}.{ext}
 *
 * The tenantId always comes from the JWT (the route layer's
 * responsibility) so a tenant cannot construct a key in another
 * tenant's prefix even if they craft the request body manually.
 */
export function buildKycObjectKey(input: {
  tenantId: string
  submissionId: string
  documentType: KycDocumentType
  contentType: AllowedContentType
}): string {
  const ext = ALLOWED_CONTENT_TYPES[input.contentType]
  return `tenants/${input.tenantId}/kyc/${input.submissionId}/${input.documentType}.${ext}`
}

/** Helper for callers that want the full `s3://bucket/key` URI to store. */
export function buildKycObjectUri(input: Parameters<typeof buildKycObjectKey>[0]): string {
  return `s3://${requireBucket()}/${buildKycObjectKey(input)}`
}

export async function getKycUploadUrl(input: KycUploadUrlInput): Promise<KycUploadUrlResult> {
  const key = buildKycObjectKey(input)
  const kmsKeyArn = requireKmsKeyArn()
  const bucket = requireBucket()
  const expiresIn = 300

  const requiredHeaders = {
    'Content-Type': input.contentType,
    'x-amz-server-side-encryption': 'aws:kms',
    'x-amz-server-side-encryption-aws-kms-key-id': kmsKeyArn,
  } as const

  if (isDryRun()) {
    logger.info(
      {
        bucket,
        key,
        documentType: input.documentType,
        dryRun: true,
      },
      'kyc upload URL (DRY RUN — synthetic URL returned, no AWS call)',
    )
    return {
      uploadUrl: `https://dry-run.invalid/${bucket}/${key}?X-Amz-DryRun=1`,
      key,
      expiresIn,
      requiredHeaders,
      dryRun: true,
    }
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: input.contentType,
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: kmsKeyArn,
  })

  const uploadUrl = await getSignedUrl(client(), command, { expiresIn })

  logger.info(
    {
      bucket,
      key,
      documentType: input.documentType,
      expiresIn,
    },
    'kyc upload URL signed',
  )

  return {
    uploadUrl,
    key,
    expiresIn,
    requiredHeaders,
    dryRun: false,
  }
}
