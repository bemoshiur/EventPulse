/**
 * KYC routes — tenant context. Mounted at /api/v1/tenant/kyc.
 *
 * Sprint 2 Day 13 Item 8 shipped the upload-URL endpoint.
 * Sprint 2 Day 14 Item 9 adds the submit endpoint that finalises a
 * submission after the client has uploaded its documents via the
 * presigned URLs.
 *
 * Surface (today):
 *   POST /upload-url      — generate a presigned PUT URL for one document
 *   POST /submissions     — finalise a submission (state: draft → submitted)
 *
 * Item 10 (eTIN regex + BFIU sanctions matcher) deferred to Phase 2 per
 * decisions.md 2026-05-17 "Sprint 2 Item 10 scope amendment — third-
 * party verification deferred to manual review". eTIN and NID are
 * captured as plain strings in `fields`; reviewer validates manually.
 *
 * Auth: requireTenantAuth — caller MUST be acting in a tenant context.
 *       The tenant_id in the JWT is the only acceptable source for the
 *       row's tenant_id; client-supplied tenantId would let a tenant
 *       write a submission attributed to another tenant.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { requireTenantType } from '../../auth/tenant-type-gate.js'
import { withTenant } from '../../db/client.js'
import { kycSubmissions } from '../../db/schema/index.js'
import {
  ALLOWED_CONTENT_TYPES,
  KYC_DOCUMENT_TYPES,
  buildKycObjectUri,
  getKycUploadUrl,
  type KycDocumentType,
} from '../../infra/s3/client.js'
import { logger } from '../../lib/logger.js'
import { writeKycTransition } from '../../services/audit/kyc.js'
import { sendKycSubmittedNotice } from '../../services/notifications/kyc.js'

const kyc = new Hono()

kyc.use('*', requireTenantAuth)
// requireTenantType MUST come AFTER requireTenantAuth (it reads
// c.get('tenantId') which the auth middleware populates). KYC routes
// gate on type-set per Sprint 2 Day 15 Item 11: a tenant cannot start
// uploading KYC documents or finalising a submission until they've
// picked Individual or Organisation, because the wizard variant (Item
// 12, Days 16-17) renders different required documents per type.
kyc.use('*', requireTenantType)

// ─── /upload-url (Day 13 Item 8) ──────────────────────────────────────

const uploadUrlSchema = z.object({
  // Client-generated UUID v4. Server enforces the tenant_id prefix from
  // the JWT, so a client cannot scope a URL to another tenant — but the
  // client owns the submission_id namespace within its tenant. The
  // submit endpoint uses the same submission_id as the row PK so
  // the upload-url step + submit step share an identity.
  submissionId: z.string().uuid(),
  documentType: z.enum(KYC_DOCUMENT_TYPES),
  contentType: z.enum(Object.keys(ALLOWED_CONTENT_TYPES) as [string, ...string[]]),
})

kyc.post('/upload-url', zValidator('json', uploadUrlSchema), async (c) => {
  const input = c.req.valid('json')
  // requireTenantAuth (above) sets `tenantId` from the verified JWT
  // claim, so by the time this handler runs tenantId is guaranteed
  // present. Defence-in-depth re-check below — if a future middleware
  // change ever made the var optional, fail closed before signing a URL
  // against a missing prefix.
  const tenantId = c.get('tenantId')
  if (!tenantId) {
    return c.json(
      {
        error: {
          code: 'AUTH_REQUIRED',
          message: 'tenant context required',
          request_id: c.req.header('x-request-id') ?? null,
        },
      },
      401,
    )
  }

  try {
    const result = await getKycUploadUrl({
      tenantId,
      submissionId: input.submissionId,
      documentType: input.documentType,
      // Cast: the zod enum is widened to string for the schema declaration
      // (Object.keys returns string[]), but the runtime value is always
      // one of ALLOWED_CONTENT_TYPES' keys.
      contentType: input.contentType as keyof typeof ALLOWED_CONTENT_TYPES,
    })
    return c.json({ data: result })
  } catch (err) {
    logger.error({ err, tenantId, documentType: input.documentType }, 'kyc upload-url failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to generate upload URL',
          request_id: c.req.header('x-request-id') ?? null,
        },
      },
      500,
    )
  }
})

// ─── /submissions (Day 14 Item 9) ─────────────────────────────────────
//
// Finalises a submission after the client has uploaded all required
// documents via presigned URLs from /upload-url. The submission_id
// the client used for the upload-url calls is reused here as the
// kyc_submissions row PK so:
//   1. Server can regenerate S3 keys deterministically (never trusts
//      client-supplied keys; tenant_id always from JWT).
//   2. Idempotency is natural: a double-submit hits PK collision,
//      returns the existing row, fires no extra audit/notification.

/**
 * Per-type body shape. Fields are captured as plain strings (no regex
 * enforcement per Item 10 amendment); the per-tier zod schema tightening
 * that ships with the Item 12 wizard (Day 16-17) replaces this minimal
 * shape with the wizard's authoritative schema.
 */
