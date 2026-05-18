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

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { resetPool, withSuperAdmin, withTenant } from '../../db/client.js'
import { auditLogs, kycSubmissions, tenantUsers, tenants, users } from '../../db/schema/index.js'
import { resetS3Client } from '../../infra/s3/client.js'

// Mock the notification module so we can assert the stub fires the
// expected number of times (route imports this module; vi.mock is
// hoisted so the route's reference resolves to the mock).
vi.mock('../../services/notifications/kyc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/notifications/kyc.js')>()
  return {
    ...actual,
    sendKycSubmittedNotice: vi.fn(actual.sendKycSubmittedNotice),
    sendKycApprovedNotice: vi.fn(actual.sendKycApprovedNotice),
    sendKycRejectedNotice: vi.fn(actual.sendKycRejectedNotice),
  }
})

// Upload-url tests use a fixed-UUID tenant + user fixture seeded into the
// real DB. Sprint 2 Day 15 Item 11 added requireTenantType to the /kyc/*
// routes; that middleware reads `tenants.type` from DB on every request,
// so even the zod-validation cases need a real tenant row with type set.
// Pre-Day-15 these tests ran without DB; now they're gated on DATABASE_URL
// like the Day 14 submit tests below.
const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000002'
const SESSION_ID = 'sess_test_kyc_route'
const SUBMISSION_ID = '11111111-2222-4333-8444-555555555555'

let accessToken: string

const HAS_DB_UPLOAD = Boolean(process.env['DATABASE_URL'])
const describeIfDbUpload = HAS_DB_UPLOAD ? describe : describe.skip

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

  // Seed the upload-url fixture tenant if DB is available. Type set to
  // 'individual' so requireTenantType passes; the tests don't care which
  // type, only that the gate doesn't 409.
  if (HAS_DB_UPLOAD) {
    await withSuperAdmin(async (db) => {
      await db
        .insert(users)
        .values({
          id: USER_ID,
          email: `upload-test-${Date.now()}@test.local`,
          fullName: 'Upload Test User',
        })
        .onConflictDoNothing({ target: users.id })

      await db
        .insert(tenants)
        .values({
          id: TENANT_ID,
          type: 'individual',
          name: 'Upload Test Tenant',
          slug: `upload-test-${Date.now()}`,
          isPersonal: true,
          ownerUserId: USER_ID,
          status: 'active',
        })
        .onConflictDoNothing({ target: tenants.id })

      await db
        .insert(tenantUsers)
        .values({
          tenantId: TENANT_ID,
          userId: USER_ID,
          role: 'owner',
          acceptedAt: new Date(),
        })
        .onConflictDoNothing()
    })
  }
})

afterAll(async () => {
  if (HAS_DB_UPLOAD) {
    await withSuperAdmin(async (db) => {
      await db.delete(auditLogs).where(eq(auditLogs.tenantId, TENANT_ID))
      await db.delete(tenants).where(eq(tenants.id, TENANT_ID))
      await db.delete(users).where(eq(users.id, USER_ID))
    })
  }
})

const validBody = () => ({
  submissionId: SUBMISSION_ID,
  documentType: 'nid_front' as const,
  contentType: 'image/jpeg' as const,
})

