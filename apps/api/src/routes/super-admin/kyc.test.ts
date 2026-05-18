/**
 * Integration tests for /api/v1/admin/kyc — Sprint 2 Day 18 Item 13.
 *
 * Real Postgres + RLS-bypass under withSuperAdmin; DATABASE_URL-gated so a
 * laptop without DB skips cleanly and CI's integration job runs them.
 *
 * What this file covers (mapped to user brief §2.2 test list):
 *
 *   Auth:
 *     - 401 on missing super admin JWT
 *     - 403 on tenant JWT (correct role gating)
 *
 *   List view:
 *     - Returns submissions in default-status filter
 *     - Pagination cursor works
 *     - No PII in list response (no fields/documents/reviewerNotes)
 *
 *   Detail view (Decision G):
 *     - Returns full submission with signed-GET URLs
 *     - Writes audit row per call
 *     - Two consecutive views write two audit rows (no dedup)
 *     - Self-claims 'submitted' → 'under_review' + writes transition audit
 *
 *   Checklist PATCH (Decision I):
 *     - Valid key toggle persists, audit row written
 *     - Invalid key rejected with 400
 *
 *   Notes PATCH (Decision I):
 *     - Persists, audit row written with truncated diff
 *
 *   Decide approve (Decision I):
 *     - Requires all required keys checked (server-enforced)
 *     - 409 CHECKLIST_INCOMPLETE if any missing, missingKeys list surfaced
 *     - Transitions state, writes 2 audit rows (transition + decision),
 *       fires notification stub
 *     - Idempotent on already-approved
 *
 *   Decide reject:
 *     - Requires reason (min 10 chars)
 *     - Transitions state, writes audit rows, fires notification stub
 *     - Idempotent on already-rejected
 *
 *   Cross-tenant:
 *     - Super admin can read/decide submissions across tenants
 *
 *   State machine:
 *     - Decide on draft is 409
 *     - Decide on submitted-without-self-claim is 409 (force detail-view path)
 *
 *   Conflict of interest:
 *     - Reviewer with prior tenant_user audit on submission is 409 on approve
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  auditLogs,
  kycSubmissions,
  superAdmins,
  tenantUsers,
  tenants,
  users,
} from '../../db/schema/index.js'
import { resetSignedGetClient } from '../../infra/s3/signed-get.js'
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

describeIfDb('/api/v1/admin/kyc router (Item 13)', () => {
  const fix: {
    adminUser?: string
    tenantOwnerA?: string
    tenantOwnerB?: string
    tenantA?: string
    tenantB?: string
    adminToken?: string
    tenantTokenA?: string
    secondAdminUser?: string
    secondAdminToken?: string
    /** Reviewer who participated as the tenant on a submission — used
     *  for the conflict-of-interest test. */
    conflictedAdminUser?: string
    conflictedAdminToken?: string
  } = {}

  const validChecklistFor = (
    submissionType: 'individual' | 'organisation',
    reviewerId: string,
  ): Record<string, { checked: boolean; checkedAt: string; checkedBy: string }> => {
    const keys =
      submissionType === 'individual'
        ? [
            'nid_front',
            'nid_back',
            'selfie',
            'dob_matches_nid',
            'full_name_matches_nid',
            'address',
            'address_proof',
            'bank_account_name_match',
            'etin',
          ]
        : [
            'trade_license',
            'moa',
            'aoa',
            'bin_format',
            'rjsc_certificate',
            'signatory_nid_front',
            'signatory_nid_back',
            'signatory_selfie',
            'signatory_designation',
            'board_resolution',
            'bank_account_name_match',
            'etin',
          ]
    const checklist: Record<string, { checked: boolean; checkedAt: string; checkedBy: string }> = {}
    for (const k of keys) {
      checklist[k] = {
        checked: true,
        checkedAt: new Date().toISOString(),
        checkedBy: reviewerId,
      }
    }
    return checklist
  }

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
    process.env['KYC_BUCKET_NAME'] = 'eventpulse-kyc-test'
    process.env['KYC_KMS_KEY_ARN'] = 'arn:aws:kms:ap-southeast-1:111111111111:key/test-cmk-id'
    process.env['KYC_S3_DRY_RUN'] = '1'
    resetS3Client()
    resetSignedGetClient()

    const ts = Date.now()
    await withSuperAdmin(async (db) => {
      // Two tenant owners.
      const [oA] = await db
        .insert(users)
        .values({ email: `admin-kyc-owner-a-${ts}@test.local`, fullName: 'Owner A' })
        .returning({ id: users.id })
      const [oB] = await db
        .insert(users)
        .values({ email: `admin-kyc-owner-b-${ts}@test.local`, fullName: 'Owner B' })
        .returning({ id: users.id })
      // The super admin reviewer.
      const [admin] = await db
        .insert(users)
        .values({ email: `admin-kyc-admin-${ts}@test.local`, fullName: 'Reviewer' })
        .returning({ id: users.id })
      // A second admin used for the multi-reviewer scenarios.
      const [admin2] = await db
        .insert(users)
        .values({ email: `admin-kyc-admin2-${ts}@test.local`, fullName: 'Reviewer 2' })
        .returning({ id: users.id })
      // An admin who ALSO acted as the tenant on one submission
      // (conflict-of-interest test fixture).
      const [conflictedAdmin] = await db
        .insert(users)
        .values({ email: `admin-kyc-conflict-${ts}@test.local`, fullName: 'Conflicted Admin' })
        .returning({ id: users.id })

      await db
        .insert(superAdmins)
        .values([{ userId: admin!.id }, { userId: admin2!.id }, { userId: conflictedAdmin!.id }])

      const [tA] = await db
        .insert(tenants)
        .values({
          type: 'individual',
          name: 'Admin KYC Tenant A',
          slug: `admin-kyc-a-${ts}`,
          isPersonal: true,
          ownerUserId: oA!.id,
          status: 'pending_kyc',
        })
        .returning({ id: tenants.id })
      const [tB] = await db
        .insert(tenants)
        .values({
          type: 'organisation',
          name: 'Admin KYC Tenant B',
          slug: `admin-kyc-b-${ts}`,
          isPersonal: false,
          ownerUserId: oB!.id,
          status: 'pending_kyc',
        })
        .returning({ id: tenants.id })

      await db.insert(tenantUsers).values([
        { tenantId: tA!.id, userId: oA!.id, role: 'owner', acceptedAt: new Date() },
        { tenantId: tB!.id, userId: oB!.id, role: 'owner', acceptedAt: new Date() },
      ])

      fix.tenantOwnerA = oA!.id
      fix.tenantOwnerB = oB!.id
      fix.adminUser = admin!.id
      fix.secondAdminUser = admin2!.id
      fix.conflictedAdminUser = conflictedAdmin!.id
      fix.tenantA = tA!.id
      fix.tenantB = tB!.id
    })

    fix.adminToken = (
      await signTokens({
        sub: fix.adminUser!,
        audience: 'super-admin',
        tenantId: null,
        sessionId: 'sess_admin',
      })
    ).accessToken
    fix.secondAdminToken = (
      await signTokens({
        sub: fix.secondAdminUser!,
        audience: 'super-admin',
        tenantId: null,
        sessionId: 'sess_admin2',
      })
    ).accessToken
    fix.conflictedAdminToken = (
      await signTokens({
        sub: fix.conflictedAdminUser!,
        audience: 'super-admin',
        tenantId: null,
        sessionId: 'sess_admin_conflict',
      })
    ).accessToken
    fix.tenantTokenA = (
      await signTokens({
        sub: fix.tenantOwnerA!,
        audience: 'tenant',
        tenantId: fix.tenantA!,
        sessionId: 'sess_tenant_a',
      })
    ).accessToken
  })

  afterAll(async () => {
    if (fix.tenantA && fix.tenantB) {
      await withSuperAdmin(async (db) => {
        for (const t of [fix.tenantA!, fix.tenantB!]) {
          await db.delete(auditLogs).where(eq(auditLogs.tenantId, t))
          await db.delete(kycSubmissions).where(eq(kycSubmissions.tenantId, t))
          await db.delete(tenants).where(eq(tenants.id, t))
        }
        for (const u of [
          fix.tenantOwnerA!,
          fix.tenantOwnerB!,
          fix.adminUser!,
          fix.secondAdminUser!,
          fix.conflictedAdminUser!,
        ]) {
          await db.delete(superAdmins).where(eq(superAdmins.userId, u))
          await db.delete(users).where(eq(users.id, u))
        }
      })
    }
    await resetPool()
  })

  beforeEach(async () => {
    if (fix.tenantA && fix.tenantB) {
      await withSuperAdmin(async (db) => {
        for (const t of [fix.tenantA!, fix.tenantB!]) {
          await db.delete(kycSubmissions).where(eq(kycSubmissions.tenantId, t))
          await db.delete(auditLogs).where(eq(auditLogs.tenantId, t))
        }
      })
    }
  })

  const uuid = () => crypto.randomUUID()
  const app = createApp()

  // Seed a submission directly in DB so each test starts from a known
  // status without going through the wizard.
  async function seedSubmission(
    tenantId: string,
    overrides?: {
      status?: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected'
      submissionType?: 'individual' | 'organisation'
      tier?: 'tier_1' | 'org_a'
      fields?: Record<string, unknown>
      documents?: Record<string, string>
      reviewerChecklist?: Record<string, { checked: boolean; checkedAt: string; checkedBy: string }>
    },
  ): Promise<string> {
    const id = uuid()
    await withSuperAdmin(async (db) => {
      await db.insert(kycSubmissions).values({
        id,
        tenantId,
        submissionType: overrides?.submissionType ?? 'individual',
        tierRequested: overrides?.tier ?? 'tier_1',
        status: overrides?.status ?? 'submitted',
        fields: overrides?.fields ?? {
          identity: { fullName: 'Test User', dateOfBirth: '1990-01-01', nidNumber: '1234567890' },
        },
        documents: overrides?.documents ?? {
          nid_front: `s3://eventpulse-kyc-test/tenants/${tenantId}/kyc/${id}/nid_front.jpg`,
        },
        reviewerChecklist: overrides?.reviewerChecklist ?? {},
      })
    })
    return id
  }

  // ─── Auth ─────────────────────────────────────────────────────────────

  describe('auth', () => {
    it('401 on missing super admin JWT (list)', async () => {
      const res = await app.fetch(new Request('http://localhost/api/v1/admin/kyc/submissions'))
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('AUTH_REQUIRED')
    })

    it('403 on tenant JWT (correct role gating)', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/v1/admin/kyc/submissions', {
          headers: { authorization: `Bearer ${fix.tenantTokenA!}` },
        }),
      )
      expect(res.status).toBe(403)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('FORBIDDEN')
    })
  })

  // ─── List view ────────────────────────────────────────────────────────

  describe('list view', () => {
    it('returns submissions in default (submitted) status filter; no PII fields surfaced', async () => {
      await seedSubmission(fix.tenantA!, { status: 'submitted' })
      await seedSubmission(fix.tenantA!, { status: 'approved' }) // out of default filter

      const res = await app.fetch(
        new Request('http://localhost/api/v1/admin/kyc/submissions', {
          headers: { authorization: `Bearer ${fix.adminToken!}` },
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: Array<Record<string, unknown>>
        meta: { nextCursor: string | null; hasMore: boolean }
      }
      expect(body.data.length).toBe(1)
      expect(body.data[0]!['status']).toBe('submitted')
      // No PII / no full fields / no documents / no reviewerNotes
      expect(body.data[0]).not.toHaveProperty('fields')
      expect(body.data[0]).not.toHaveProperty('documents')
      expect(body.data[0]).not.toHaveProperty('reviewerNotes')
      expect(body.data[0]).not.toHaveProperty('reviewerChecklist')
      // Has the structural fields
      expect(body.data[0]).toHaveProperty('id')
      expect(body.data[0]).toHaveProperty('tenantName')
      expect(body.data[0]).toHaveProperty('checkedKeyCount')
    })

    it('list view does NOT write per-row audit (Decision G)', async () => {
      await seedSubmission(fix.tenantA!, { status: 'submitted' })
      await seedSubmission(fix.tenantA!, { status: 'submitted' })

      await app.fetch(
        new Request('http://localhost/api/v1/admin/kyc/submissions', {
          headers: { authorization: `Bearer ${fix.adminToken!}` },
        }),
      )
      const audit = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, fix.tenantA!),
              eq(auditLogs.action, 'kyc_submission.viewed'),
            ),
          ),
      )
      expect(audit.length).toBe(0)
    })

    it('paginates with cursor', async () => {
      // Seed 3 submitted rows, then page with limit=2.
      for (let i = 0; i < 3; i++) {
        await seedSubmission(fix.tenantA!, { status: 'submitted' })
      }
      const res1 = await app.fetch(
        new Request('http://localhost/api/v1/admin/kyc/submissions?limit=2', {
          headers: { authorization: `Bearer ${fix.adminToken!}` },
        }),
      )
      const body1 = (await res1.json()) as {
        data: unknown[]
        meta: { nextCursor: string | null; hasMore: boolean }
      }
      expect(body1.data.length).toBe(2)
      expect(body1.meta.hasMore).toBe(true)
      expect(body1.meta.nextCursor).not.toBeNull()

      const res2 = await app.fetch(
        new Request(
          `http://localhost/api/v1/admin/kyc/submissions?limit=2&cursor=${encodeURIComponent(body1.meta.nextCursor!)}`,
          { headers: { authorization: `Bearer ${fix.adminToken!}` } },
        ),
      )
      const body2 = (await res2.json()) as {
        data: unknown[]
        meta: { nextCursor: string | null; hasMore: boolean }
      }
      expect(body2.data.length).toBe(1)
      expect(body2.meta.hasMore).toBe(false)
    })
  })

  // ─── Detail view (Decision G) ─────────────────────────────────────────

  describe('detail view', () => {
    it('returns full submission with signed-GET URLs; writes audit row per call', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}`, {
          headers: { authorization: `Bearer ${fix.adminToken!}` },
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: {
          id: string
          fields: Record<string, unknown>
          documents: Record<string, string>
          signedDocuments: Record<string, { url: string; expiresIn: number; dryRun: boolean }>
        }
      }
      expect(body.data.id).toBe(id)
      expect(body.data.fields).toBeDefined()
      expect(body.data.signedDocuments['nid_front']?.url).toContain('dry-run.invalid')
      expect(body.data.signedDocuments['nid_front']?.expiresIn).toBeGreaterThan(0)
      expect(body.data.signedDocuments['nid_front']?.dryRun).toBe(true)

      // Audit row written for the read
      const audit = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'kyc_submission.viewed'))),
      )
      expect(audit.length).toBe(1)
      expect(audit[0]!.actorType).toBe('super_admin')
      expect(audit[0]!.actorId).toBe(fix.adminUser)
    })

    it('two consecutive detail-view GETs write TWO audit rows (no dedup, Decision G)', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })
      const url = `http://localhost/api/v1/admin/kyc/submissions/${id}`
      const headers = { authorization: `Bearer ${fix.adminToken!}` }

      await app.fetch(new Request(url, { headers }))
      await app.fetch(new Request(url, { headers }))

      const audit = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'kyc_submission.viewed'))),
      )
      expect(audit.length).toBe(2)
    })

    it("self-claims 'submitted' → 'under_review' on first detail view + writes transition audit", async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'submitted' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}`, {
          headers: { authorization: `Bearer ${fix.adminToken!}` },
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { status: string; reviewerId: string } }
      expect(body.data.status).toBe('under_review')
      expect(body.data.reviewerId).toBe(fix.adminUser)

      // Two audit rows: viewed + transition
      const audit = await withSuperAdmin((db) =>
        db.select().from(auditLogs).where(eq(auditLogs.entityId, id)),
      )
      const actions = audit.map((a) => a.action).sort()
      expect(actions).toEqual(['kyc_submission.transition', 'kyc_submission.viewed'])
    })

    it('returns 404 for non-existent submission', async () => {
      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${uuid()}`, {
          headers: { authorization: `Bearer ${fix.adminToken!}` },
        }),
      )
      expect(res.status).toBe(404)
    })
  })

  // ─── Checklist PATCH (Decision I) ─────────────────────────────────────

  describe('checklist toggle', () => {
    it('valid key toggle persists + writes audit row', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/checklist`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ key: 'nid_front', checked: true }),
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: { reviewerChecklist: Record<string, { checked: boolean; checkedBy: string }> }
      }
      expect(body.data.reviewerChecklist['nid_front']?.checked).toBe(true)
      expect(body.data.reviewerChecklist['nid_front']?.checkedBy).toBe(fix.adminUser)

      const audit = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, id),
              eq(auditLogs.action, 'kyc_submission.checklist_toggled'),
            ),
          ),
      )
      expect(audit.length).toBe(1)
      expect((audit[0]!.diff as { key: string }).key).toBe('nid_front')
    })

    it('invalid key (not in tier vocabulary) returns 400', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/checklist`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ key: 'not_a_real_key', checked: true }),
        }),
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  // ─── Notes PATCH (Decision I) ─────────────────────────────────────────

  describe('notes update', () => {
    it('persists notes + writes audit row with truncated diff', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const longNote = 'A'.repeat(600)
      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/notes`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ notes: longNote }),
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { reviewerNotes: string } }
      expect(body.data.reviewerNotes).toBe(longNote) // Full text in column

      const audit = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'kyc_submission.notes_updated')),
          ),
      )
      expect(audit.length).toBe(1)
      const diff = audit[0]!.diff as {
        to_truncated: string
        to_length: number
      }
      // Truncated to 500 chars (+ trailing ellipsis)
      expect(diff.to_truncated.length).toBeLessThan(600)
      expect(diff.to_length).toBe(600)
    })
  })

  // ─── Decide approve (Decision I) ──────────────────────────────────────

  describe('decide approve', () => {
    it('409 CHECKLIST_INCOMPLETE if any required key is unchecked, missingKeys surfaced', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'approve' }),
        }),
      )
      expect(res.status).toBe(409)
      const body = (await res.json()) as {
        error: { code: string; details?: { missingKeys: string[] } }
      }
      expect(body.error.code).toBe('CHECKLIST_INCOMPLETE')
      expect(body.error.details?.missingKeys).toContain('nid_front')
      expect(body.error.details?.missingKeys).toContain('etin')
    })

    it('approves when all required keys checked; transitions state + writes audit + fires notification', async () => {
      const notifications = await import('../../services/notifications/kyc.js')
      const sendApproved = vi.mocked(notifications.sendKycApprovedNotice)
      sendApproved.mockClear()

      const id = await seedSubmission(fix.tenantA!, {
        status: 'under_review',
        reviewerChecklist: validChecklistFor('individual', fix.adminUser!),
      })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'approve' }),
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { status: string; decidedAt: string } }
      expect(body.data.status).toBe('approved')
      expect(body.data.decidedAt).toBeDefined()

      // Both audit rows: transition + decided
      const audit = await withSuperAdmin((db) =>
        db.select().from(auditLogs).where(eq(auditLogs.entityId, id)),
      )
      const actions = audit.map((a) => a.action).sort()
      expect(actions).toEqual(['kyc_submission.decided', 'kyc_submission.transition'])

      // Notification fired (after tx commits, awaited in test via tick)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sendApproved).toHaveBeenCalledOnce()
    })

    it('idempotent on already-approved (200, no duplicate notification)', async () => {
      const notifications = await import('../../services/notifications/kyc.js')
      const sendApproved = vi.mocked(notifications.sendKycApprovedNotice)
      sendApproved.mockClear()

      const id = await seedSubmission(fix.tenantA!, {
        status: 'approved',
        reviewerChecklist: validChecklistFor('individual', fix.adminUser!),
      })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'approve' }),
        }),
      )
      expect(res.status).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sendApproved).not.toHaveBeenCalled()
    })

    it('cannot decide on submitted (without self-claim) — 409 (force detail-view path)', async () => {
      const id = await seedSubmission(fix.tenantA!, {
        status: 'submitted',
        reviewerChecklist: validChecklistFor('individual', fix.adminUser!),
      })
      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'approve' }),
        }),
      )
      expect(res.status).toBe(409)
    })

    it('cannot decide on draft — 409', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'draft' })
      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'approve' }),
        }),
      )
      expect(res.status).toBe(409)
    })

    it('conflict of interest: reviewer with prior tenant_user audit on submission is 409', async () => {
      const id = await seedSubmission(fix.tenantA!, {
        status: 'under_review',
        reviewerChecklist: validChecklistFor('individual', fix.conflictedAdminUser!),
      })
      // Seed a prior tenant_user audit row by the conflicted admin.
      await withSuperAdmin(async (db) => {
        await db.insert(auditLogs).values({
          tenantId: fix.tenantA!,
          actorType: 'tenant_user',
          actorId: fix.conflictedAdminUser!,
          action: 'kyc_submission.draft_updated',
          entityType: 'kyc_submission',
          entityId: id,
          diff: { fields: { added: [], updated: [], removed: [] } },
          metadata: {},
        })
      })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.conflictedAdminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'approve' }),
        }),
      )
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('CONFLICT_OF_INTEREST')
    })
  })

  // ─── Decide reject ────────────────────────────────────────────────────

  describe('decide reject', () => {
    it('requires reason (min 10 chars) — 400 on short reason', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'reject', reason: 'too short' }),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('rejects with reason; transitions state + fires notification', async () => {
      const notifications = await import('../../services/notifications/kyc.js')
      const sendRejected = vi.mocked(notifications.sendKycRejectedNotice)
      sendRejected.mockClear()

      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'reject',
            reason: 'NID image is too blurry to read the number; please reupload.',
            category: 'document_quality',
          }),
        }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { status: string; decisionReason: string } }
      expect(body.data.status).toBe('rejected')
      expect(body.data.decisionReason).toContain('NID image is too blurry')

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sendRejected).toHaveBeenCalledOnce()
    })

    it('reject does NOT require checklist completeness', async () => {
      const id = await seedSubmission(fix.tenantA!, { status: 'under_review' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'reject',
            reason: 'See note: disqualifying issue surfaced on first document review.',
          }),
        }),
      )
      expect(res.status).toBe(200)
    })

    it('idempotent on already-rejected', async () => {
      const notifications = await import('../../services/notifications/kyc.js')
      const sendRejected = vi.mocked(notifications.sendKycRejectedNotice)
      sendRejected.mockClear()

      const id = await seedSubmission(fix.tenantA!, { status: 'rejected' })

      const res = await app.fetch(
        new Request(`http://localhost/api/v1/admin/kyc/submissions/${id}/decide`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${fix.adminToken!}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'reject',
            reason: 'Repeated rejection should be no-op idempotent.',
          }),
        }),
      )
      expect(res.status).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(sendRejected).not.toHaveBeenCalled()
    })
  })

  // ─── Cross-tenant ─────────────────────────────────────────────────────

  describe('cross-tenant', () => {
    it('super admin can read across tenants (queue surfaces both)', async () => {
      await seedSubmission(fix.tenantA!, {
        status: 'submitted',
        submissionType: 'individual',
        tier: 'tier_1',
      })
      await seedSubmission(fix.tenantB!, {
        status: 'submitted',
        submissionType: 'organisation',
        tier: 'org_a',
      })

      const res = await app.fetch(
        new Request('http://localhost/api/v1/admin/kyc/submissions', {
          headers: { authorization: `Bearer ${fix.adminToken!}` },
        }),
      )
      const body = (await res.json()) as { data: Array<{ tenantId: string }> }
      const tenantIds = body.data.map((r) => r.tenantId)
      expect(tenantIds).toContain(fix.tenantA)
      expect(tenantIds).toContain(fix.tenantB)
    })
  })
})