const individualFieldsSchema = z.object({
  nidNumber: z.string().trim().min(1).max(20),
  etinNumber: z.string().trim().min(1).max(20).optional(),
  bank: z.object({
    accountName: z.string().trim().min(1),
    accountNumber: z.string().trim().min(1),
    bankName: z.string().trim().min(1),
    branchName: z.string().trim().optional(),
    routingNumber: z.string().trim().optional(),
  }),
})

const orgFieldsSchema = z.object({
  tradeLicenseNumber: z.string().trim().min(1),
  bin: z.string().trim().min(1), // BD Business Identification Number (VAT registration)
  etinNumber: z.string().trim().min(1).max(20).optional(),
  authorisedSignatoryNidNumber: z.string().trim().min(1).max(20),
  bank: z.object({
    accountName: z.string().trim().min(1),
    accountNumber: z.string().trim().min(1),
    bankName: z.string().trim().min(1),
    branchName: z.string().trim().optional(),
    routingNumber: z.string().trim().optional(),
  }),
})

const individualTiers = ['tier_1', 'tier_2', 'tier_3'] as const
const orgTiers = ['org_a', 'org_b', 'org_c'] as const

const documentEntrySchema = z.object({
  contentType: z.enum(Object.keys(ALLOWED_CONTENT_TYPES) as [string, ...string[]]),
})

const submissionDocumentsSchema = z
  .record(z.enum(KYC_DOCUMENT_TYPES), documentEntrySchema)
  .refine((docs) => Object.keys(docs).length >= 1, {
    message: 'at least one document required',
  })

const submitSchema = z.discriminatedUnion('submissionType', [
  z.object({
    submissionId: z.string().uuid(),
    submissionType: z.literal('individual'),
    tierRequested: z.enum(individualTiers),
    fields: individualFieldsSchema,
    documents: submissionDocumentsSchema,
  }),
  z.object({
    submissionId: z.string().uuid(),
    submissionType: z.literal('organisation'),
    tierRequested: z.enum(orgTiers),
    fields: orgFieldsSchema,
    documents: submissionDocumentsSchema,
  }),
])

