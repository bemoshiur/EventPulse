/**
 * Route-shape tests for POST /api/v1/tenant/kyc/upload-url.
 *
 * Uses KYC_S3_DRY_RUN=1 mode on the S3 client — exercises every code path
 * up to the AWS call, then returns a synthetic URL. No mocking of the
 * SDK required; the dry-run flag is the test seam.
 *
 * Auth: mints a real tenant-context access token via signTokens, so the
 * requireTenantAuth middleware exercises the full JWT verification path
 * (no shortcuts).
 *
 * What this file DOES NOT test:
 *   - The actual presigning maths (covered by AWS SDK's own tests)
 *   - The bucket policy enforcement (covered by the Item 6 live negative
 *     tests on staging; can't be re-run from unit tests)
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { resetS3Client } from '../../infra/s3/client.js'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000002'
const SESSION_ID = 'sess_test_kyc_route'
const SUBMISSION_ID = '11111111-2222-4333-8444-555555555555'

let accessToken: string

beforeAll(async () => {
  process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
  process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
  process.env['KYC_BUCKET_NAME'] = 'eventpulse-kyc-test'
  process.env['KYC_KMS_KEY_ARN'] = 'arn:aws:kms:ap-southeast-1:111111111111:key/test-cmk-id'
  process.env['KYC_S3_DRY_RUN'] = '1'
  resetS3Client()

  const tokens = await signTokens({
    sub: USER_ID,
    audience: 'tenant',
    tenantId: TENANT_ID,
    sessionId: SESSION_ID,
  })
  accessToken = tokens.accessToken
})

const validBody = () => ({
  submissionId: SUBMISSION_ID,
  documentType: 'nid_front' as const,
  contentType: 'image/jpeg' as const,
})

describe('POST /api/v1/tenant/kyc/upload-url', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody()),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AUTH_REQUIRED')
  })

  it('rejects super-admin token with 403 (wrong audience)', async () => {
    const adminTokens = await signTokens({
      sub: USER_ID,
      audience: 'super-admin',
      tenantId: null,
      sessionId: SESSION_ID,
    })
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminTokens.accessToken}`,
      },
      body: JSON.stringify(validBody()),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('rejects body missing submissionId with 400', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ documentType: 'nid_front', contentType: 'image/jpeg' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects body with non-UUID submissionId', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        submissionId: 'not-a-uuid',
        documentType: 'nid_front',
        contentType: 'image/jpeg',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects body with unknown documentType', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        ...validBody(),
        documentType: 'passport_front_cover',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects body with non-whitelisted contentType', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        ...validBody(),
        contentType: 'image/heic',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('returns a signed URL + required headers for a valid request (dry-run)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(validBody()),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        uploadUrl: string
        key: string
        expiresIn: number
        requiredHeaders: Record<string, string>
        dryRun: boolean
      }
    }
    expect(body.data.dryRun).toBe(true)
    expect(body.data.uploadUrl).toContain('dry-run.invalid')
    expect(body.data.expiresIn).toBe(300)
    expect(body.data.key).toBe(`tenants/${TENANT_ID}/kyc/${SUBMISSION_ID}/nid_front.jpg`)
    // Required headers MUST include SSE-KMS + key-id headers — otherwise
    // the bucket policy (Item 6) denies the PUT.
    expect(body.data.requiredHeaders['x-amz-server-side-encryption']).toBe('aws:kms')
    expect(body.data.requiredHeaders['x-amz-server-side-encryption-aws-kms-key-id']).toBe(
      process.env['KYC_KMS_KEY_ARN'],
    )
    expect(body.data.requiredHeaders['Content-Type']).toBe('image/jpeg')
  })

  it('signs each document_type into its own key path (no key collisions across doc types)', async () => {
    const app = createApp()
    const types = ['nid_front', 'nid_back', 'etin_certificate', 'photograph'] as const
    const keys = new Set<string>()
    for (const dt of types) {
      const res = await app.request('/api/v1/tenant/kyc/upload-url', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ ...validBody(), documentType: dt }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { key: string } }
      keys.add(body.data.key)
    }
    expect(keys.size).toBe(types.length)
  })

  it('uses the tenant_id from the JWT, NOT any client-supplied value', async () => {
    const app = createApp()
    // Add a malicious `tenantId` field; the server should silently ignore it
    // (zod strips unknown keys by default).
    const res = await app.request('/api/v1/tenant/kyc/upload-url', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        ...validBody(),
        tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { key: string } }
    // Key prefix MUST be the JWT's tenant id, not the body's.
    expect(body.data.key.startsWith(`tenants/${TENANT_ID}/`)).toBe(true)
    expect(body.data.key.includes('aaaaaaaa-bbbb')).toBe(false)
  })
})
