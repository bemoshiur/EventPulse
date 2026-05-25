/**
 * Tenant reports route — Sprint 4 Day 33 Phase 1 + Phase 3.
 *
 * Per §10.2:
 *   GET /api/v1/tenant/reports/sales    (Day 33 Phase 1)
 *   GET /api/v1/tenant/reports/payouts  (Day 33 Phase 3)
 *
 * Tenant-staff authed; aggregate reads scoped via withTenant() ↔ RLS.
 * Cross-tenant aggregate isolation is the load-bearing security
 * property; pinned by negative tests in the route's test file.
 *
 * No PII surfaced on these endpoints — only aggregate counts +
 * paisa totals + event/tier metadata. The attendee-list endpoint
 * (Day 32) is the per-attendee PII surface.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireTenantAuth } from '../../auth/middleware.js'
import { logger } from '../../lib/logger.js'
import { getTenantSalesMetrics } from '../../services/reports/sales.js'

export const tenantReportsRoutes = new Hono()

tenantReportsRoutes.use('*', requireTenantAuth)

// ─── helpers (mirrors super-admin/kyc.ts) ──────────────────────────

function envelope<T>(data: T, meta?: Record<string, unknown>) {
  return meta !== undefined ? { data, meta } : { data }
}

function errorEnvelope(code: string, message: string, requestId: string | null) {
  return {
    error: {
      code,
      message,
      request_id: requestId,
    },
  }
}

// ─── GET /sales ─────────────────────────────────────────────────────

const salesQuerySchema = z.object({
  eventId: z.string().uuid().optional(),
  /** Time-series window start (ISO 8601). Defaults to 30 days ago. */
  fromDate: z.string().datetime().optional(),
  /** Time-series window end (ISO 8601). Defaults to now. */
  toDate: z.string().datetime().optional(),
})

tenantReportsRoutes.get('/sales', zValidator('query', salesQuerySchema), async (c) => {
  const query = c.req.valid('query')
  const tenantId = c.get('tenantId') as string
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const result = await getTenantSalesMetrics({
      tenantId,
      ...(query.eventId !== undefined ? { eventId: query.eventId } : {}),
      ...(query.fromDate !== undefined ? { fromDate: new Date(query.fromDate) } : {}),
      ...(query.toDate !== undefined ? { toDate: new Date(query.toDate) } : {}),
    })
    return c.json(envelope(result))
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'tenant.reports.sales.unhandled_error')
    return c.json(
      errorEnvelope('INTERNAL_ERROR', 'failed to compute sales metrics', requestId),
      500,
    )
  }
})
