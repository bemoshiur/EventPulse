/**
 * GET /api/v1/tenant/me — read the current tenant row.
 *
 * Sprint 2 Day 15 Item 11. The post-login Account-Type modal needs a
 * read endpoint to detect whether `tenants.type` is null (modal shows)
 * or set (modal hides). Other tenant routes are gated by
 * `requireTenantType` middleware — this one explicitly is NOT, because
 * the modal cannot detect the null state without a way to read it.
 *
 * Response envelope: `{ tenant: { ... } }` (NOT the raw row). Future
 * additions to this endpoint (current user, permissions, feature flags)
 * become additive sibling fields under the envelope rather than
 * breaking changes to the response shape. Decided at Day 15 plan
 * approval before code began.
 *
 * Auth: requireTenantAuth. The tenant_id comes from the JWT, never from
 * the request body. The withTenant transaction's RLS policy filters to
 * the caller's tenant row only, so this endpoint cannot leak another
 * tenant's row even if a future bug widened the query.
 */

import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { withTenant } from '../../db/client.js'
import { tenants } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'
import { createAssetUploadUrl, UnsupportedAssetTypeError } from '../../infra/s3/assets.js'
import {
  HandleTakenError,
  InvalidHandleError,
  ReservedHandleError,
  renameTenantHandle,
} from '../../services/handles/index.js'

const me = new Hono()

me.use('*', requireTenantAuth)

