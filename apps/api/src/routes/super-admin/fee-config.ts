/**
 * Super admin tenant fee-config routes — Sprint 3 Day 23 Workstream 2.
 *
 * Per CLAUDE.md §10.4 + §14.4: super-admin-only surface for managing
 * per-tenant platform fee overrides + viewing the change history.
 *
 * Endpoints (mounted at /api/v1/admin/tenants/:tenantId/fees):
 *
 *   GET    /                    — current effective fees + override flag
 *   GET    /history             — paginated fee_override_log
 *   POST   /override            — set platform_fee_bps + default_fee_mode
 *   POST   /override/clear      — reset to platform defaults (25 bps,
 *                                 pass_through)
 *
 * Why mounted under /tenants/:tenantId/fees not /config/fees:
 *   §10.4's spec uses both `admin/tenants/:id/fee-override` (POST) and
 *   `admin/config/fees` (GET/PATCH for platform-wide). Day 23 ships only
 *   the per-tenant surface; the platform-wide config layer (defaults
 *   editable from one place) is a Phase 2 admin tooling deliverable.
 *
 * Auth: requireSuperAdminAuth. The reason field is mandatory for the
 * audit trail per §14.4; the service layer enforces (FeeConfigReason-
 * MissingError) and we map to 400 VALIDATION_ERROR at the route.
 *
 * Response envelope per §6.2.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { FEE_HANDLING_MODES } from '@eventpulse/shared-types'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { logger } from '../../lib/logger.js'
import {
  FeeConfigInvalidBpsError,
  FeeConfigReasonMissingError,
  clearOverride,
  getEffectiveFees,
  getHistory,
  setOverride,
} from '../../services/fee-config/index.js'

const feeConfig = new Hono()
feeConfig.use('*', requireSuperAdminAuth)

const tenantParam = z.object({ tenantId: z.string().uuid() })

const overrideBody = z.object({
  newFeeBps: z.number().int().min(0).max(10000),
  newMode: z.enum(FEE_HANDLING_MODES),
  reason: z.string().trim().min(1).max(500),
  /** ISO datetime; if omitted, server uses NOW. Per §14.4 fee changes
   *  are not retroactive — past timestamps rejected here as a service-
   *  level boundary guard. */
  effectiveFrom: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime())
    .pipe(z.coerce.date())
    .optional(),
  customArrangementNote: z.string().max(1000).nullable().optional(),
})

const clearBody = z.object({
  reason: z.string().trim().min(1).max(500),
})

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

function reqMeta(c: import('hono').Context): {
  requestId: string | null
  ip: string | null
  userAgent: string | null
} {
  return {
    requestId: c.req.header('x-request-id') ?? null,
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  }
}

// ─── GET / ─────────────────────────────────────────────────────────────

feeConfig.get('/', zValidator('param', tenantParam), async (c) => {
  const { tenantId } = c.req.valid('param')
  const { requestId } = reqMeta(c)
  try {
    const fees = await getEffectiveFees(tenantId)
    return c.json({ data: fees })
  } catch (err) {
    logger.error({ err, tenantId, request_id: requestId }, 'fee-config get failed')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to load fee config',
          request_id: requestId,
        },
      },
      500,
    )
  }
})

// ─── GET /history ─────────────────────────────────────────────────────

feeConfig.get(
  '/history',
  zValidator('param', tenantParam),
  zValidator('query', historyQuery),
  async (c) => {
    const { tenantId } = c.req.valid('param')
    const { limit } = c.req.valid('query')
    const { requestId } = reqMeta(c)
    try {
      const history = await getHistory(tenantId, limit)
      return c.json({ data: history })
    } catch (err) {
      logger.error({ err, tenantId, request_id: requestId }, 'fee-config history failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to load fee history',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

// ─── POST /override ───────────────────────────────────────────────────

feeConfig.post(
  '/override',
  zValidator('param', tenantParam),
  zValidator('json', overrideBody),
  async (c) => {
    const { tenantId } = c.req.valid('param')
    const input = c.req.valid('json')
    const auth = c.get('auth')!
    const { requestId, ip, userAgent } = reqMeta(c)

    if (input.effectiveFrom && input.effectiveFrom.getTime() < Date.now() - 60_000) {
      // Per §14.4 not-retroactive rule. 60s grace covers clock skew.
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'effectiveFrom cannot be in the past (§14.4 not-retroactive)',
            details: [{ field: 'effectiveFrom', received: input.effectiveFrom.toISOString() }],
            request_id: requestId,
          },
        },
        400,
      )
    }

    try {
      const result = await setOverride({
        tenantId,
        actorUserId: auth.sub,
        newFeeBps: input.newFeeBps,
        newMode: input.newMode,
        reason: input.reason,
        effectiveFrom: input.effectiveFrom,
        customArrangementNote: input.customArrangementNote ?? undefined,
        ip,
        userAgent,
      })
      return c.json({ data: result }, 201)
    } catch (err) {
      if (err instanceof FeeConfigInvalidBpsError) {
        return c.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: err.message,
              details: [{ field: 'newFeeBps', received: err.bps }],
              request_id: requestId,
            },
          },
          400,
        )
      }
      if (err instanceof FeeConfigReasonMissingError) {
        return c.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: err.message,
              details: [{ field: 'reason' }],
              request_id: requestId,
            },
          },
          400,
        )
      }
      logger.error({ err, tenantId, request_id: requestId }, 'fee-config override failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to set fee override',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

// ─── POST /override/clear ─────────────────────────────────────────────

feeConfig.post(
  '/override/clear',
  zValidator('param', tenantParam),
  zValidator('json', clearBody),
  async (c) => {
    const { tenantId } = c.req.valid('param')
    const { reason } = c.req.valid('json')
    const auth = c.get('auth')!
    const { requestId, ip, userAgent } = reqMeta(c)
    try {
      const result = await clearOverride({
        tenantId,
        actorUserId: auth.sub,
        reason,
        ip,
        userAgent,
      })
      return c.json({ data: result }, 201)
    } catch (err) {
      logger.error({ err, tenantId, request_id: requestId }, 'fee-config clear failed')
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'failed to clear fee override',
            request_id: requestId,
          },
        },
        500,
      )
    }
  },
)

export { feeConfig as feeConfigRoutes }
