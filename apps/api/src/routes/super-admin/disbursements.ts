/**
 * Super-admin disbursement export route — Day 44 §26.1 Day 10 bridge.
 *
 * One endpoint mounted at `/api/v1/admin/disbursements/*`:
 *
 *   GET /api/v1/admin/disbursements/export
 *     ?period_start=YYYY-MM-DD
 *     &period_end=YYYY-MM-DD
 *     [&tenant_id=<uuid>]
 *
 *     Returns text/csv with per-tenant disbursement aggregates.
 *     One audit_logs row per export (Day-32 attendee-export pattern).
 *
 * ════════════════════════════════════════════════════════════════════
 * Auth model
 * ════════════════════════════════════════════════════════════════════
 *
 * `requireSuperAdminAuth` is the entire security guard — same model
 * as the Day-35 revenue dashboard. The underlying service runs under
 * `withSuperAdmin()` BYPASSRLS; cross-tenant aggregation is the POINT.
 *
 * Tests MUST assert:
 *   - no token → 401
 *   - tenant-audience token → 403
 *   - attendee-audience token → 403
 *   - super-admin-audience token → 200
 *
 * ════════════════════════════════════════════════════════════════════
 * Why this exists alongside the Day-35 revenue dashboard
 * ════════════════════════════════════════════════════════════════════
 *
 * The revenue dashboard is read-only display data (HTML rendered
 * client-side). This endpoint produces a downloadable CSV the operator
 * uses to populate the bank's BEFTN form on T+5 disbursement day. Both
 * read from the same orders + refunds tables; the CSV is the manual-
 * disbursement bridge until Sprint 7's settlement engine lands.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { withSuperAdmin } from '../../db/client.js'
import { logger } from '../../lib/logger.js'
import { writeDisbursementCsvExported } from '../../services/audit/admin.js'
import { exportDisbursementsCsv } from '../../services/admin/disbursement-export.js'

const admin = new Hono()
admin.use('*', requireSuperAdminAuth)

function errorEnvelope(code: string, message: string, requestId: string | null) {
  return { error: { code, message, request_id: requestId } }
}

// ─── GET /export — CSV download ─────────────────────────────────────

const exportQuerySchema = z
  .object({
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'period_start must be YYYY-MM-DD'),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'period_end must be YYYY-MM-DD'),
    tenant_id: z.string().uuid().optional(),
  })
  .refine(
    (q) => {
      const start = new Date(q.period_start + 'T00:00:00Z')
      const end = new Date(q.period_end + 'T00:00:00Z')
      return end.getTime() > start.getTime()
    },
    { message: 'period_end must be after period_start' },
  )

admin.get('/export', zValidator('query', exportQuerySchema), async (c) => {
  const q = c.req.valid('query')
  const requestId = c.req.header('x-request-id') ?? null
  const auth = c.get('auth')
  if (!auth) {
    return c.json(errorEnvelope('AUTH_REQUIRED', 'super-admin auth required', requestId), 401)
  }
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = c.req.header('user-agent') ?? null

  // period_end is treated as EXCLUSIVE per §14.5 convention. Convert
  // `YYYY-MM-DD` end input to the start of that day; the export then
  // covers `[start_day, end_day)` — the standard end-exclusive window.
  const periodStart = new Date(q.period_start + 'T00:00:00Z')
  const periodEnd = new Date(q.period_end + 'T00:00:00Z')

  try {
    const result = await exportDisbursementsCsv({
      periodStart,
      periodEnd,
      tenantId: q.tenant_id ?? null,
      actorUserId: auth.sub,
      ip,
      userAgent,
    })

    // Write the audit row in a separate withSuperAdmin tx so the
    // service stays pure read-only. The export itself is the
    // load-bearing op; the audit row is a follow-up.
    await withSuperAdmin(async (tx) => {
      await writeDisbursementCsvExported(tx, {
        actorUserId: auth.sub,
        periodStart,
        periodEnd,
        tenantId: q.tenant_id ?? null,
        rowCount: result.rowCount,
        totalNetPaisa: result.totalNetPaisa,
        ip,
        userAgent,
      })
    })

    logger.info(
      {
        actor: auth.sub,
        period_start: q.period_start,
        period_end: q.period_end,
        tenant_id_filter: q.tenant_id ?? null,
        row_count: result.rowCount,
        total_net_paisa: result.totalNetPaisa.toString(),
      },
      'admin.disbursements.exported_csv',
    )

    return new Response(result.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${result.filename}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    logger.error({ err }, 'admin.disbursements.export_failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'Disbursement export failed', requestId), 500)
  }
})

export { admin as adminDisbursementsRoutes }
