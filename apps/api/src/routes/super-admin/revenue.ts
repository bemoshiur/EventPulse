/**
 * Super-admin platform revenue dashboard routes — Sprint 4 Day 35 §14.7.
 *
 * Two endpoints mounted at `/api/v1/admin/revenue/*`:
 *
 *   GET /api/v1/admin/revenue              — full dashboard payload
 *                                            (headline + time-series +
 *                                            leaderboards + settlement
 *                                            queue + anomaly cards)
 *   GET /api/v1/admin/revenue/ledger       — drillable order ledger
 *                                            (?tenantId=&eventId=
 *                                            &fromDate=&toDate=&limit=)
 *
 * ════════════════════════════════════════════════════════════════════
 * Auth model — load-bearing
 * ════════════════════════════════════════════════════════════════════
 *
 * `requireSuperAdminAuth` is the ENTIRE security guard. The underlying
 * service deliberately reads across all tenants (cross-tenant
 * aggregation is the POINT — see services/admin/revenue.ts file
 * header). A leaked tenant token reaching these routes would expose
 * every tenant's financials.
 *
 * Tests in revenue.test.ts MUST assert:
 *   - no token → 401
 *   - tenant-audience token → 403 (NOT 200 with leaked data)
 *   - attendee-audience token → 403
 *   - super-admin-audience token → 200
 *
 * If you ever add another endpoint to this file, copy the test pattern
 * and keep the audience-rejection assertions.
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { logger } from '../../lib/logger.js'
import { getPlatformRevenueDashboard, getRevenueLedger } from '../../services/admin/revenue.js'

const revenue = new Hono()
revenue.use('*', requireSuperAdminAuth)

// ─── helpers (mirror tenant/reports.ts shape) ───────────────────────

function envelope<T>(data: T) {
  return { data }
}

function errorEnvelope(code: string, message: string, requestId: string | null) {
  return { error: { code, message, ...(requestId ? { requestId } : {}) } }
}

// ─── input schemas ───────────────────────────────────────────────────

const dashboardQuerySchema = z.object({
  fromDate: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  toDate: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  headlineFromDate: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
})

const ledgerQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  toDate: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

// ─── GET /api/v1/admin/revenue — full dashboard ────────────────────

revenue.get('/', zValidator('query', dashboardQuerySchema), async (c) => {
  const query = c.req.valid('query')
  const requestId = c.req.header('x-request-id') ?? null
  try {
    const result = await getPlatformRevenueDashboard({
      fromDate: query.fromDate,
      toDate: query.toDate,
      headlineFromDate: query.headlineFromDate,
    })
    return c.json(envelope(result), 200)
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'admin.revenue.dashboard.unhandled_error')
    return c.json(
      errorEnvelope('INTERNAL_ERROR', 'failed to load revenue dashboard', requestId),
      500,
    )
  }
})

// ─── GET /api/v1/admin/revenue/ledger — drillable detail ────────────

revenue.get('/ledger', zValidator('query', ledgerQuerySchema), async (c) => {
  const query = c.req.valid('query')
  const requestId = c.req.header('x-request-id') ?? null
  try {
    const result = await getRevenueLedger({
      tenantId: query.tenantId,
      eventId: query.eventId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      limit: query.limit,
    })
    return c.json(envelope(result), 200)
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'admin.revenue.ledger.unhandled_error')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to load revenue ledger', requestId), 500)
  }
})

export { revenue as adminRevenueRoutes }