me.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const requestId = c.req.header('x-request-id') ?? null

  if (!tenantId) {
    return c.json(
      {
        error: {
          code: 'AUTH_REQUIRED',
          message: 'tenant context required',
          request_id: requestId,
        },
      },
      401,
    )
  }

  try {
    // Explicit `.where(eq(tenants.id, tenantId))` even though RLS
    // already filters to the caller's row only — makes the read's
    // correctness visible without tracing into the policy expression
    // and protects against future RLS-policy loosening on the tenants
    // table. Per Day 15 /review finding #1.
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select({
          id: tenants.id,
          type: tenants.type,
          name: tenants.name,
          slug: tenants.slug,
          isPersonal: tenants.isPersonal,
          ownerUserId: tenants.ownerUserId,
          status: tenants.status,
          kycTier: tenants.kycTier,
          kycStatus: tenants.kycStatus,
          brandLogoUrl: tenants.brandLogoUrl,
          brandColorPrimary: tenants.brandColorPrimary,
          brandColorAccent: tenants.brandColorAccent,
          createdAt: tenants.createdAt,
          updatedAt: tenants.updatedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1),
    )

    if (rows.length === 0) {
      // JWT claimed a tenant_id that doesn't exist (or RLS filtered it out,
      // which under withTenant would mean the JWT's tenant_id doesn't
      // match any row visible to that tenant context — i.e., it's wrong).
      // Either way, surface as 404 not 500.
      logger.warn({ tenantId, request_id: requestId }, 'tenant row not found for JWT tenant_id')
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'tenant not found',
            request_id: requestId,
          },
        },
        404,
      )
    }

    return c.json({ data: { tenant: rows[0]! } })
  } catch (err) {
    logger.error({ err, tenantId, request_id: requestId }, 'tenant /me read failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to read tenant context',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

const renameSchema = z.object({ handle: z.string().min(1).max(40) })

/**
 * PATCH /api/v1/tenant/me/handle — rename the current tenant's slug (the
 * `{handle}` in public URLs). For personal tenants the user's handle mirrors
 * it. Writes a 30-day redirect via handle_history (§9.14). Validation +
 * uniqueness + reserved checks live in the handles service.
 */
me.patch('/handle', zValidator('json', renameSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const actorUserId = c.get('auth')?.sub
  const requestId = c.req.header('x-request-id') ?? null

  if (!tenantId || !actorUserId) {
    return c.json(
      {
        error: { code: 'AUTH_REQUIRED', message: 'tenant context required', request_id: requestId },
      },
      401,
    )
  }

  const { handle } = c.req.valid('json')
  try {
    const result = await renameTenantHandle({ tenantId, newSlug: handle, actorUserId })
    return c.json({ data: { slug: result.slug } })
  } catch (err) {
    if (err instanceof InvalidHandleError) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: err.message, request_id: requestId } },
        400,
      )
    }
    if (err instanceof ReservedHandleError) {
      return c.json(
        {
          error: {
            code: 'CONFLICT',
            message: 'That handle is reserved — please choose another.',
            request_id: requestId,
          },
        },
        409,
      )
    }
    if (err instanceof HandleTakenError) {
      return c.json(
        {
          error: {
            code: 'CONFLICT',
            message: 'That handle is already taken — please choose another.',
            request_id: requestId,
          },
        },
        409,
      )
    }
    logger.error({ err, tenantId, request_id: requestId }, 'tenant handle rename failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to rename handle',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour like #d32f2f')
const brandSchema = z
  .object({
    logoUrl: z.string().url().max(1000).nullable().optional(),
    colorPrimary: hexColor.nullable().optional(),
    colorAccent: hexColor.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one brand field is required' })

/**
 * PATCH /api/v1/tenant/me/brand — set the tenant's brand (logo URL + primary +
 * accent hex colours). These drive the public event page hero gradient + logo
 * (event-landing reads them as --brand-primary / --brand-accent). RLS-scoped to
 * the caller's tenant via withTenant.
 */
me.patch('/brand', zValidator('json', brandSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const requestId = c.req.header('x-request-id') ?? null
  if (!tenantId) {
    return c.json(
      {
        error: { code: 'AUTH_REQUIRED', message: 'tenant context required', request_id: requestId },
      },
      401,
    )
  }
  const patch = c.req.valid('json')
  const setObj: Record<string, unknown> = { updatedAt: new Date() }
  if ('logoUrl' in patch) setObj['brandLogoUrl'] = patch.logoUrl
  if ('colorPrimary' in patch) setObj['brandColorPrimary'] = patch.colorPrimary
  if ('colorAccent' in patch) setObj['brandColorAccent'] = patch.colorAccent

  try {
    await withTenant(tenantId, async (tx) =>
      tx.update(tenants).set(setObj).where(eq(tenants.id, tenantId)),
    )
    return c.json({ data: { ok: true } })
  } catch (err) {
    logger.error({ err, tenantId, request_id: requestId }, 'tenant brand update failed')
    return c.json(
      {
        error: { code: 'INTERNAL_ERROR', message: 'failed to update brand', request_id: requestId },
      },
      500,
    )
  }
})

const assetUploadSchema = z.object({
  kind: z.enum(['cover', 'logo']),
  contentType: z.string().min(1).max(100),
})

/**
 * POST /api/v1/tenant/me/assets/upload-url — issue a short-lived presigned PUT
 * for an event cover or tenant logo. The browser uploads the file straight to
 * the public assets bucket, then persists the returned publicUrl on the event
 * (banner) or tenant (brand_logo_url). RLS-scoped key prefix (assets/{tenantId}).
 */
me.post('/assets/upload-url', zValidator('json', assetUploadSchema), async (c) => {
  const tenantId = c.get('tenantId')
  const requestId = c.req.header('x-request-id') ?? null
  if (!tenantId) {
    return c.json(
      {
        error: { code: 'AUTH_REQUIRED', message: 'tenant context required', request_id: requestId },
      },
      401,
    )
  }
  const { kind, contentType } = c.req.valid('json')
  try {
    const target = await createAssetUploadUrl({ tenantId, kind, contentType })
    return c.json({ data: { uploadUrl: target.uploadUrl, publicUrl: target.publicUrl } })
  } catch (err) {
    if (err instanceof UnsupportedAssetTypeError) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Unsupported image type — use PNG, JPG, WebP or SVG.',
            request_id: requestId,
          },
        },
        400,
      )
    }
    logger.error({ err, tenantId, request_id: requestId }, 'asset upload-url failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to create upload URL',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

export { me as meRoutes }