describeIfDbUpload('POST /api/v1/tenant/kyc/upload-url', () => {
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

// ─── POST /api/v1/tenant/kyc/submissions (Sprint 2 Day 14 Item 9) ─────
//
// Integration tests against the real DB. Gated by DATABASE_URL so local
// laptops without a Postgres + CI's separate integration-tests job both
// run the right slice. Verifies the atomic write of (kyc_submissions row
// + audit_logs row + notification stub fire) under withTenant context.

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('POST /api/v1/tenant/kyc/submissions', () => {
  const submitFixtures: {
    ownerA?: string
    ownerB?: string
    tenantA?: string
    tenantB?: string
    tokenA?: string
    tokenB?: string
  } = {}

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
    process.env['KYC_BUCKET_NAME'] = 'eventpulse-kyc-test'
    process.env['KYC_KMS_KEY_ARN'] = 'arn:aws:kms:ap-southeast-1:111111111111:key/test-cmk-id'
    process.env['KYC_S3_DRY_RUN'] = '1'
    resetS3Client()

    // Create real tenant fixtures so RLS context resolves.
    const ts = Date.now()
    await withSuperAdmin(async (db) => {
      const [oA] = await db
        .insert(users)
        .values({ email: `submit-owner-a-${ts}@test.local`, fullName: 'Submit Owner A' })
        .returning({ id: users.id })
      const [oB] = await db
        .insert(users)
        .values({ email: `submit-owner-b-${ts}@test.local`, fullName: 'Submit Owner B' })
        .returning({ id: users.id })

      const [tA] = await db
        .insert(tenants)
        .values({
          type: 'individual',
          name: 'Submit Tenant A',
          slug: `submit-a-${ts}`,
          isPersonal: true,
          ownerUserId: oA!.id,
          status: 'active',
        })
        .returning({ id: tenants.id })
      const [tB] = await db
        .insert(tenants)
        .values({
          type: 'individual',
          name: 'Submit Tenant B',
          slug: `submit-b-${ts}`,
          isPersonal: true,
          ownerUserId: oB!.id,
          status: 'active',
        })
        .returning({ id: tenants.id })

      await db.insert(tenantUsers).values([
        { tenantId: tA!.id, userId: oA!.id, role: 'owner', acceptedAt: new Date() },
        { tenantId: tB!.id, userId: oB!.id, role: 'owner', acceptedAt: new Date() },
      ])

      submitFixtures.ownerA = oA!.id
      submitFixtures.ownerB = oB!.id
      submitFixtures.tenantA = tA!.id
      submitFixtures.tenantB = tB!.id
    })

    submitFixtures.tokenA = (
      await signTokens({
        sub: submitFixtures.ownerA!,
        audience: 'tenant',
        tenantId: submitFixtures.tenantA!,
        sessionId: 'sess_submit_test_a',
      })
    ).accessToken

    submitFixtures.tokenB = (
      await signTokens({
        sub: submitFixtures.ownerB!,
        audience: 'tenant',
        tenantId: submitFixtures.tenantB!,
        sessionId: 'sess_submit_test_b',
      })
    ).accessToken
  })

  afterAll(async () => {
    if (submitFixtures.tenantA && submitFixtures.tenantB) {
      await withSuperAdmin(async (db) => {
        // Wipe any audit + kyc rows attributed to these test tenants.
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, submitFixtures.tenantA!))
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, submitFixtures.tenantB!))
        await db.delete(kycSubmissions).where(eq(kycSubmissions.tenantId, submitFixtures.tenantA!))
        await db.delete(kycSubmissions).where(eq(kycSubmissions.tenantId, submitFixtures.tenantB!))
        await db.delete(tenants).where(eq(tenants.id, submitFixtures.tenantA!))
        await db.delete(tenants).where(eq(tenants.id, submitFixtures.tenantB!))
        await db.delete(users).where(eq(users.id, submitFixtures.ownerA!))
        await db.delete(users).where(eq(users.id, submitFixtures.ownerB!))
      })
    }
    await resetPool()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const individualBody = (submissionId: string) => ({
    submissionId,
    submissionType: 'individual' as const,
    tierRequested: 'tier_1' as const,
    fields: {
      nidNumber: '0000000000',
      bank: {
        accountName: 'Test Person',
        accountNumber: '1234567890',
        bankName: 'Test Bank',
      },
    },
    documents: {
      nid_front: { contentType: 'image/jpeg' as const },
      nid_back: { contentType: 'image/jpeg' as const },
    },
  })

  it('rejects unauthenticated requests with 401', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(individualBody('22222222-3333-4444-8555-666666666601')),
    })
    expect(res.status).toBe(401)
  })

  it('happy path: creates a row, writes one audit_logs row, fires sendKycSubmittedNotice once', async () => {
    const { sendKycSubmittedNotice } = await import('../../services/notifications/kyc.js')
    const submissionId = '22222222-3333-4444-8555-666666666602'
    const app = createApp()

    const res = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify(individualBody(submissionId)),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      data: { id: string; status: string; tenantId: string; documents: Record<string, string> }
    }
    expect(body.data.id).toBe(submissionId)
    expect(body.data.status).toBe('submitted')
    expect(body.data.tenantId).toBe(submitFixtures.tenantA!)
    // documents jsonb should map documentType → s3://bucket/tenants/{tenantA}/kyc/{submissionId}/...
    expect(body.data.documents['nid_front']).toBe(
      `s3://eventpulse-kyc-test/tenants/${submitFixtures.tenantA}/kyc/${submissionId}/nid_front.jpg`,
    )
    expect(body.data.documents['nid_back']).toBe(
      `s3://eventpulse-kyc-test/tenants/${submitFixtures.tenantA}/kyc/${submissionId}/nid_back.jpg`,
    )

    // Audit row written under the same tx (read back via tenant context).
    const audit = await withTenant(submitFixtures.tenantA!, async (db) =>
      db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, submissionId),
            eq(auditLogs.action, 'kyc_submission.transition'),
          ),
        ),
    )
    expect(audit.length).toBe(1)
    expect(audit[0]!.actorType).toBe('tenant_user')
    expect(audit[0]!.actorId).toBe(submitFixtures.ownerA!)
    expect((audit[0]!.diff as { from: unknown; to: unknown }).from).toBeNull()
    expect((audit[0]!.diff as { from: unknown; to: unknown }).to).toBe('submitted')

    // Notification stub fired once with the right payload shape.
    expect(vi.mocked(sendKycSubmittedNotice)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendKycSubmittedNotice)).toHaveBeenCalledWith({
      tenantId: submitFixtures.tenantA!,
      submissionId,
    })
  })

  it('idempotent: same submissionId returns 200 + same row + no extra audit row + no extra notification', async () => {
    const { sendKycSubmittedNotice } = await import('../../services/notifications/kyc.js')
    const submissionId = '22222222-3333-4444-8555-666666666603'
    const app = createApp()
    const body = individualBody(submissionId)

    const first = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify(body),
    })
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as { data: { id: string } }

    // Fire again with the same submissionId. The server should detect
    // the PK collision, return the existing row, and skip audit/notify.
    const second = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify(body),
    })
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { data: { id: string } }
    expect(secondBody.data.id).toBe(firstBody.data.id)

    // Exactly ONE audit row for this submission across both submits.
    const audit = await withTenant(submitFixtures.tenantA!, async (db) =>
      db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, submissionId),
            eq(auditLogs.action, 'kyc_submission.transition'),
          ),
        ),
    )
    expect(audit.length).toBe(1)

    // Notification fired exactly once (first request only).
    expect(vi.mocked(sendKycSubmittedNotice)).toHaveBeenCalledTimes(1)
  })

  it('cross-tenant submissionId conflict returns 409 (tenant B cannot take tenant A submissionId)', async () => {
    const submissionId = '22222222-3333-4444-8555-666666666604'
    const app = createApp()
    const body = individualBody(submissionId)

    // Tenant A claims the id first.
    const first = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify(body),
    })
    expect(first.status).toBe(201)

    // Tenant B tries the same id — RLS forbids reading tenant A's row
    // and the PK collision routes through the SubmissionIdInUseError
    // path → 409.
    const second = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenB}`,
      },
      body: JSON.stringify(body),
    })
    expect(second.status).toBe(409)
    const errBody = (await second.json()) as { error: { code: string } }
    expect(errBody.error.code).toBe('CONFLICT')
  })

  it('JWT tenantId is authoritative — body-supplied tenantId is ignored by zod strip', async () => {
    const submissionId = '22222222-3333-4444-8555-666666666605'
    const app = createApp()
    const body = {
      ...individualBody(submissionId),
      // Smuggle a tenantId; zod's default strip removes it.
      tenantId: submitFixtures.tenantB!,
    }
    const res = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(201)
    const data = (await res.json()) as {
      data: { tenantId: string; documents: Record<string, string> }
    }
    expect(data.data.tenantId).toBe(submitFixtures.tenantA!)
    // Document URIs use JWT tenantId, NOT the smuggled body value.
    expect(data.data.documents['nid_front']).toContain(`/tenants/${submitFixtures.tenantA}/`)
    expect(data.data.documents['nid_front']).not.toContain(submitFixtures.tenantB!)
  })

  it('validation: rejects individual body using an org tier with 400', async () => {
    const app = createApp()
    const submissionId = '22222222-3333-4444-8555-666666666606'
    const res = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify({
        ...individualBody(submissionId),
        tierRequested: 'org_a',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('validation: rejects body missing bank.accountNumber with 400', async () => {
    const app = createApp()
    const submissionId = '22222222-3333-4444-8555-666666666607'
    const body = individualBody(submissionId)
    const malformed = {
      ...body,
      fields: {
        ...body.fields,
        bank: { accountName: 'X', bankName: 'Y' }, // accountNumber missing
      },
    }
    const res = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify(malformed),
    })
    expect(res.status).toBe(400)
  })

  it('validation: rejects empty documents map with 400', async () => {
    const app = createApp()
    const submissionId = '22222222-3333-4444-8555-666666666608'
    const body = { ...individualBody(submissionId), documents: {} }
    const res = await app.request('/api/v1/tenant/kyc/submissions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submitFixtures.tokenA}`,
      },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(400)
  })
})
