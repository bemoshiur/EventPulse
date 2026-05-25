/**
 * EPS browser redirect handlers — Sprint 3 Day 27 Phase 3.
 *
 * `GET /api/v1/public/orders/eps-return/success`
 * `GET /api/v1/public/orders/eps-return/fail`
 * `GET /api/v1/public/orders/eps-return/cancel`
 *
 * **CRITICAL design property (§1.3 R3 + Day 27 brief):** these
 * endpoints are NEVER authoritative for payment status. A buyer
 * landing on `/success` does NOT prove the payment succeeded — the
 * browser is untrusted; query-string params are untrusted; even the
 * URL itself is untrusted (a malicious link could send the user to
 * success-shaped URL for an unpaid order).
 *
 * The handler reconciles via `settleOrderFromEps` (same authority
 * model as the Day 27 Phase 2 webhook): looks up the order by
 * `merchantTransactionId`, calls `verifyOrder()` against EPS, and
 * uses the verify response as the source of truth for what status
 * the order is in. The redirect URL the browser actually lands at
 * is computed from the RESOLVED order status, not from which
 * /eps-return path EPS sent us to.
 *
 * **Outbound redirect targets (browser-facing display pages):**
 *
 *   - settled paid       → `${WEB}/orders/return/success?orderId=...`
 *   - settled failed     → `${WEB}/orders/return/fail?orderId=...`
 *   - settled cancelled  → `${WEB}/orders/return/cancel?orderId=...`
 *   - already-settled (idempotent_noop) → branched by currentStatus
 *   - verify inconclusive (pending)     → `${WEB}/orders/return/pending?orderId=...`
 *   - unknown txn / missing param       → `${WEB}/orders/return/error`
 *
 * The frontend pages at `${WEB}/orders/return/*` are Day 28+ scope.
 * For Day 27, the redirect target is well-defined; the frontend
 * showing the actual page is the next session's work.
 *
 * **No-PII rule:** the only query param appended to the outbound
 * redirect is `orderId` (a uuid — not PII). The `merchantTransactionId`
 * is NOT echoed back to the browser (it's an internal identifier).
 *
 * **STAGING_PAYMENT_BLOCK invariant:** unaffected. settleOrderFromEps
 * calls verifyOrder which is read-only + not block-guarded. Per the
 * Phase 2 file header, in staging an orphan redirect arrival
 * triggers a real EPS verify call; the response (likely "txn not
 * found") is handled via the `unknown_transaction` branch which
 * redirects to the error page.
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { EpsNetworkError, EpsResponseError } from '../../infra/eps/client.js'
import { logger } from '../../lib/logger.js'
import {
  settleOrderFromEps,
  type SettlementResult,
  type SettlementSource,
} from '../../services/orders/settle.js'

export const epsReturnRoutes = new Hono()

// ─── outbound redirect helpers ──────────────────────────────────────

/**
 * Compute the web base URL for the outbound redirect. Mirrors the
 * Day 24 OAuth callback pattern: callback runs on the API vhost,
 * must redirect to the web vhost via the absolute URL from env.
 */
function webBaseUrl(): string {
  const base = process.env['EVENTPULSE_WEB_BASE_URL']
  if (!base) {
    // Fail-loud at request time if misconfigured. Caller catches and
    // serves an inline error rather than redirecting to a broken URL.
    throw new Error('EVENTPULSE_WEB_BASE_URL not set')
  }
  return base.replace(/\/+$/, '')
}

type ReturnPagePath =
  | '/orders/return/success'
  | '/orders/return/fail'
  | '/orders/return/cancel'
  | '/orders/return/pending'
  | '/orders/return/error'

