/**
 * POST /api/v1/tenant/account-type — the one route that runs while
 * `tenants.type` is still NULL.
 *
 * Sprint 2 Day 15 Item 11. Drives the post-login Account-Type modal:
 * the frontend reads `GET /tenant/me` to learn whether type is null,
 * shows the modal if so, and on submit POSTs here. Once this endpoint
 * sets the type, the rest of the tenant portal unblocks via
 * `requireTenantType` middleware.
 *
 * Set-once semantics (decisions.md 2026-05-18 "Tenant account_type is
 * set-once for MVP — change requires support intervention"):
 *
 *   - NULL → 'individual' | 'organisation' : legal first-write.
 *     Returns 201, writes one audit_logs row, fires no notification
 *     (Item 11 has no email surface — the modal disappearing IS the
 *     user-visible confirmation).
 *   - 'X' → 'X' : idempotent. Returns 200 with the existing row and
 *     deliberately writes no second audit row. Protects against
 *     double-clicks, retries on flaky networks, and modal-rehydration
 *     edge cases.
 *   - 'X' → 'Y' where X != Y : type-change attempt. Returns 409
 *     `TENANT_TYPE_ALREADY_SET`. Tenant cannot change type via UI/API;
 *     Phase 2 super admin "change tenant type" action handles
 *     legitimate change requests with the cascading KYC re-review +
 *     fee re-pin + subdomain re-provision logic.
 *
 * Auth: requireTenantAuth ONLY. Deliberately NOT behind requireTenantType
 * (would deadlock — you'd need a type to set a type). Cross-tenant
 * writes are blocked by the RLS UPDATE policy on tenants: even if a
 * tenant somehow got hold of another tenant's id, the UPDATE under
 * `withTenant(callerTenantId)` would affect zero rows (RLS USING clause
 * filters to the caller's row only).
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { withTenant } from '../../db/client.js'
import { tenants } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'
import { writeTenantTypeSet, type TenantType } from '../../services/audit/tenant.js'

const accountType = new Hono()

accountType.use('*', requireTenantAuth)

const bodySchema = z.object({
  type: z.enum(['individual', 'organisation']),
})

class TenantTypeAlreadySetError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly currentType: TenantType,
    public readonly requestedType: TenantType,
  ) {
    super(`tenant ${tenantId} already has type ${currentType}; cannot change to ${requestedType}`)
    this.name = 'TenantTypeAlreadySetError'
  }
}

class TenantRowMissingError extends Error {
  constructor(public readonly tenantId: string) {
    super(`tenant ${tenantId} not visible under withTenant context`)
    this.name = 'TenantRowMissingError'
  }
}

accountType.post('/', zValidator('json', bodySchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const auth = c.get('auth')
  const requestId = c.req.header('x-request-id') ?? null
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = c.req.header('user-agent') ?? null

  if (!tenantId || !auth) {
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
    const result = await withTenant(tenantId, async (tx) => {
      // Read current type under the same tx so the UPDATE below sees
      // a consistent snapshot. The SELECT is RLS-filtered to the caller's
      // tenant row only — if the JWT tenant_id doesn't resolve, we get
      // zero rows and surface TenantRowMissingError.
      const existing = await tx.select({ type: tenants.type }).from(tenants).limit(1)

      if (existing.length === 0) throw new TenantRowMissingError(tenantId)
      const currentType = existing[0]!.type as TenantType | null

      // Idempotent same-type call: return existing without audit duplicate.
      if (currentType === input.type) {
        return { row: existing[0]!, created: false }
      }

      // Type-change attempt: reject with 409.
      if (currentType !== null) {
        throw new TenantTypeAlreadySetError(tenantId, currentType, input.type)
      }

      // First-write: update + audit atomically inside the tx.
      const updated = await tx
        .update(tenants)
        .set({ type: input.type, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning({ type: tenants.type })

      if (updated.length === 0) {
        // RLS rejected the UPDATE — caller's withTenant context doesn't
        // match a tenants row. Same shape as the SELECT-empty case
        // earlier, distinct only in timing; surface uniformly.
        throw new TenantRowMissingError(tenantId)
      }

      await writeTenantTypeSet(tx, {
        tenantId,
        actorUserId: auth.sub,
        fromType: null,
        toType: input.type,
        actorRole: 'tenant_user',
        ip,
        userAgent,
      })

      return { row: updated[0]!, created: true }
    })

    return c.json(
      { data: { tenant: { id: tenantId, type: result.row.type } } },
      result.created ? 201 : 200,
    )
  } catch (err) {
    if (err instanceof TenantTypeAlreadySetError) {
      logger.info(
        {
          tenantId: err.tenantId,
          currentType: err.currentType,
          requestedType: err.requestedType,
          request_id: requestId,
        },
        'tenant type-change attempt rejected (set-once)',
      )
      return c.json(
        {
          error: {
            code: 'TENANT_TYPE_ALREADY_SET',
            message: 'Account type is set-once. Contact support to request a change.',
            request_id: requestId,
          },
        },
        409,
      )
    }
    if (err instanceof TenantRowMissingError) {
      logger.warn(
        { tenantId: err.tenantId, request_id: requestId },
        'tenant row not visible under withTenant context (JWT/DB drift?)',
      )
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
    logger.error({ err, tenantId, request_id: requestId }, 'tenant account-type set failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to set tenant account type',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

export { accountType as accountTypeRoutes }
