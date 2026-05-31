/**
 * Super-admin disputed-orders + manual-refund routes — Day 39 Phase 2b.
 *
 * Companion to PR #228's Verify-guard (Day 38 Phase 2a). When EPS
 * Verify returns Success but the buyer used a non-bKash payment
 * method, the order is diverted to `disputed` status instead of
 * `paid`. This module surfaces those disputed orders to the
 * super-admin queue + provides the mark-refunded action used after
 * the super-admin manually completes the refund via the EPS merchant
 * dashboard (V5 has no public refund API per CLAUDE.md §11.4).
 *
 * Endpoints (mounted at /api/v1/admin/orders):
 *
 *   GET   /disputed                        — list disputed orders (super-admin queue)
 *   POST  /:orderId/mark-refunded          — mark a disputed order as refunded
 *
 * **v1.0 launch posture per `decisions.md` 2026-05-31 Day 38 Phase 2
 * (mechanism (d)):** the React UI for this queue is deferred (Day 38
 * decision: lightweight endpoint in Phase 2 PR; full UI follow-up).
 * Ops invokes these endpoints via curl / Postman / the existing
 * admin portal scripts; the JSON envelope is the queue surface.
 *
 * Auth: requireSuperAdminAuth. Both endpoints run under
 * `withSuperAdmin()` (the audit row's actor_type is `'super_admin'`;
 * the audit + refunds + order_events INSERTs need `tenant_id`
 * populated from the order row, which BYPASSRLS allows from a
 * non-tenant super-admin session).
 *
 * **State machine:** `mark-refunded` triggers the `disputed →
 * refunded` transition added in this PR (extends §2.5 lifecycle).
 *
 * **Idempotency:** the state machine is the gate. A second call for
 * the same order returns 409 INVALID_TRANSITION because `refunded`
 * is terminal.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, asc, desc, eq, lt, or } from 'drizzle-orm'
import { z } from 'zod'

import { requireSuperAdminAuth } from '../../auth/middleware.js'
import { withSuperAdmin } from '../../db/client.js'
import { events, orders, tenants } from '../../db/schema/index.js'
import { logger } from '../../lib/logger.js'
import { markDisputedOrderRefunded } from '../../services/orders/manual-refund.js'

const admin = new Hono()

admin.use('*', requireSuperAdminAuth)

// ─── helpers ──────────────────────────────────────────────────────────

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

const orderIdParamSchema = z.object({ orderId: z.string().uuid() })

const markRefundedBodySchema = z.object({
  /**
   * Free-text reason persisted on the refunds row. Defaults to a
   * stable v1.0-Phase-2b string if not supplied; super-admin can
   * append context (e.g. "EPS dashboard refund ref: ABC123").
   */
  reasonText: z
    .string()
    .min(10)
    .max(500)
    .optional()
    .default(
      'v1.0 single-method launch: non-bKash method at Verify; manual refund completed via EPS dashboard',
    ),
})

const listDisputedQuerySchema = z.object({
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

// ─── GET /disputed — list disputed orders (super-admin queue) ────────

admin.get('/disputed', zValidator('query', listDisputedQuerySchema), async (c) => {
  const filter = c.req.valid('query')
  const requestId = c.req.header('x-request-id') ?? null

  try {
    const { rows, nextCursor } = await withSuperAdmin(async (tx) => {
      const cursor = decodeCursor(filter.cursor)

      const conditions = [eq(orders.status, 'disputed')]
      if (cursor) {
        conditions.push(
          or(
            lt(orders.createdAt, cursor.createdAt),
            and(eq(orders.createdAt, cursor.createdAt), lt(orders.id, cursor.id)),
          )!,
        )
      }

      // Keyset on (createdAt DESC, id DESC) — newest dispute first.
      // Joined to tenants + events for the queue's at-a-glance context;
      // does NOT join attendees / order_items (the queue is for refund
      // triage, not for ticket inspection — that's a separate detail
      // view if needed in the React UI follow-up).
      const rawRows = await tx
        .select({
          id: orders.id,
          tenantId: orders.tenantId,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          eventId: orders.eventId,
          eventTitle: events.title,
          merchantTransactionId: orders.merchantTransactionId,
          epsTransactionId: orders.epsTransactionId,
          epsPaymentMethod: orders.epsPaymentMethod,
          totalPaisa: orders.totalPaisa,
          status: orders.status,
          epsVerifiedAt: orders.epsVerifiedAt,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
        })
        .from(orders)
        .innerJoin(tenants, eq(orders.tenantId, tenants.id))
        .innerJoin(events, eq(orders.eventId, events.id))
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(filter.limit + 1)

      const hasMore = rawRows.length > filter.limit
      const page = hasMore ? rawRows.slice(0, filter.limit) : rawRows
      const last = page[page.length - 1]
      const next = hasMore && last ? encodeCursor(last) : null

      // Serialise bigint paisa as string per the established envelope
      // convention (JSON number = double; bigint precision matters here).
      const reshaped = page.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        eventId: r.eventId,
        eventTitle: r.eventTitle,
        merchantTransactionId: r.merchantTransactionId,
        epsTransactionId: r.epsTransactionId,
        epsPaymentMethod: r.epsPaymentMethod,
        totalPaisa: r.totalPaisa.toString(),
        status: r.status,
        epsVerifiedAt: r.epsVerifiedAt,
        disputedAt: r.updatedAt, // proxy: the most recent updated_at on a disputed order = when it became disputed
        createdAt: r.createdAt,
      }))

      return { rows: reshaped, nextCursor: next }
    })

    return c.json(envelope(rows, { nextCursor, hasMore: nextCursor !== null }))
  } catch (err) {
    logger.error({ err, requestId }, 'admin disputed-orders list failed')
    return c.json(errorEnvelope('INTERNAL_ERROR', 'failed to list disputed orders', requestId), 500)
  }
})

// ─── POST /:orderId/mark-refunded — mark a disputed order as refunded ─

admin.post(
  '/:orderId/mark-refunded',
  zValidator('param', orderIdParamSchema),
  zValidator('json', markRefundedBodySchema),
  async (c) => {
    const { orderId } = c.req.valid('param')
    const { reasonText } = c.req.valid('json')
    const auth = c.get('auth')!
    const requestId = c.req.header('x-request-id') ?? null

    try {
      const result = await markDisputedOrderRefunded({
        orderId,
        refundedBy: auth.sub,
        reasonText,
      })

      if (result.kind === 'not_found') {
        return c.json(errorEnvelope('NOT_FOUND', `Order ${orderId} not found`, requestId), 404)
      }
      if (result.kind === 'invalid_transition') {
        // 409 — order is not in `disputed` state (or already refunded).
        // The state-machine reason is the canonical explanation.
        return c.json(
          {
            error: {
              code: 'INVALID_TRANSITION',
              message: result.reason,
              details: {
                currentStatus: result.currentStatus,
                attemptedTarget: 'refunded',
              },
              request_id: requestId,
            },
          },
          409,
        )
      }

      return c.json(
        envelope({
          orderId: result.orderId,
          refundId: result.refundId,
          amountPaisa: result.amountPaisa.toString(),
          previousStatus: result.previousStatus,
          newStatus: 'refunded',
        }),
        200,
      )
    } catch (err) {
      logger.error({ err, orderId, refundedBy: auth.sub, requestId }, 'admin mark-refunded failed')
      return c.json(
        errorEnvelope('INTERNAL_ERROR', 'failed to mark order refunded', requestId),
        500,
      )
    }
  },
)

export { admin as adminOrdersRoutes }
