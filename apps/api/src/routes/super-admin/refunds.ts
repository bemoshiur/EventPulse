/**
 * Super-admin refund routes — Day 41 Sprint 4 (§10.4 + §26.1 Day 7-8).
 *
 * Endpoints (mounted at /api/v1/admin/refunds):
 *
 *   GET   /                           — list refunds (queue; cursor-paginated)
 *   GET   /:refundId                  — refund detail with order context
 *   POST  /:refundId/approve          — approve pending refund
 *   POST  /:refundId/reject           — reject pending refund (notes required)
 *   POST  /:refundId/mark-processed   — close the loop after EPS dashboard refund
 *
 * Auth: requireSuperAdminAuth on every route. Audit-row actor_type
 * is 'super_admin'; actor_id is the calling super-admin's user id.
 *
 * **v1.0 launch posture per `decisions.md` 2026-05-31 Day 38 Phase 2
 * (mechanism (d)):** the React UI for this queue is deferred; ops
 * invokes these endpoints via curl/Postman/the existing admin portal
 * scripts. The JSON envelope is the queue surface.
 *
 * **EPS-side coupling:** none here. The super-admin issues the actual
 * EPS refund via the merchant dashboard between `approve` and
 * `mark-processed` (§11.4 — V5 has no public refund API). This module
 * tracks only the platform's state machine + audit story.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { z } from 'zod'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { withSuperAdmin } from '../../db/client.js'
import { orders, refunds, tenants, users } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'
import {
  approveRefund,
  markRefundProcessed,
  rejectRefund,
} from '../../services/refunds/refund-flow.js'

export const adminRefundsRoutes = new Hono()

adminRefundsRoutes.use('*', requireSuperAdminAuth)

function envelope<T>(data: T, meta?: Record<string, unknown>) {
  return meta !== undefined ? { data, meta } : { data }
}

function errorEnvelope(code: string, message: string, requestId: string | null) {
  return { error: { code, message, request_id: requestId } }
}

// ─── shared ──────────────────────────────────────────────────────────

const refundIdParamSchema = z.object({ refundId: z.string().uuid() })

const listRefundsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'processed', 'failed']).optional(),
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
})

const approveBodySchema = z.object({
  superAdminNotes: z.string().min(1).max(2000).optional(),
})

const rejectBodySchema = z.object({
  /** REQUIRED — rejection rationale captured for tenant + audit. */
  superAdminNotes: z.string().min(5).max(2000),
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

// ─── GET / — queue (cursor pagination, tenant-cross by design) ──────

adminRefundsRoutes.get('/', zValidator('query', listRefundsQuerySchema), async (c) => {
  const filter = c.req.valid('query')
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const rows = await withSuperAdmin(async (tx) => {
      const conditions = [] as ReturnType<typeof eq>[]
      if (filter.status) conditions.push(eq(refunds.status, filter.status))
      if (filter.tenantId) conditions.push(eq(refunds.tenantId, filter.tenantId))

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
          tenantId: refunds.tenantId,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          orderId: refunds.orderId,
          merchantTransactionId: orders.merchantTransactionId,
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
        })
        .from(refunds)
        .innerJoin(tenants, eq(refunds.tenantId, tenants.id))
        .innerJoin(orders, eq(refunds.orderId, orders.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
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
    logger.error({ err }, 'admin.refund.list_failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund list failed', requestId), 500)
  }
})

// ─── GET /:refundId — detail with order + tenant + initiator context ──

adminRefundsRoutes.get('/:refundId', zValidator('param', refundIdParamSchema), async (c) => {
  const { refundId } = c.req.valid('param')
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const row = await withSuperAdmin(async (tx) => {
      const rows = await tx
        .select({
          id: refunds.id,
          tenantId: refunds.tenantId,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          orderId: refunds.orderId,
          orderMerchantTransactionId: orders.merchantTransactionId,
          orderStatus: orders.status,
          orderTotalPaisa: orders.totalPaisa,
          orderEpsTransactionId: orders.epsTransactionId,
          orderEpsPaymentMethod: orders.epsPaymentMethod,
          amountPaisa: refunds.amountPaisa,
          reason: refunds.reason,
          reasonCode: refunds.reasonCode,
          status: refunds.status,
          createdAt: refunds.createdAt,
          approvedAt: refunds.approvedAt,
          rejectedAt: refunds.rejectedAt,
          processedAt: refunds.processedAt,
          superAdminNotes: refunds.superAdminNotes,
          initiatedById: refunds.initiatedBy,
          initiatedByEmail: users.email,
          initiatedByName: users.fullName,
        })
        .from(refunds)
        .innerJoin(tenants, eq(refunds.tenantId, tenants.id))
        .innerJoin(orders, eq(refunds.orderId, orders.id))
        .innerJoin(users, eq(refunds.initiatedBy, users.id))
        .where(eq(refunds.id, refundId))
        .limit(1)
      return rows[0] ?? null
    })

    if (!row) {
      return c.json(errorEnvelope('NOT_FOUND', `Refund '${refundId}' not found`, requestId), 404)
    }

    return c.json(
      envelope({
        id: row.id,
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        amountPaisa: row.amountPaisa.toString(),
        reason: row.reason,
        reasonCode: row.reasonCode,
        status: row.status,
        createdAt: row.createdAt,
        approvedAt: row.approvedAt,
        rejectedAt: row.rejectedAt,
        processedAt: row.processedAt,
        superAdminNotes: row.superAdminNotes,
        order: {
          id: row.orderId,
          merchantTransactionId: row.orderMerchantTransactionId,
          status: row.orderStatus,
          totalPaisa: row.orderTotalPaisa.toString(),
          epsTransactionId: row.orderEpsTransactionId,
          epsPaymentMethod: row.orderEpsPaymentMethod,
        },
        initiatedBy: {
          id: row.initiatedById,
          email: row.initiatedByEmail,
          fullName: row.initiatedByName,
        },
      }),
    )
  } catch (err) {
    logger.error({ err, refundId }, 'admin.refund.detail_failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund detail failed', requestId), 500)
  }
})

