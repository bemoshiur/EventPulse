/**
 * Public order creation route — Sprint 3 Day 26 Phase 4.
 *
 * POST /api/v1/public/orders
 *
 * Per CLAUDE.md §6.2 (envelope) + §6.3 (error codes, SCREAMING_SNAKE)
 * + §11 (EPS flow).
 *
 * **Request shape** (validated by zod at the route layer):
 *
 *   {
 *     "eventId": "uuid",
 *     "tierSelections": [{ "tierId": "uuid", "quantity": 1 }, ...],
 *     "buyer": { "name", "email", "phone", "nidLast4"? },
 *     "idempotencyKey"?: "string",     // Day-29 middleware reads this
 *     "utm"?: { "source": ..., "medium": ..., ... }
 *   }
 *
 * Plus the standard `Idempotency-Key` header (§6.4) which the Day 29
 * middleware consumes; today the route still accepts the body key as
 * the canonical place.
 *
 * **Response shapes:**
 *
 *   201 Created — success OR block-refused (both persist the order):
 *     { "data": {
 *         "orderId": "uuid",
 *         "merchantTransactionId": "TXN-...",
 *         "status": "awaiting_payment",
 *         "paymentInitState": "ready" | "blocked",
 *         "redirectUrl": "https://..." | null,
 *         "fees": { ...calculator snapshot... }
 *     } }
 *
 *   400 VALIDATION_ERROR  — zod failure
 *   404 NOT_FOUND          — event or tier missing
 *   409 EVENT_NOT_ON_SALE  — sellable-state validation failed
 *   409 TIER_SOLD_OUT      — tier not on sale (window or archive)
 *   500 INTERNAL_ERROR     — unexpected (incl. EPS network/HTTP)
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { consumeMagicLink, requestMagicLink } from '../../auth/magic-link.js'
import { resolveConsumeBase } from '../../auth/consume-url.js'
import { hashToken } from '../../auth/tokens.js'
import { fetchOrderStatus, fetchOrdersByEmail } from '../../domain/public-orders/status.js'
import { sendEmail } from '../../infra/ses/client.js'
import { renderTicketAccess } from '../../infra/ses/templates/ticket-access.js'
import { allowedOrigins } from '../../middleware/cors.js'
import { buildOrderTicketsPdf } from '../../services/tickets/download-order-tickets.js'
import { logger } from '../../lib/logger.js'
import { idempotencyMiddleware } from '../../middleware/idempotency.js'
import {
  createOrder,
  EventNotFoundError,
  EventNotSellableError,
  InsufficientCapacityError,
  TierNotFoundError,
  TierNotOnSaleError,
} from '../../services/orders/index.js'

export const publicOrdersRoutes = new Hono()

// Day 29 Phase 1: Idempotency-Key middleware on the order-creation
// money path per §1.3 R6 + §6.4. Sits BEFORE zValidator so the
// body-hash is computed from the raw bytes; downstream zValidator
// reads the parsed body from Hono's cached request.
publicOrdersRoutes.use('/', idempotencyMiddleware({ namespace: 'public_orders_create' }))

// ─── zod input schema ───────────────────────────────────────────────

const tierSelectionSchema = z.object({
  tierId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
})

const buyerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254),
  phone: z.string().min(5).max(32),
  nidLast4: z
    .string()
    .regex(/^\d{4}$/, 'nidLast4 must be exactly 4 digits')
    .optional()
    .nullable(),
})

const createOrderInputSchema = z.object({
  eventId: z.string().uuid(),
  tierSelections: z.array(tierSelectionSchema).min(1).max(50),
  buyer: buyerSchema,
  idempotencyKey: z.string().min(8).max(128).optional().nullable(),
  utm: z.record(z.string(), z.unknown()).optional().nullable(),
})

// ─── route ──────────────────────────────────────────────────────────

publicOrdersRoutes.post('/', zValidator('json', createOrderInputSchema), async (c) => {
  const body = c.req.valid('json')
  // Capture buyer-side metadata for audit (§1.3 R8 + §9.10).
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = c.req.header('user-agent') ?? null
  // Idempotency-Key header takes precedence over body key when both
  // present (Day 29 middleware will own this — but at the route
  // layer we surface the precedence rule now for consistency).
  const idempotencyKey = c.req.header('idempotency-key') ?? body.idempotencyKey ?? null

  try {
    const result = await createOrder({
      eventId: body.eventId,
      tierSelections: body.tierSelections,
      buyer: body.buyer,
      idempotencyKey,
      ip,
      userAgent,
      utm: body.utm ?? null,
    })

    // Serialise bigint fields in the calculator snapshot for JSON.
    return c.json(
      {
        data: {
          orderId: result.orderId,
          merchantTransactionId: result.merchantTransactionId,
          status: result.status,
          paymentInitState: result.paymentInitState,
          redirectUrl: result.redirectUrl,
          fees: {
            subtotalPaisa: result.fees.subtotalPaisa.toString(),
            platformFeePaisa: result.fees.platformFeePaisa.toString(),
            epsFeePaisa: result.fees.epsFeePaisa.toString(),
            buyerTotalPaisa: result.fees.buyerTotalPaisa.toString(),
            organiserNetPaisa: result.fees.organiserNetPaisa.toString(),
            platformRevenuePaisa: result.fees.platformRevenuePaisa.toString(),
            breakdown: result.fees.breakdown.map((line) => ({
              label: line.label,
              amountPaisa: line.amountPaisa.toString(),
            })),
          },
        },
      },
      201,
    )
  } catch (err) {
    if (err instanceof EventNotFoundError) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'event not found' } }, 404)
    }
    if (err instanceof EventNotSellableError) {
      return c.json(
        {
          error: {
            code: 'EVENT_NOT_ON_SALE',
            message: err.message,
          },
        },
        409,
      )
    }
    if (err instanceof TierNotFoundError) {
      return c.json({ error: { code: 'NOT_FOUND', message: err.message } }, 404)
    }
    if (err instanceof TierNotOnSaleError) {
      return c.json(
        {
          error: {
            code: 'TIER_SOLD_OUT',
            message: err.message,
          },
        },
        409,
      )
    }
    // Day 29 Phase 2: the FOR UPDATE capacity lock raises this when
    // the requested quantity would exceed `capacity - sold` at the
    // moment of locking. Mapped to the same TIER_SOLD_OUT error code
    // per §6.3 — from the buyer's perspective, the outcome is the
    // same ("this tier doesn't have room"); the lock just makes the
    // determination authoritative under concurrency.
    if (err instanceof InsufficientCapacityError) {
      return c.json(
        {
          error: {
            code: 'TIER_SOLD_OUT',
            message: err.message,
          },
        },
        409,
      )
    }
    // Anything else (EPS errors not caught by the block guard,
    // unexpected DB errors) → 500. The handler logs; the caller sees
    // the standard envelope.
    logger.error({ err: (err as Error).message }, 'order.create.unhandled_error')
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'failed to create order',
        },
      },
      500,
    )
  }
})

// ─── GET /:id/status ───────────────────────────────────────────────────
//
// Backs the post-payment /orders/return/* pages. orderId is a uuid (not
// guessable, not PII). Returns the order outcome + buyer-safe summary +
// issued tickets so the success page can show the receipt + tickets.

const orderIdParam = z.object({ id: z.string().uuid() })

publicOrdersRoutes.get('/:id/status', zValidator('param', orderIdParam), async (c) => {
  const { id } = c.req.valid('param')
  try {
    const status = await fetchOrderStatus(id)
    if (!status) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'order not found' } }, 404)
    }
    return c.json({ data: status })
  } catch (err) {
    logger.error({ err, orderId: id }, 'public.order.status.failed')
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'failed to load order' } }, 500)
  }
})

// ─── GET /:id/tickets.pdf ──────────────────────────────────────────────
//
// On-page ticket download for the success page. One multi-page PDF (a page per
// attendee). Only paid orders with issued tickets return a PDF.

publicOrdersRoutes.get('/:id/tickets.pdf', zValidator('param', orderIdParam), async (c) => {
  const { id } = c.req.valid('param')
  try {
    const result = await buildOrderTicketsPdf(id)
    if (result.kind === 'not_found') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'order not found' } }, 404)
    }
    if (result.kind === 'not_paid') {
      return c.json({ error: { code: 'CONFLICT', message: 'order is not paid' } }, 409)
    }
    if (result.kind === 'no_tickets') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'no tickets issued yet' } }, 404)
    }
    // Copy into a fresh Uint8Array — a Node Buffer's underlying ArrayBuffer can
    // be pooled/oversized, and Hono's c.body() types accept Uint8Array, not Buffer.
    const bytes = new Uint8Array(result.pdf.pdf)
    c.header('Content-Type', 'application/pdf')
    c.header('Content-Disposition', `attachment; filename="${result.filename}"`)
    c.header('Cache-Control', 'private, no-store')
    return c.body(bytes)
  } catch (err) {
    logger.error({ err, orderId: id }, 'public.order.tickets_pdf.failed')
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'failed to build tickets' } }, 500)
  }
})

// ─── "My tickets" buyer self-service (QA P1-1/P1-4) ────────────────────
//
// A guest buyer retrieves their tickets by email: POST /find emails a
// single-use link; POST /by-token validates the link's token and lists the
// buyer's fulfilled orders + tickets. Anti-enumeration: /find ALWAYS 202s.

const findSchema = z.object({ email: z.string().email().toLowerCase().trim() })

publicOrdersRoutes.post('/find', zValidator('json', findSchema), async (c) => {
  const { email } = c.req.valid('json')
  // Only email a link if the address actually has tickets — but respond 202
  // either way so we never reveal whether an email has orders.
  const orders = await fetchOrdersByEmail(email)
  if (orders.length > 0) {
    const { token, expiresAt } = await requestMagicLink({
      email,
      purpose: 'ticket_access',
      userId: null,
      ip: c.req.header('x-forwarded-for') ?? null,
    })
    const fallback = process.env['EVENTPULSE_WEB_BASE_URL'] ?? 'https://eventpulse.com.bd'
    const base = resolveConsumeBase(c.req.header('origin'), allowedOrigins(), fallback)
    const url = `${base}/my-tickets?token=${encodeURIComponent(token)}`
    const rendered = renderTicketAccess({ url, expiresAt })
    try {
      await sendEmail({
        to: email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        tags: { template_id: rendered.templateId, purpose: 'ticket_access' },
      })
    } catch (err) {
      logger.error({ err, email_sha: hashToken(email).slice(0, 16) }, 'ticket_access.send_failed')
    }
  }
  return c.json({ data: { delivered: true } }, 202)
})

const byTokenSchema = z.object({ token: z.string().min(20) })

publicOrdersRoutes.post('/by-token', zValidator('json', byTokenSchema), async (c) => {
  const { token } = c.req.valid('json')
  const result = await consumeMagicLink(token, c.req.header('x-forwarded-for') ?? null)
  if (!result || result.purpose !== 'ticket_access') {
    return c.json({ error: { code: 'AUTH_REQUIRED', message: 'invalid or expired link' } }, 401)
  }
  const orders = await fetchOrdersByEmail(result.email)
  return c.json({ data: orders })
})