kyc.post('/submissions', zValidator('json', submitSchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const auth = c.get('auth')
  const requestId = c.req.header('x-request-id') ?? null
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = c.req.header('user-agent') ?? null

  if (!tenantId || !auth) {
    return c.json(
      {
        error: { code: 'AUTH_REQUIRED', message: 'tenant context required', request_id: requestId },
      },
      401,
    )
  }

  // Regenerate documents jsonb from the body's declared {documentType, contentType}
  // pairs. Server-derived keys ensure tenant cannot smuggle in another tenant's S3
  // path. Storing the full s3:// URI (not just the key) means the reviewer queue
  // can load documents without knowing the bucket name out-of-band.
  let documents: Record<string, string>
  try {
    documents = Object.fromEntries(
      Object.entries(input.documents).map(([docType, entry]) => [
        docType,
        buildKycObjectUri({
          tenantId,
          submissionId: input.submissionId,
          documentType: docType as KycDocumentType,
          contentType: entry.contentType as keyof typeof ALLOWED_CONTENT_TYPES,
        }),
      ]),
    )
  } catch (err) {
    // buildKycObjectUri throws if KYC_BUCKET_NAME isn't set — surface as INTERNAL_ERROR
    // rather than leaking the env-var name to the client.
    logger.error(
      { err, tenantId, submissionId: input.submissionId },
      'failed to build document URIs',
    )
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'submission storage unavailable',
          request_id: requestId,
        },
      },
      500,
    )
  }

  try {
    const { row, created } = await withTenant(tenantId, async (tx) => {
      // ON CONFLICT DO NOTHING returns no rows when the PK already exists.
      // The follow-up SELECT inside the same tx returns the existing row.
      // Both branches share the tx so the read sees the committed row even
      // under concurrent submits (the loser's RETURNING is empty, the SELECT
      // reads what the winner committed).
      const inserted = await tx
        .insert(kycSubmissions)
        .values({
          id: input.submissionId,
          tenantId,
          submissionType: input.submissionType,
          tierRequested: input.tierRequested,
          documents,
          fields: input.fields,
          status: 'submitted',
        })
        .onConflictDoNothing({ target: kycSubmissions.id })
        .returning()

      if (inserted.length > 0) {
        // Fresh insert — write the birth audit row and fire the notification
        // inside the same tx so a rollback drops both. fromState=null marks
        // the row's creation (the conventional first-write shape per
        // services/audit/kyc.ts).
        await writeKycTransition(tx, {
          submissionId: input.submissionId,
          tenantId,
          fromState: null,
          toState: 'submitted',
          actorUserId: auth.sub,
          actorRole: 'tenant_user',
          ip,
          userAgent,
        })
        return { row: inserted[0]!, created: true }
      }

      // PK collision — load and return the existing row without writing
      // a second audit row or firing a duplicate notification.
      const existing = await tx
        .select()
        .from(kycSubmissions)
        .where(
          and(eq(kycSubmissions.id, input.submissionId), eq(kycSubmissions.tenantId, tenantId)),
        )
        .limit(1)

      if (existing.length === 0) {
        // ON CONFLICT fired (PK exists) but the row isn't visible to this
        // tenant — the only way that happens is another tenant already
        // owns the submissionId (kyc_submissions has no application-layer
        // DELETE path so the row cannot have been hard-deleted between
        // the ON CONFLICT check and this SELECT). Surface as conflict
        // rather than 404; client should generate a fresh UUID and retry.
        throw new SubmissionIdInUseError(input.submissionId)
      }

      return { row: existing[0]!, created: false }
    })

    if (created) {
      // Fire-and-forget the notification AFTER the tx commits. The state
      // change is already durable; a notification failure must NOT roll
      // back the submit or surface as a 500 (the user would see "failed"
      // and retry, while the DB already says "submitted"). Item 16's
      // notification_log row will record the SES send-status
      // independently, so a swallowed error here is recoverable from the
      // logs without re-running the submit.
      sendKycSubmittedNotice({
        tenantId,
        submissionId: input.submissionId,
      }).catch((notifyErr) =>
        logger.error(
          { err: notifyErr, tenantId, submissionId: input.submissionId },
          'kyc submitted notification failed (state change already committed)',
        ),
      )
    }

    return c.json({ data: row }, created ? 201 : 200)
  } catch (err) {
    if (err instanceof SubmissionIdInUseError) {
      return c.json(
        {
          error: {
            code: 'CONFLICT',
            message: 'submissionId already in use; generate a new UUID and retry',
            request_id: requestId,
          },
        },
        409,
      )
    }
    logger.error(
      { err, tenantId, submissionId: input.submissionId },
      'kyc submission create failed',
    )
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to create submission',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

class SubmissionIdInUseError extends Error {
  constructor(public readonly submissionId: string) {
    super(`KYC submission id ${submissionId} already in use`)
    this.name = 'SubmissionIdInUseError'
  }
}

export { kyc as kycRoutes }
