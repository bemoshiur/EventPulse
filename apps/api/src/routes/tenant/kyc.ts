/**
 * KYC routes — tenant context. Mounted at /api/v1/tenant/kyc.
 *
 * Sprint 2 Day 13 Item 8 ships only the upload-URL endpoint. The
 * submit + status endpoints land in Day 14 (Items 9 + 10).
 *
 * Surface (today):
 *   POST /upload-url        — generate a presigned PUT URL for one document
 *
 * Auth: requireTenantAuth — caller MUST be acting in a tenant context.
 *       The tenant_id in the JWT is the only acceptable source for the
 *       key prefix; client-supplied tenantId would let a tenant write
 *       to another tenant's path.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import {
  ALLOWED_CONTENT_TYPES,
  KYC_DOCUMENT_TYPES,
  getKycUploadUrl,
} from '../../infra/s3/client.js'
import { logger } from '../../lib/logger.js'

const kyc = new Hono()

kyc.use('*', requireTenantAuth)

const uploadUrlSchema = z.object({
  // Client-generated UUID v4. Server enforces the tenant_id prefix from
  // the JWT, so a client cannot scope a URL to another tenant — but the
  // client owns the submission_id namespace within its tenant. The
  // submit endpoint (Day 14) validates the submission_id is unused
  // before creating the row.
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

export { kyc as kycRoutes }
