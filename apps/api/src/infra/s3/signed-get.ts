/**
 * Presigned GET URLs for KYC documents — Sprint 2 Day 18 Item 13.
 *
 * The super admin KYC review queue's detail view surfaces document
 * previews (NID front/back/selfie images, trade-license/MOA/AOA
 * PDFs) inline. The documents live in the dedicated KMS-encrypted
 * KYC bucket per `infra/scripts/setup-kyc-bucket.sh`; direct public
 * access is denied by the bucket policy. The viewer needs short-TTL
 * presigned GET URLs that the reviewer's browser can fetch directly
 * from S3 without proxying through the API.
 *
 * Mirror of `getKycUploadUrl` in `./client.ts` but for GET instead of
 * PUT — the upload path needs SSE-KMS headers signed into the URL so
 * the bucket policy lets the PUT through; the GET path does not (the
 * bucket policy denies WRITE without the headers, not READ).
 *
 * TTL: 15 minutes. Long enough that a reviewer can walk through an
 * entire submission (typical session ~10 min per Decision G's volume
 * model) without the URL expiring mid-review. Short enough that a
 * URL leaked via browser history / a Slack share / a screenshot
 * with the URL bar visible isn't replayable beyond the reviewer's
 * session.
 *
 * Dev / test mode:
 *   KYC_S3_DRY_RUN=1    returns a synthetic URL without hitting AWS —
 *                       lets local dev + CI integration tests exercise
 *                       routes that call this module without AWS creds
 *                       or a real bucket. Matches the existing upload
 *                       helper's convention.
 *
 * IMPORTANT: this helper is only invoked from the super admin context
 * (withSuperAdmin) after the reviewer has been authenticated +
 * authorised by `requireSuperAdminAuth` middleware. The audit row for
 * the detail view (Decision G) is written by the route handler, not
 * here — keeps the S3 helper a pure value-returning function with no
 * side effects on audit_logs.
 */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { logger } from '../../lib/logger.js'

// ─── client factory (mirrors client.ts) ────────────────────────────────

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
export function resetSignedGetClient(): void {
  _client = undefined
}

function requireBucket(): string {
  const bucket = process.env['KYC_BUCKET_NAME']
  if (!bucket) {
    throw new Error(
      'KYC_BUCKET_NAME is not set. Required for any KYC document-read code path. ' +
        'Bootstrap script (infra/scripts/bootstrap-prod.sh) materialises this from Secrets Manager.',
    )
  }
  return bucket
}

function isDryRun(): boolean {
  return process.env['KYC_S3_DRY_RUN'] === '1'
}

// ─── presigned GET URL generator ───────────────────────────────────────

const DEFAULT_EXPIRES_SECONDS = 15 * 60

export interface KycSignedGetInput {
  /**
   * Either an `s3://bucket/key` URI as stored in
   * `kyc_submissions.documents` jsonb, or a bare key like
   * `tenants/<tenantId>/kyc/<submissionId>/<docType>.<ext>`. The
   * helper handles both shapes so callers don't need to parse the
   * URI themselves.
   */
  s3UriOrKey: string
  /** Optional override; defaults to 15 minutes. */
  expiresIn?: number
}

export interface KycSignedGetResult {
  /** Pre-signed HTTPS URL the reviewer's browser can fetch directly. */
  url: string
  /** The S3 key the URL targets (after parsing). */
  key: string
  /** Seconds until expiry; equal to `expiresIn` or its default. */
  expiresIn: number
  dryRun: boolean
}

/**
 * Parse an `s3://bucket/key` URI into its key. Returns the raw key
 * unchanged if no scheme is present.
 *
 * Rejects keys/URIs that point outside the configured KYC bucket so
 * a stored document reference can't smuggle in a key from another
 * bucket. Per Decision G's cross-tenant safety lineage.
 */
function parseS3UriOrKey(input: string): string {
  if (!input.startsWith('s3://')) {
    return input
  }
  const rest = input.slice('s3://'.length)
  const firstSlash = rest.indexOf('/')
  if (firstSlash === -1) {
    throw new Error(`Invalid s3 URI (missing key): ${input}`)
  }
  const bucket = rest.slice(0, firstSlash)
  const key = rest.slice(firstSlash + 1)
  if (!key) {
    throw new Error(`Invalid s3 URI (empty key): ${input}`)
  }
  const expectedBucket = requireBucket()
  if (bucket !== expectedBucket) {
    throw new Error(
      `s3 URI bucket mismatch: got "${bucket}", expected "${expectedBucket}". ` +
        'KYC documents must live in the configured KYC bucket.',
    )
  }
  return key
}

/**
 * Generate a presigned GET URL for a single KYC document. Used by the
 * super admin review queue's detail view to surface inline document
 * previews without proxying bytes through the API.
 */
export async function getKycSignedGetUrl(input: KycSignedGetInput): Promise<KycSignedGetResult> {
  const key = parseS3UriOrKey(input.s3UriOrKey)
  const bucket = requireBucket()
  const expiresIn = input.expiresIn ?? DEFAULT_EXPIRES_SECONDS

  if (isDryRun()) {
    logger.info(
      {
        bucket,
        key,
        dryRun: true,
      },
      'kyc signed GET URL (DRY RUN — synthetic URL returned, no AWS call)',
    )
    return {
      url: `https://dry-run.invalid/${bucket}/${key}?X-Amz-DryRun=1&X-Amz-Expires=${expiresIn}`,
      key,
      expiresIn,
      dryRun: true,
    }
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  const url = await getSignedUrl(client(), command, { expiresIn })

  logger.info({ bucket, key, expiresIn }, 'kyc signed GET URL issued')

  return {
    url,
    key,
    expiresIn,
    dryRun: false,
  }
}

/**
 * Batch helper for the detail view, which typically wants signed URLs
 * for every document on a submission. Sequential rather than parallel
 * because the S3 request-presigner is fast (signing is local; no
 * round-trip) and parallel doesn't help.
 */
export async function getKycSignedGetUrls(
  documents: Record<string, string>,
  expiresIn?: number,
): Promise<Record<string, KycSignedGetResult>> {
  const out: Record<string, KycSignedGetResult> = {}
  for (const [docType, s3UriOrKey] of Object.entries(documents)) {
    out[docType] = await getKycSignedGetUrl({ s3UriOrKey, expiresIn })
  }
  return out
}
