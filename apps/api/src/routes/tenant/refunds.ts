/**
 * Tenant-portal refund routes — Day 41 Sprint 4 (§10.2 + §26.1 Day 7-8).
 *
 * Surfaces:
 *
 *   POST /api/v1/tenant/orders/:orderId/refund    — initiate refund request
 *   GET  /api/v1/tenant/refunds                   — list own refunds (cursor)
 *   GET  /api/v1/tenant/refunds/:refundId         — refund detail
 *
 * Auth: requireTenantAuth on every route. The tenantId from the JWT
 * is the security boundary; the service-layer cross-tenant guard
 * verifies the order belongs to the calling tenant (defence-in-depth).
 *
 * Idempotency: POST /refund is money-adjacent (the refund itself is
 * a state-changing action even though no money moves until super-
 * admin approval). Per §6.4 + §1.3 R6, money-moving endpoints require
 * Idempotency-Key. The middleware is wired at the app-mount layer per
 * established pattern.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, desc, eq, lt, or } from 'drizzle-orm'

import { requireTenantAuth } from '../../auth/middleware.js'
import { withSuperAdmin } from '../../db/client.js'
import { orders, refunds } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'
import { requestRefund } from '../../services/refunds/refund-flow.js'

/**
 * Two routers because the spec mounts the POST refund-request endpoint
 * under `/tenant/orders/:orderId/refund` (per §10.2) while the listing
 * endpoints live under `/tenant/refunds`. Splitting keeps each mount
 * cleanly scoped to its top-level namespace.
 *
 * - `tenantOrderRefundRoutes` mounts at `/api/v1/tenant/orders`
 * - `tenantRefundRoutes`      mounts at `/api/v1/tenant/refunds`
 */
export const tenantOrderRefundRoutes = new Hono()
export const tenantRefundRoutes = new Hono()

tenantOrderRefundRoutes.use('*', requireTenantAuth)
tenantRefundRoutes.use('*', requireTenantAuth)

function envelope<T>(data: T, meta?: Record<string, unknown>) {
  return meta !== undefined ? { data, meta } : { data }
}

function errorEnvelope(code: string, message: string, requestId: string | null) {
  return { error: { code, message, request_id: requestId } }
}

// ─── shared helpers ────────────────────────────────────────────────

const orderIdParamSchema = z.object({ orderId: z.string().uuid() })
const refundIdParamSchema = z.object({ refundId: z.string().uuid() })

const requestRefundBodySchema = z.object({
  /** Free-text justification persisted on refunds.reason. */
  reason: z.string().min(5).max(500),
  /** Categorical reason_code; v1.0 default tenant_requested + escape hatch other. */
  reasonCode: z.enum(['tenant_requested', 'other']).default('tenant_requested'),
})

const listRefundsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'processed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
})

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf-8').toString('base64url')
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8')
    const [iso, id] = decoded.split('|')
    if (!iso || !id) return null
    return { createdAt: new Date(iso), id }
  } catch {
    return null
  }
}

// ─── POST /tenant/orders/:orderId/refund — initiate refund request ──

tenantOrderRefundRoutes.post(
  '/:orderId/refund',
  zValidator('param', orderIdParamSchema),
  zValidator('json', requestRefundBodySchema),
  async (c) => {
    const { orderId } = c.req.valid('param')
    const body = c.req.valid('json')
    const tenantId = c.get('tenantId') as string
    const userId = c.get('auth')!.sub
    const requestId = c.req.header('x-request-id') ?? null
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const userAgent = c.req.header('user-agent') ?? null

    try {
      const result = await requestRefund({
        orderId,
        tenantId,
        initiatedBy: userId,
        reason: body.reason,
        reasonCode: body.reasonCode,
        ip,
        userAgent,
      })

      switch (result.kind) {
        case 'requested':
          return c.json(
            envelope({
              orderId: result.orderId,
              refundId: result.refundId,
              amountPaisa: result.amountPaisa.toString(),
              status: 'pending',
            }),
            201,
          )

        case 'not_found':
          return c.json(errorEnvelope('NOT_FOUND', `Order '${orderId}' not found`, requestId), 404)

        case 'cross_tenant':
          // Hide cross-tenant attempts as 404 (no enumeration).
          return c.json(errorEnvelope('NOT_FOUND', `Order '${orderId}' not found`, requestId), 404)

        case 'already_requested':
          return c.json(
            errorEnvelope(
              'CONFLICT',
              `A pending refund already exists for this order (refund ${result.existingRefundId}).`,
              requestId,
            ),
            409,
          )

        case 'invalid_transition':
          return c.json(errorEnvelope('INVALID_TRANSITION', result.reason, requestId), 409)
      }
    } catch (err) {
      logger.error({ err, orderId, tenantId }, 'tenant.refund.request_failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund request failed', requestId), 500)
    }
  },
)