// ─── POST /:refundId/approve ────────────────────────────────────────

adminRefundsRoutes.post(
  '/:refundId/approve',
  zValidator('param', refundIdParamSchema),
  zValidator('json', approveBodySchema),
  async (c) => {
    const { refundId } = c.req.valid('param')
    const body = c.req.valid('json')
    const adminUserId = c.get('auth')!.sub
    const requestId = c.req.header('x-request-id') ?? null

    try {
      const result = await approveRefund({
        refundId,
        approvedBy: adminUserId,
        superAdminNotes: body.superAdminNotes ?? null,
      })

      switch (result.kind) {
        case 'approved':
          return c.json(
            envelope({
              refundId: result.refundId,
              orderId: result.orderId,
              amountPaisa: result.amountPaisa.toString(),
              status: 'approved',
            }),
          )
        case 'not_found':
          return c.json(
            errorEnvelope('NOT_FOUND', `Refund '${refundId}' not found`, requestId),
            404,
          )
        case 'invalid_refund_state':
          return c.json(
            errorEnvelope(
              'INVALID_TRANSITION',
              `Refund is in '${result.currentStatus}'; only 'pending' refunds can be approved.`,
              requestId,
            ),
            409,
          )
      }
    } catch (err) {
      logger.error({ err, refundId }, 'admin.refund.approve_failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund approve failed', requestId), 500)
    }
  },
)

// ─── POST /:refundId/reject ─────────────────────────────────────────

adminRefundsRoutes.post(
  '/:refundId/reject',
  zValidator('param', refundIdParamSchema),
  zValidator('json', rejectBodySchema),
  async (c) => {
    const { refundId } = c.req.valid('param')
    const body = c.req.valid('json')
    const adminUserId = c.get('auth')!.sub
    const requestId = c.req.header('x-request-id') ?? null

    try {
      const result = await rejectRefund({
        refundId,
        rejectedBy: adminUserId,
        superAdminNotes: body.superAdminNotes,
      })

      switch (result.kind) {
        case 'rejected':
          return c.json(
            envelope({
              refundId: result.refundId,
              orderId: result.orderId,
              orderRolledBackTo: result.orderRolledBackTo,
              status: 'rejected',
            }),
          )
        case 'not_found':
          return c.json(
            errorEnvelope('NOT_FOUND', `Refund '${refundId}' not found`, requestId),
            404,
          )
        case 'invalid_refund_state':
          return c.json(
            errorEnvelope(
              'INVALID_TRANSITION',
              `Refund is in '${result.currentStatus}'; only 'pending' refunds can be rejected.`,
              requestId,
            ),
            409,
          )
        case 'invalid_transition':
          return c.json(errorEnvelope('INVALID_TRANSITION', result.reason, requestId), 409)
      }
    } catch (err) {
      logger.error({ err, refundId }, 'admin.refund.reject_failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund reject failed', requestId), 500)
    }
  },
)

// ─── POST /:refundId/mark-processed ─────────────────────────────────

adminRefundsRoutes.post(
  '/:refundId/mark-processed',
  zValidator('param', refundIdParamSchema),
  async (c) => {
    const { refundId } = c.req.valid('param')
    const adminUserId = c.get('auth')!.sub
    const requestId = c.req.header('x-request-id') ?? null

    try {
      const result = await markRefundProcessed({
        refundId,
        processedBy: adminUserId,
      })

      switch (result.kind) {
        case 'processed':
          return c.json(
            envelope({
              refundId: result.refundId,
              orderId: result.orderId,
              amountPaisa: result.amountPaisa.toString(),
              status: 'processed',
              orderStatus: 'refunded',
            }),
          )
        case 'not_found':
          return c.json(
            errorEnvelope('NOT_FOUND', `Refund '${refundId}' not found`, requestId),
            404,
          )
        case 'invalid_refund_state':
          return c.json(
            errorEnvelope(
              'INVALID_TRANSITION',
              `Refund is in '${result.currentStatus}'; only 'approved' refunds can be marked processed.`,
              requestId,
            ),
            409,
          )
        case 'invalid_transition':
          return c.json(errorEnvelope('INVALID_TRANSITION', result.reason, requestId), 409)
      }
    } catch (err) {
      logger.error({ err, refundId }, 'admin.refund.mark_processed_failed')
      return c.json(errorEnvelope('INTERNAL_ERROR', 'Refund mark-processed failed', requestId), 500)
    }
  },
)
