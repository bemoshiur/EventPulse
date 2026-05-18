/**
 * Integration tests for /api/v1/tenant/kyc/drafts router — Sprint 2
 * Day 16 Item 12 Part 1 (Individual Tier 1 backend).
 *
 * Real Postgres + RLS; DATABASE_URL-gated so a laptop without DB skips
 * cleanly and CI's integration job runs them.
 *
 * What this file covers:
 *
 *   POST   /api/v1/tenant/kyc/drafts
 *     - 401 unauthenticated
 *     - 409 TENANT_TYPE_REQUIRED if type not set
 *     - happy path: 201 + draft_created audit row
 *     - idempotent: same submissionId returns 200 + no extra audit
 *     - cross-tenant submissionId collision: 409
 *
 *   GET    /api/v1/tenant/kyc/drafts/:id
 *     - 404 if not found in tenant context
 *     - happy path: row returned with current state
 *     - RLS: tenant A cannot GET tenant B's draft (404)
 *
 *   PATCH  /api/v1/tenant/kyc/drafts/:id
 *     - happy path Step 1 (identity): row updated, audit row written,
 *       documents materialised to S3 URIs
 *     - **Load-bearing test:** Step 2 PATCH preserves Step 1 fields
 *       (Decision A's "Step N PATCH cannot wipe Step <N" invariant)
 *     - invalid step schema returns 400 with field-level issues
 *     - no-op PATCH (same data) does NOT write a duplicate audit row
 *     - 409 if status != 'draft' (cannot PATCH a submitted submission)
 *     - RLS: tenant A cannot PATCH tenant B's draft (404)
 *
 *   POST   /api/v1/tenant/kyc/drafts/:id/submit
 *     - 400 if accumulated state fails full-tier validation
 *     - happy path: complete draft → submitted, kyc_submission.transition
 *       audit row, notification stub fires
 *     - idempotent: re-submit on status='submitted' returns 200, no
 *       extra audit row, no extra notification
 *
 * Cross-tenant safety is verified across endpoints — every endpoint
 * runs the same RLS-negative path so a regression in one's WHERE clause
 * cannot leak through.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { resetPool, withSuperAdmin, withTenant } from '../../db/client.js'
import { auditLogs, kycSubmissions, tenantUsers, tenants, users } from '../../db/schema/index.js'
import { resetS3Client } from '../../infra/s3/client.js'

vi.mock('../../services/notifications/kyc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/notifications/kyc.js')>()
  return {
    ...actual,
    sendKycSubmittedNotice: vi.fn(actual.sendKycSubmittedNotice),
    sendKycApprovedNotice: vi.fn(actual.sendKycApprovedNotice),
    sendKycRejectedNotice: vi.fn(actual.sendKycRejectedNotice),
  }
})

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('/api/v1/tenant/kyc/drafts router (Item 12)', () => {
  const fix: {
    ownerA?: string
    ownerB?: string
    tenantA?: string
    tenantB?: string
    tenantNoType?: string
    ownerNoType?: string
    tokenA?: string
    tokenB?: string
    tokenNoType?: string
  } = {}

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
    process.env['KYC_BUCKET_NAME'] = 'eventpulse-kyc-test'
    process.env['KYC_KMS_KEY_ARN'] = 'arn:aws:kms:ap-southeast-1:111111111111:key/test-cmk-id'
    process.env['KYC_S3_DRY_RUN'] = '1'
    resetS3Client()

    const ts = Date.now()
    await withSuperAdmin(async (db) => {
      const [oA] = await db
        .insert(users)
        .values({ email: `drafts-owner-a-${ts}@test.local`, fullName: 'Drafts Owner A' })
        .returning({ id: users.id })
      const [oB] = await db
        .insert(users)
        .values({ email: `drafts-owner-b-${ts}@test.local`, fullName: 'Drafts Owner B' })
        .returning({ id: users.id })
      const [oNT] = await db
        .insert(users)
        .values({ email: `drafts-owner-nt-${ts}@test.local`, fullName: 'Drafts Owner NoType' })
        .returning({ id: users.id })

      const [tA] = await db
        .insert(tenants)
        .values({
          type: 'individual',
          name: 'Drafts Tenant A',
          slug: `drafts-a-${ts}`,
          isPersonal: true,
          ownerUserId: oA!.id,
          status: 'active',
        })
        .returning({ id: tenants.id })
      const [tB] = await db
        .insert(tenants)
        .values({
          type: 'individual',
          name: 'Drafts Tenant B',
          slug: `drafts-b-${ts}`,
          isPersonal: true,
          ownerUserId: oB!.id,
          status: 'active',
        })
        .returning({ id: tenants.id })
      // Tenant with NULL type — exercises the requireTenantType 409.
      const [tNT] = await db
        .insert(tenants)
        .values({
          type: null,
          name: 'Drafts Tenant NoType',
          slug: `drafts-nt-${ts}`,
          isPersonal: true,
          ownerUserId: oNT!.id,
          status: 'pending_kyc',
        })
        .returning({ id: tenants.id })

      await db.insert(tenantUsers).values([
        { tenantId: tA!.id, userId: oA!.id, role: 'owner', acceptedAt: new Date() },
        { tenantId: tB!.id, userId: oB!.id, role: 'owner', acceptedAt: new Date() },
        { tenantId: tNT!.id, userId: oNT!.id, role: 'owner', acceptedAt: new Date() },
      ])

      fix.ownerA = oA!.id
      fix.ownerB = oB!.id
      fix.ownerNoType = oNT!.id
      fix.tenantA = tA!.id
      fix.tenantB = tB!.id
      fix.tenantNoType = tNT!.id
    })

    fix.tokenA = (
      await signTokens({
        sub: fix.ownerA!,
        audience: 'tenant',
        tenantId: fix.tenantA!,
        sessionId: 'sess_drafts_a',
      })
    ).accessToken
    fix.tokenB = (
      await signTokens({
        sub: fix.ownerB!,
        audience: 'tenant',
        tenantId: fix.tenantB!,
        sessionId: 'sess_drafts_b',
      })
    ).accessToken
    fix.tokenNoType = (
      await signTokens({
        sub: fix.ownerNoType!,
        audience: 'tenant',
        tenantId: fix.tenantNoType!,
        sessionId: 'sess_drafts_nt',
      })
    ).accessToken
  })

  afterAll(async () => {
    if (fix.tenantA && fix.tenantB && fix.tenantNoType) {
      await withSuperAdmin(async (db) => {
        for (const t of [fix.tenantA!, fix.tenantB!, fix.tenantNoType!]) {
          await db.delete(auditLogs).where(eq(auditLogs.tenantId, t))
          await db.delete(kycSubmissions).where(eq(kycSubmissions.tenantId, t))
          await db.delete(tenants).where(eq(tenants.id, t))
        }
        for (const u of [fix.ownerA!, fix.ownerB!, fix.ownerNoType!]) {
          await db.delete(users).where(eq(users.id, u))
        }
      })
    }
    await resetPool()
  })

  // Wipe drafts + audit between tests so each test starts with a clean
  // slate. Type stays as seeded (individual / null).
  beforeEach(async () => {
    if (fix.tenantA && fix.tenantB && fix.tenantNoType) {
      await withSuperAdmin(async (db) => {
        for (const t of [fix.tenantA!, fix.tenantB!, fix.tenantNoType!]) {
          await db.delete(kycSubmissions).where(eq(kycSubmissions.tenantId, t))
          await db.delete(auditLogs).where(eq(auditLogs.tenantId, t))
        }
      })
    }
  })

  // ─── helpers ────────────────────────────────────────────────────────

  const uuid = () => crypto.randomUUID()

  const validIdentityPatch = (overrides?: Partial<{ fullName: string; nidNumber: string }>) => ({
    step: 'identity' as const,
    fields: {
      fullName: 'Mohammad Rahman',
      dateOfBirth: '1990-05-12',
      nidNumber: '1234567890',
      ...overrides,
    },
    documents: {
      nid_front: { contentType: 'image/jpeg' },
      nid_back: { contentType: 'image/jpeg' },
      photograph: { contentType: 'image/jpeg' },
    },
  })

  const validAddressPatch = () => ({
    step: 'address' as const,
    fields: {
      addressLine1: '12 Road 7, Banani',
      city: 'Dhaka',
      division: 'dhaka' as const,
      postalCode: '1213',
    },
    documents: {
      address_proof: { contentType: 'application/pdf' },
    },
  })

  const validFinancialPatch = () => ({
    step: 'financial' as const,
    fields: {
      accountType: 'bank' as const,
      accountName: 'Mohammad Rahman',
      accountNumber: '12345678901',
      branchName: 'Banani',
      etinNumber: '1234567890',
    },
  })

  // ─── POST / ─────────────────────────────────────────────────────────

  describe('POST /api/v1/tenant/kyc/drafts', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const app = createApp()
      const res = await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submissionId: uuid() }),
      })
      expect(res.status).toBe(401)
    })

    it('returns 409 TENANT_TYPE_REQUIRED when the tenant has no type set', async () => {
      const app = createApp()
      const res = await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fix.tokenNoType}`,
        },
        body: JSON.stringify({ submissionId: uuid() }),
      })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('TENANT_TYPE_REQUIRED')
    })

    it('happy path: 201 + writes one draft_created audit row', async () => {
      const subId = uuid()
      const app = createApp()
      const res = await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fix.tokenA}`,
        },
        body: JSON.stringify({ submissionId: subId }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as {
        data: { id: string; status: string; submissionType: string; tierRequested: string }
      }
      expect(body.data.id).toBe(subId)
      expect(body.data.status).toBe('draft')
      expect(body.data.submissionType).toBe('individual')
      expect(body.data.tierRequested).toBe('tier_1')

      const audit = await withTenant(fix.tenantA!, (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, subId),
              eq(auditLogs.action, 'kyc_submission.draft_created'),
            ),
          ),
      )
      expect(audit.length).toBe(1)
      expect(audit[0]!.actorType).toBe('tenant_user')
      expect(audit[0]!.actorId).toBe(fix.ownerA)
    })

    it('idempotent: same submissionId returns 200 + no extra audit row', async () => {
      const subId = uuid()
      const app = createApp()
      const body = JSON.stringify({ submissionId: subId })
      const first = await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body,
      })
      expect(first.status).toBe(201)
      const second = await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body,
      })
      expect(second.status).toBe(200)
      const audit = await withTenant(fix.tenantA!, (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, subId),
              eq(auditLogs.action, 'kyc_submission.draft_created'),
            ),
          ),
      )
      expect(audit.length).toBe(1)
    })

    it('cross-tenant submissionId collision returns 409', async () => {
      const subId = uuid()
      const app = createApp()
      // Tenant A claims the id.
      const first = await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      expect(first.status).toBe(201)
      // Tenant B tries to use the same id — PK collides, RLS hides the
      // row, drafts router returns 409 not 500.
      const second = await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenB}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      expect(second.status).toBe(409)
      const body = (await second.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('CONFLICT')
    })
  })

  // ─── GET /:id ───────────────────────────────────────────────────────

  describe('GET /api/v1/tenant/kyc/drafts/:id', () => {
    it('returns 404 if the draft does not exist', async () => {
      const app = createApp()
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${uuid()}`, {
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      expect(res.status).toBe(404)
    })

    it('happy path: returns the draft row', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { id: string; status: string } }
      expect(body.data.id).toBe(subId)
      expect(body.data.status).toBe('draft')
    })

    it("RLS: tenant B cannot read tenant A's draft (404)", async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        headers: { authorization: `Bearer ${fix.tokenB}` },
      })
      expect(res.status).toBe(404)
    })
  })

  // ─── PATCH /:id ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/tenant/kyc/drafts/:id', () => {
    it('happy path Step 1: row updated, audit row written, document URIs materialised', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify(validIdentityPatch()),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { fields: Record<string, unknown>; documents: Record<string, string> }
      }
      const identity = body.data.fields.identity as Record<string, string>
      expect(identity.fullName).toBe('Mohammad Rahman')
      expect(identity.nidNumber).toBe('1234567890')
      // Server materialised the document URIs from the (tenantId,
      // submissionId, docType, contentType) tuple — client never sees
      // the S3 path until it reads it back.
      expect(body.data.documents.nid_front).toMatch(
        new RegExp(
          `^s3://eventpulse-kyc-test/tenants/${fix.tenantA}/kyc/${subId}/nid_front\\.jpg$`,
        ),
      )

      const audit = await withTenant(fix.tenantA!, (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, subId),
              eq(auditLogs.action, 'kyc_submission.draft_updated'),
            ),
          ),
      )
      expect(audit.length).toBe(1)
      const diff = audit[0]!.diff as {
        fields: { added: string[]; updated: string[]; removed: string[] }
      }
      // Added paths include identity sub-keys + document keys.
      expect(diff.fields.added).toEqual(
        expect.arrayContaining([
          'fields.identity.fullName',
          'fields.identity.dateOfBirth',
          'fields.identity.nidNumber',
          'documents.nid_front',
          'documents.nid_back',
          'documents.photograph',
        ]),
      )
      const meta = audit[0]!.metadata as { step?: string }
      expect(meta.step).toBe('identity')
    })

    it('LOAD-BEARING: Step 2 PATCH preserves Step 1 fields', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      // PATCH step 1.
      const p1 = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify(validIdentityPatch()),
      })
      expect(p1.status).toBe(200)
      // PATCH step 2.
      const p2 = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify(validAddressPatch()),
      })
      expect(p2.status).toBe(200)
      const body = (await p2.json()) as {
        data: { fields: Record<string, unknown>; documents: Record<string, string> }
      }
      // Step 1's identity fields MUST still be present.
      const identity = body.data.fields.identity as Record<string, string>
      expect(identity.fullName).toBe('Mohammad Rahman')
      expect(identity.dateOfBirth).toBe('1990-05-12')
      expect(identity.nidNumber).toBe('1234567890')
      // Step 2's address fields are now also present.
      const address = body.data.fields.address as Record<string, string>
      expect(address.addressLine1).toBe('12 Road 7, Banani')
      expect(address.division).toBe('dhaka')
      // Documents from both steps coexist (no wipe of step 1's docs).
      expect(body.data.documents.nid_front).toBeTruthy()
      expect(body.data.documents.address_proof).toBeTruthy()
    })

    it('rejects an invalid step schema with 400 + validation issues', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({
          step: 'identity',
          fields: { fullName: 'X', dateOfBirth: 'not-a-date', nidNumber: 'short' },
        }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string; details?: unknown } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(Array.isArray(body.error.details)).toBe(true)
    })

    it('no-op PATCH (same data twice) does NOT write a duplicate audit row', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      const body = JSON.stringify(validIdentityPatch())
      await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body,
      })
      await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body,
      })
      const audit = await withTenant(fix.tenantA!, (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, subId),
              eq(auditLogs.action, 'kyc_submission.draft_updated'),
            ),
          ),
      )
      // Only the first PATCH writes an audit row; the second is a no-op.
      expect(audit.length).toBe(1)
    })

    it('returns 404 if the draft does not exist', async () => {
      const app = createApp()
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${uuid()}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify(validIdentityPatch()),
      })
      expect(res.status).toBe(404)
    })

    it('returns 409 if the draft has already transitioned out of draft', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      for (const patch of [validIdentityPatch(), validAddressPatch(), validFinancialPatch()]) {
        await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
          body: JSON.stringify(patch),
        })
      }
      await app.request(`/api/v1/tenant/kyc/drafts/${subId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      // Row is now status='submitted'. PATCH must refuse.
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify(validIdentityPatch()),
      })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('CONFLICT')
      expect(body.error.message).toContain("status='submitted'")
    })

    it("RLS: tenant B cannot PATCH tenant A's draft (404)", async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenB}` },
        body: JSON.stringify(validIdentityPatch()),
      })
      expect(res.status).toBe(404)
    })
  })

  // ─── POST /:id/submit ──────────────────────────────────────────────

  describe('POST /api/v1/tenant/kyc/drafts/:id/submit', () => {
    it('returns 400 if the accumulated state fails the full-tier schema', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      // Fill ONLY step 1 — address + financial missing.
      await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify(validIdentityPatch()),
      })
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string; details?: unknown } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(Array.isArray(body.error.details)).toBe(true)
    })

    it('submit-400 details contain no PII substrings (sanitised ZodIssues)', async () => {
      // Per Day 16 /review #2 (medium, confidence 88): the submit
      // endpoint's 400 response runs ZodIssues through
      // sanitiseZodIssues() before echoing. Verify the sanitised
      // payload contains no NID, eTIN, or account-number substrings
      // from the input — even though the current refines don't
      // interpolate values, the test is the regression target for any
      // future refine that might leak values.
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      // Fill all three steps with distinctive PII strings so we can grep
      // the response body for any leak.
      const sentinelNid = '9999987654321'
      const sentinelEtin = '8888877777'
      const sentinelAccount = '7777766655544'
      const identityWithSentinel = {
        ...validIdentityPatch(),
        fields: { ...validIdentityPatch().fields, nidNumber: sentinelNid },
      }
      const financialWithSentinel = {
        ...validFinancialPatch(),
        fields: {
          ...validFinancialPatch().fields,
          etinNumber: sentinelEtin,
          accountNumber: sentinelAccount,
        },
      }
      for (const patch of [identityWithSentinel, validAddressPatch(), financialWithSentinel]) {
        await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
          body: JSON.stringify(patch),
        })
      }
      // Force a validation failure by directly clobbering the row's
      // accumulated fields back to an invalid state via withSuperAdmin.
      // (The wizard endpoints don't let the tenant submit a row that
      // would have been valid then PATCH it back to invalid; this is a
      // narrow test fixture to exercise the submit-400 path with PII
      // already in the row.)
      await withSuperAdmin((db) =>
        db
          .update(kycSubmissions)
          .set({
            // Remove address.line1 to force a tier-schema failure while
            // keeping the sentinel NID/eTIN/account values populated.
            fields: {
              identity: {
                fullName: 'Mohammad Rahman',
                dateOfBirth: '1990-05-12',
                nidNumber: sentinelNid,
              },
              address: { city: 'Dhaka', division: 'dhaka', postalCode: '1213' },
              financial: {
                accountType: 'bank',
                accountName: 'Mohammad Rahman',
                accountNumber: sentinelAccount,
                branchName: 'Banani',
                etinNumber: sentinelEtin,
              },
            },
          })
          .where(eq(kycSubmissions.id, subId)),
      )
      const res = await app.request(`/api/v1/tenant/kyc/drafts/${subId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { details?: unknown } }
      const serialised = JSON.stringify(body)
      expect(serialised).not.toContain(sentinelNid)
      expect(serialised).not.toContain(sentinelEtin)
      expect(serialised).not.toContain(sentinelAccount)
      // The sanitised details array still tells the wizard which step
      // is broken via the `path` field — exactly what the wizard needs
      // to navigate back. Just no values.
      expect(Array.isArray(body.error.details)).toBe(true)
    })

    it('happy path: complete draft → submitted, transition audit row, notification fires', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      for (const patch of [validIdentityPatch(), validAddressPatch(), validFinancialPatch()]) {
        const r = await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
          body: JSON.stringify(patch),
        })
        expect(r.status).toBe(200)
      }
      const submit = await app.request(`/api/v1/tenant/kyc/drafts/${subId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      expect(submit.status).toBe(200)
      const body = (await submit.json()) as { data: { id: string; status: string } }
      expect(body.data.status).toBe('submitted')

      const transitions = await withTenant(fix.tenantA!, (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.entityId, subId), eq(auditLogs.action, 'kyc_submission.transition')),
          ),
      )
      expect(transitions.length).toBe(1)
      const diff = transitions[0]!.diff as { from: string; to: string }
      expect(diff.from).toBe('draft')
      expect(diff.to).toBe('submitted')

      const { sendKycSubmittedNotice } = await import('../../services/notifications/kyc.js')
      expect(vi.mocked(sendKycSubmittedNotice)).toHaveBeenCalledWith({
        tenantId: fix.tenantA!,
        submissionId: subId,
      })
    })

    it('idempotent: re-submit on status=submitted returns 200 + no extra audit + no extra notification', async () => {
      const subId = uuid()
      const app = createApp()
      await app.request('/api/v1/tenant/kyc/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
        body: JSON.stringify({ submissionId: subId }),
      })
      for (const patch of [validIdentityPatch(), validAddressPatch(), validFinancialPatch()]) {
        await app.request(`/api/v1/tenant/kyc/drafts/${subId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${fix.tokenA}` },
          body: JSON.stringify(patch),
        })
      }
      const { sendKycSubmittedNotice } = await import('../../services/notifications/kyc.js')
      vi.mocked(sendKycSubmittedNotice).mockClear()

      const first = await app.request(`/api/v1/tenant/kyc/drafts/${subId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      expect(first.status).toBe(200)
      const second = await app.request(`/api/v1/tenant/kyc/drafts/${subId}/submit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fix.tokenA}` },
      })
      expect(second.status).toBe(200)

      const transitions = await withTenant(fix.tenantA!, (db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.entityId, subId), eq(auditLogs.action, 'kyc_submission.transition')),
          ),
      )
      expect(transitions.length).toBe(1)
      expect(vi.mocked(sendKycSubmittedNotice)).toHaveBeenCalledTimes(1)
    })
  })
})