// ─── GET /tenant/refunds — list own refunds (cursor pagination) ─────

tenantRefundRoutes.get('/', zValidator('query', listRefundsQuerySchema), async (c) => {
  const filter = c.req.valid('query')
  const tenantId = c.get('tenantId') as string
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const rows = await withSuperAdmin(async (tx) => {
      const conditions = [eq(refunds.tenantId, tenantId)]
      if (filter.status) conditions.push(eq(refunds.status, filter.status))

      const cursor = decodeCursor(filter.cursor)
      if (cursor) {
        conditions.push(
          or(
            lt(refunds.createdAt, cursor.createdAt),
            and(eq(refunds.createdAt, cursor.createdAt), lt(refunds.id, cursor.id)),
          )!,
        )
      }

      return tx
        .select({
          id: refunds.id,
          orderId: refunds.orderId,
          amountPaisa: refunds.amountPaisa,
          reason: refunds.reason,
          reasonCode: refunds.reasonCode,
          status: refunds.status,
          createdAt: refunds.createdAt,
          approvedAt: refunds.approvedAt,
          rejectedAt: refunds.rejectedAt,
          processedAt: refunds.processedAt,
          superAdminNotes: refunds.superAdminNotes,
        })
        .from(refunds)
        .where(and(...conditions))
        .orderBy(desc(refunds.createdAt), desc(refunds.id))
        .limit(filter.limit + 1)
    })

    const hasMore = rows.length > filter.limit
    const page = hasMore ? rows.slice(0, filter.limit) : rows
    const last = page[page.length - 1]
    const nextCursor = hasMore && last ? encodeCursor(last) : null

    const reshaped = page.map((r) => ({
      ...r,
      amountPaisa: r.amountPaisa.toString(),
    }))

    return c.json(envelope(reshaped, { nextCursor, hasMore }))
  } catch (err) {
    logger.error({ err, tenantId }, 'tenant.refund.list_failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund list failed', requestId), 500)
  }
})

// ─── GET /tenant/refunds/:refundId — detail ─────────────────────────

tenantRefundRoutes.get('/:refundId', zValidator('param', refundIdParamSchema), async (c) => {
  const { refundId } = c.req.valid('param')
  const tenantId = c.get('tenantId') as string
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const refundRow = await withSuperAdmin(async (tx) => {
      const rows = await tx
        .select({
          id: refunds.id,
          tenantId: refunds.tenantId,
          orderId: refunds.orderId,
          amountPaisa: refunds.amountPaisa,
          reason: refunds.reason,
          reasonCode: refunds.reasonCode,
          status: refunds.status,
          createdAt: refunds.createdAt,
          approvedAt: refunds.approvedAt,
          rejectedAt: refunds.rejectedAt,
          processedAt: refunds.processedAt,
          superAdminNotes: refunds.superAdminNotes,
          initiatedBy: refunds.initiatedBy,
          orderMerchantTransactionId: orders.merchantTransactionId,
          orderStatus: orders.status,
          orderTotalPaisa: orders.totalPaisa,
        })
        .from(refunds)
        .innerJoin(orders, eq(orders.id, refunds.orderId))
        .where(eq(refunds.id, refundId))
        .limit(1)
      return rows[0] ?? null
    })

    if (!refundRow) {
      return c.json(errorEnvelope('NOT_FOUND', `Refund '${refundId}' not found`, requestId), 404)
    }

    // Cross-tenant guard — hide as 404 (no enumeration).
    if (refundRow.tenantId !== tenantId) {
      return c.json(errorEnvelope('NOT_FOUND', `Refund '${refundId}' not found`, requestId), 404)
    }

    return c.json(
      envelope({
        id: refundRow.id,
        orderId: refundRow.orderId,
        amountPaisa: refundRow.amountPaisa.toString(),
        reason: refundRow.reason,
        reasonCode: refundRow.reasonCode,
        status: refundRow.status,
        createdAt: refundRow.createdAt,
        approvedAt: refundRow.approvedAt,
        rejectedAt: refundRow.rejectedAt,
        processedAt: refundRow.processedAt,
        superAdminNotes: refundRow.superAdminNotes,
        order: {
          merchantTransactionId: refundRow.orderMerchantTransactionId,
          status: refundRow.orderStatus,
          totalPaisa: refundRow.orderTotalPaisa.toString(),
        },
      }),
    )
  } catch (err) {
    logger.error({ err, refundId, tenantId }, 'tenant.refund.detail_failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund detail failed', requestId), 500)
  }
})