function pageForResult(result: SettlementResult): { path: ReturnPagePath; orderId?: string } {
  switch (result.kind) {
    case 'settled':
      switch (result.newStatus) {
        case 'paid':
          return { path: '/orders/return/success', orderId: result.orderId }
        case 'cancelled':
          return { path: '/orders/return/cancel', orderId: result.orderId }
        case 'failed':
          return { path: '/orders/return/fail', orderId: result.orderId }
        default:
          // Non-settlement transitions (refund, dispute etc.) can't
          // arise on this code path because settleOrderFromEps maps
          // EPS status → paid/failed/cancelled only. Defence in depth.
          return { path: '/orders/return/error' }
      }
    case 'idempotent_noop':
      switch (result.currentStatus) {
        case 'paid':
        case 'completed':
          return { path: '/orders/return/success', orderId: result.orderId }
        case 'cancelled':
          return { path: '/orders/return/cancel', orderId: result.orderId }
        case 'failed':
          return { path: '/orders/return/fail', orderId: result.orderId }
        case 'refunded':
        case 'reversed':
          // Settled-then-reversed states: treat as fail-shaped page
          // so the user sees the latest known state rather than a
          // stale success/cancel UI.
          return { path: '/orders/return/fail', orderId: result.orderId }
        default:
          return { path: '/orders/return/error' }
      }
    case 'verify_inconclusive':
      // EPS says pending or unknown. Webhook re-delivery will reconcile.
      return { path: '/orders/return/pending', orderId: result.orderId }
    case 'invalid_transition':
      // Race condition: another path (webhook or different redirect)
      // already settled the order to a status we can't legally
      // transition from. Treat as success-shaped since we know SOME
      // settlement happened; the frontend page can read the actual
      // status by orderId.
      return { path: '/orders/return/success', orderId: result.orderId }
    case 'unknown_transaction':
    default:
      return { path: '/orders/return/error' }
  }
}

function buildReturnUrl(result: SettlementResult): string {
  const { path, orderId } = pageForResult(result)
  const base = webBaseUrl()
  if (orderId) {
    return `${base}${path}?orderId=${encodeURIComponent(orderId)}`
  }
  return `${base}${path}`
}

// ─── zod schema for query param ─────────────────────────────────────

/**
 * `merchantTransactionId` must satisfy our own minting contract
 * (§11.4: ≥10 chars). We accept both the camelCase form (matching
 * the outbound init body field name) and the snake_case alias
 * (common gateway convention for query params).
 */
const querySchema = z
  .object({
    merchantTransactionId: z.string().min(10).max(120).optional(),
    merchant_transaction_id: z.string().min(10).max(120).optional(),
  })
  .passthrough()

function pickTxnId(q: {
  merchantTransactionId?: string
  merchant_transaction_id?: string
}): string | null {
  return q.merchantTransactionId ?? q.merchant_transaction_id ?? null
}

// ─── handler factory (shared shape for all 3 paths) ─────────────────

function makeReturnHandler(source: SettlementSource) {
  return async (c: import('hono').Context) => {
    const q = c.req.query() as { merchantTransactionId?: string; merchant_transaction_id?: string }
    const parseResult = querySchema.safeParse(q)
    if (!parseResult.success) {
      // Malformed query — redirect to the error page (NEVER show
      // a backend-shaped error to a buyer in a browser).
      try {
        return c.redirect(`${webBaseUrl()}/orders/return/error`, 302)
      } catch {
        return c.text('Bad request', 400)
      }
    }
    const merchantTransactionId = pickTxnId(parseResult.data)
    if (!merchantTransactionId) {
      logger.warn({ source }, 'redirect.malformed.no_txn_id')
      try {
        return c.redirect(`${webBaseUrl()}/orders/return/error`, 302)
      } catch {
        return c.text('Bad request', 400)
      }
    }

    let result: SettlementResult
    try {
      result = await settleOrderFromEps({ merchantTransactionId, source })
    } catch (err) {
      // EPS verify failed at the HTTP layer. Don't surface a 500 to
      // the buyer — redirect to the pending page so the frontend can
      // retry/poll; the webhook will reconcile in the background.
      if (err instanceof EpsNetworkError || err instanceof EpsResponseError) {
        logger.warn(
          {
            source,
            merchantTransactionId,
            err: (err as Error).message,
            errClass: (err as Error).name,
          },
          'redirect.eps_verify_failed',
        )
        try {
          return c.redirect(`${webBaseUrl()}/orders/return/pending`, 302)
        } catch {
          return c.text('Service unavailable', 503)
        }
      }
      throw err
    }

    try {
      const url = buildReturnUrl(result)
      return c.redirect(url, 302)
    } catch (err) {
      // EVENTPULSE_WEB_BASE_URL misconfigured — log + inline 500.
      // This is an infra problem, not a buyer-facing payment problem.
      logger.error({ err: (err as Error).message }, 'redirect.web_base_url_missing')
      return c.text('Service misconfigured', 500)
    }
  }
}

// ─── route bindings ─────────────────────────────────────────────────

epsReturnRoutes.get('/success', makeReturnHandler('redirect_success'))
epsReturnRoutes.get('/fail', makeReturnHandler('redirect_fail'))
epsReturnRoutes.get('/cancel', makeReturnHandler('redirect_cancel'))
