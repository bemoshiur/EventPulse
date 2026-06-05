/**
 * Public event-asset uploads (cover images + tenant logos).
 *
 * Issues a short-lived presigned PUT URL so the browser uploads straight to the
 * public assets bucket (eventpulse-assets-prod-*), then returns the permanent
 * public URL to store on the event (banner_image_url) or tenant (brand_logo_url).
 *
 * Distinct from the KYC bucket (infra/s3/client.ts): KYC docs are KMS-encrypted
 * + reviewer-only; event assets are public-read by design (they render on public
 * event pages). Keys are namespaced per tenant: assets/{tenantId}/...
 *
 * Bucket name comes from ASSETS_BUCKET_NAME, defaulting to the prod bucket so
 * the single-env deploy needs no env change; set the env explicitly when a
 * second environment returns.
 */

import { randomBytes } from 'node:crypto'

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const REGION = process.env['AWS_REGION'] ?? 'ap-southeast-1'
const DEFAULT_ASSETS_BUCKET = 'eventpulse-assets-prod-739275468267'
const UPLOAD_EXPIRES_SECONDS = 300

// Raster formats only. SVG is deliberately excluded: an SVG can embed
// <script>, and these objects are public-read + served with their own
// Content-Type, so a direct hit on the asset URL would execute the script
// (stored XSS / phishing — and same-origin if assets ever move behind a custom
// domain). PNG/JPG/WebP cover every legitimate cover + logo use case.
export const ASSET_CONTENT_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const

export type AssetContentType = keyof typeof ASSET_CONTENT_TYPES
export type AssetKind = 'cover' | 'logo'

export class UnsupportedAssetTypeError extends Error {
  constructor(public readonly contentType: string) {
    super(`unsupported asset content-type: ${contentType}`)
    this.name = 'UnsupportedAssetTypeError'
  }
}

function bucket(): string {
  return process.env['ASSETS_BUCKET_NAME'] ?? DEFAULT_ASSETS_BUCKET
}

let _client: S3Client | undefined
function client(): S3Client {
  if (!_client) _client = new S3Client({ region: REGION })
  return _client
}

export interface AssetUploadTarget {
  uploadUrl: string
  publicUrl: string
  key: string
  expiresIn: number
}

/**
 * Create a presigned PUT for an event asset. The caller (browser) PUTs the file
 * to `uploadUrl` with the same Content-Type, then persists `publicUrl`.
 */
export async function createAssetUploadUrl(input: {
  tenantId: string
  kind: AssetKind
  contentType: string
}): Promise<AssetUploadTarget> {
  const ext = ASSET_CONTENT_TYPES[input.contentType as AssetContentType]
  if (!ext) throw new UnsupportedAssetTypeError(input.contentType)

  const rand = randomBytes(6).toString('hex')
  const key = `assets/${input.tenantId}/${input.kind}-${Date.now()}-${rand}.${ext}`
  const b = bucket()

  const command = new PutObjectCommand({
    Bucket: b,
    Key: key,
    ContentType: input.contentType,
  })
  const uploadUrl = await getSignedUrl(client(), command, { expiresIn: UPLOAD_EXPIRES_SECONDS })
  const publicUrl = `https://${b}.s3.${REGION}.amazonaws.com/${key}`

  return { uploadUrl, publicUrl, key, expiresIn: UPLOAD_EXPIRES_SECONDS }
}
