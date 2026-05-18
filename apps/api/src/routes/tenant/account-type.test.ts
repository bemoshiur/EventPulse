/**
 * Integration tests for POST /api/v1/tenant/account-type and the
 * requireTenantType gate's effect on /api/v1/tenant/kyc routes —
 * Sprint 2 Day 15 Item 11.
 *
 * Gated by DATABASE_URL so local laptops without Postgres + CI's
 * separate integration-tests job both run the right slice.
 *
 * Tests cover:
 *   - 401 on unauthenticated POST
 *   - happy path: NULL → 'individual' returns 201 + writes one audit row
 *   - idempotency: same-type re-submit returns 200 + no extra audit row
 *   - 409 TENANT_TYPE_ALREADY_SET on type-change attempt
 *   - GET /tenant/me returns the tenant envelope with nullable type
 *   - 409 TENANT_TYPE_REQUIRED from requireTenantType middleware
 *     on /tenant/kyc/upload-url when type is null
 *   - Same /kyc route passes after type is set (gate flips)
 *   - RLS negative: tenant A's POST cannot affect tenant B's row
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { resetPool, withSuperAdmin, withTenant } from '../../db/client.js'
import { auditLogs, tenantUsers, tenants, users } from '../../db/schema/index.js'
import { resetS3Client } from '../../infra/s3/client.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('Tenant account-type (Item 11)', () => {
  const fixtures: {
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
    // KYC env so the kyc routes module loads cleanly when its tests are
    // skipped but the route module imports run for the gate-flip test.
    process.env['KYC_BUCKET_NAME'] = 'eventpulse-kyc-test'
    process.env['KYC_KMS_KEY_ARN'] = 'arn:aws:kms:ap-southeast-1:111111111111:key/test-cmk-id'
    process.env['KYC_S3_DRY_RUN'] = '1'
    resetS3Client()

    const ts = Date.now()
    await withSuperAdmin(async (db) => {
      const [oA] = await db
        .insert(users)
        .values({ email: `acct-owner-a-${ts}@test.local`, fullName: 'Acct Owner A' })
        .returning({ id: users.id })
      const [oB] = await db
        .insert(users)
        .values({ email: `acct-owner-b-${ts}@test.local`, fullName: 'Acct Owner B' })
        .returning({ id: users.id })

      // BOTH tenants start with type = NULL so the gate is meaningful for tests.
      // After Item 11 ships, new tenants created via onboarding will land NULL
      // by default; these test fixtures mirror that future shape.
      const [tA] = await db
        .insert(tenants)
        .values({
          type: null,
          name: 'Acct Tenant A',
          slug: `acct-a-${ts}`,
          isPersonal: true,
          ownerUserId: oA!.id,
          status: 'pending_kyc',
        })
        .returning({ id: tenants.id })
      const [tB] = await db
        .insert(tenants)
        .values({
          type: null,
          name: 'Acct Tenant B',
          slug: `acct-b-${ts}`,
          isPersonal: true,
          ownerUserId: oB!.id,
          status: 'pending_kyc',
        })
        .returning({ id: tenants.id })

      await db.insert(tenantUsers).values([
        { tenantId: tA!.id, userId: oA!.id, role: 'owner', acceptedAt: new Date() },
        { tenantId: tB!.id, userId: oB!.id, role: 'owner', acceptedAt: new Date() },
      ])

      fixtures.ownerA = oA!.id
      fixtures.ownerB = oB!.id
      fixtures.tenantA = tA!.id
      fixtures.tenantB = tB!.id
    })

    fixtures.tokenA = (
      await signTokens({
        sub: fixtures.ownerA!,
        audience: 'tenant',
        tenantId: fixtures.tenantA!,
        sessionId: 'sess_acct_test_a',
      })
    ).accessToken

    fixtures.tokenB = (
      await signTokens({
        sub: fixtures.ownerB!,
        audience: 'tenant',
        tenantId: fixtures.tenantB!,
        sessionId: 'sess_acct_test_b',
      })
    ).accessToken
  })

  afterAll(async () => {
    if (fixtures.tenantA && fixtures.tenantB) {
      await withSuperAdmin(async (db) => {
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, fixtures.tenantA!))
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, fixtures.tenantB!))
        await db.delete(tenants).where(eq(tenants.id, fixtures.tenantA!))
        await db.delete(tenants).where(eq(tenants.id, fixtures.tenantB!))
        await db.delete(users).where(eq(users.id, fixtures.ownerA!))
        await db.delete(users).where(eq(users.id, fixtures.ownerB!))
      })
    }
    await resetPool()
  })

  // Reset each tenant's type to NULL between tests so each test starts
  // from a known clean state. The set-once semantics are enforced at the
  // application layer (POST /account-type's 409); resetting the column
  // directly via withSuperAdmin is legitimate test-fixture maintenance.
  beforeEach(async () => {
    if (fixtures.tenantA && fixtures.tenantB) {
      await withSuperAdmin(async (db) => {
        await db.update(tenants).set({ type: null }).where(eq(tenants.id, fixtures.tenantA!))
        await db.update(tenants).set({ type: null }).where(eq(tenants.id, fixtures.tenantB!))
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, fixtures.tenantA!))
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, fixtures.tenantB!))
      })
    }
  })

  describe('POST /api/v1/tenant/account-type', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const app = createApp()
      const res = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'individual' }),
      })
      expect(res.status).toBe(401)
    })

    it('happy path: NULL → individual returns 201 + writes one audit row', async () => {
      const app = createApp()
      const res = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({ type: 'individual' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        data: { tenant: { id: string; type: string } }
      }
      expect(body.data.tenant.id).toBe(fixtures.tenantA!)
      expect(body.data.tenant.type).toBe('individual')

      const audit = await withTenant(fixtures.tenantA!, async (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.action, 'tenant.type_set'), eq(auditLogs.entityId, fixtures.tenantA!)),
          ),
      )
      expect(audit.length).toBe(1)
      expect(audit[0]!.actorType).toBe('tenant_user')
      expect(audit[0]!.actorId).toBe(fixtures.ownerA!)
      const diff = audit[0]!.diff as { type: { from: unknown; to: unknown } }
      expect(diff.type.from).toBeNull()
      expect(diff.type.to).toBe('individual')
    })

    it('idempotent: same-type re-submit returns 200 + no extra audit row', async () => {
      const app = createApp()
      const body = JSON.stringify({ type: 'individual' })

      const first = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body,
      })
      expect(first.status).toBe(201)

      const second = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body,
      })
      expect(second.status).toBe(200)

      const audit = await withTenant(fixtures.tenantA!, async (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.action, 'tenant.type_set'), eq(auditLogs.entityId, fixtures.tenantA!)),
          ),
      )
      expect(audit.length).toBe(1)
    })

    it('409 TENANT_TYPE_ALREADY_SET on type-change attempt', async () => {
      const app = createApp()

      const first = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({ type: 'individual' }),
      })
      expect(first.status).toBe(201)

      const second = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({ type: 'organisation' }),
      })
      expect(second.status).toBe(409)
      const errBody = (await second.json()) as { error: { code: string } }
      expect(errBody.error.code).toBe('TENANT_TYPE_ALREADY_SET')

      // Type unchanged after the rejected change attempt.
      const audit = await withTenant(fixtures.tenantA!, async (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.action, 'tenant.type_set'), eq(auditLogs.entityId, fixtures.tenantA!)),
          ),
      )
      expect(audit.length).toBe(1)
      expect((audit[0]!.diff as { type: { to: unknown } }).type.to).toBe('individual')
    })

    it('400 on invalid type value', async () => {
      const app = createApp()
      const res = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({ type: 'enterprise' }),
      })
      expect(res.status).toBe(400)
    })

    it('RLS negative: tenant A token cannot set tenant B by smuggling tenant_id in body', async () => {
      // zod strips unknown keys, so adding `tenantId: tenantB` in the body
      // is silently dropped. The endpoint reads tenant_id from the JWT only;
      // tenant A's set call lands on tenant A's row, never tenant B's.
      const app = createApp()
      const res = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({
          type: 'individual',
          tenantId: fixtures.tenantB!,
        }),
      })
      expect(res.status).toBe(201)

      // Tenant B's row is unchanged.
      const tenantBRow = await withSuperAdmin(async (db) =>
        db.select({ type: tenants.type }).from(tenants).where(eq(tenants.id, fixtures.tenantB!)),
      )
      expect(tenantBRow[0]!.type).toBeNull()
    })
  })

  describe('GET /api/v1/tenant/me', () => {
    it('returns tenant envelope with type: null before account-type is set', async () => {
      const app = createApp()
      const res = await app.request('/api/v1/tenant/me', {
        method: 'GET',
        headers: { authorization: `Bearer ${fixtures.tokenA}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { tenant: { id: string; type: string | null; slug: string } }
      }
      expect(body.data.tenant.id).toBe(fixtures.tenantA!)
      expect(body.data.tenant.type).toBeNull()
    })

    it('returns tenant envelope with type set after account-type is set', async () => {
      const app = createApp()
      await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({ type: 'organisation' }),
      })

      const res = await app.request('/api/v1/tenant/me', {
        method: 'GET',
        headers: { authorization: `Bearer ${fixtures.tokenA}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { tenant: { type: string | null } }
      }
      expect(body.data.tenant.type).toBe('organisation')
    })
  })

  describe('requireTenantType gate on /api/v1/tenant/kyc', () => {
    it('returns 409 TENANT_TYPE_REQUIRED when type is null', async () => {
      const app = createApp()
      const res = await app.request('/api/v1/tenant/kyc/upload-url', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({
          submissionId: '33333333-4444-4555-8666-777777777701',
          documentType: 'nid_front',
          contentType: 'image/jpeg',
        }),
      })
      expect(res.status).toBe(409)
      const errBody = (await res.json()) as { error: { code: string } }
      expect(errBody.error.code).toBe('TENANT_TYPE_REQUIRED')
    })

    it('gate flips: same /kyc/upload-url succeeds once type is set', async () => {
      const app = createApp()
      const setRes = await app.request('/api/v1/tenant/account-type', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({ type: 'individual' }),
      })
      expect(setRes.status).toBe(201)

      const uploadRes = await app.request('/api/v1/tenant/kyc/upload-url', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.tokenA}`,
        },
        body: JSON.stringify({
          submissionId: '33333333-4444-4555-8666-777777777702',
          documentType: 'nid_front',
          contentType: 'image/jpeg',
        }),
      })
      expect(uploadRes.status).toBe(200)
      const uploadBody = (await uploadRes.json()) as { data: { dryRun: boolean } }
      expect(uploadBody.data.dryRun).toBe(true)
    })
  })
})
