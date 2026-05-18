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

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { requireTenantAuth } from '../../auth/middleware.js'
import { withTenant } from '../../db/client.js'
import { tenants } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'

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

export { me as meRoutes }
