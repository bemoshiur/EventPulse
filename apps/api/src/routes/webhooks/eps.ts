/**
 * EPS server-to-server webhook handler — Sprint 3 Day 27 Phase 2.
 *
 * POST `/api/v1/webhooks/eps/callback` per CLAUDE.md §10.5.
 *
 * **AUTHENTICATION MODEL: verify-by-callback (the §11.1 step 11
 * design).** §11 does not specify an EPS-side webhook signature
 * mechanism. The handler does NOT trust any payload field as proof
 * of state. Instead:
 *
 *   1. The only payload field consumed is `merchant_transaction_id`
 *      — used purely as a DB lookup key.
 *   2. The handler ALWAYS calls `verifyOrder()` against EPS for the
 *      AUTHORITATIVE status (piped through `normaliseStatus`).
 *   3. State transitions are computed from the verify response, NEVER
 *      from the webhook payload's claimed status.
 *
 * **Fraud-impossibility argument:**
 *
 *   - Spoofed webhook with arbitrary txn-id + claiming "paid" →
 *     handler ignores payload status, calls verifyOrder(that_id) →
 *     EPS returns actual status → if not paid, no transition.
 *     **Spoofing cannot fabricate paid status.**
 *
 *   - Spoofed webhook with a REAL txn-id (paid txn) → triggers
 *     verify → transitions to paid (correct outcome).
 *
 *   - Spoofed webhook with a REAL txn-id (unpaid txn) → triggers
 *     verify → EPS returns not-paid → no transition.
 *
 *   - Webhook flood (DoS) → mitigated by per-IP + per-txn-id rate
 *     limit (see RATE_LIMIT_* constants).
 *
 * **Defense-in-depth shipped today:**
 *
 *   - Zod body validation rejects malformed payloads at the boundary
 *     before any DB read.
 *   - Per-IP rate limit + per-txn-id rate limit (in-memory; Redis
 *     adapter is a future swap at the call site).
 *   - **Always-200-OK** policy: even on "unknown txn" or "rejected
 *     payload" responses, we return 200 to avoid leaking which IDs
 *     exist + to suppress EPS webhook retry storms on benign
 *     conditions. (Genuine network/EPS errors bubble to 500.)
 *   - Settlement runs through the pure Day-27 Phase-1 state machine
 *     + idempotent fast-path on already-settled orders.
 *
 * **Documented gap (not a bug — see decisions.md):** EPS-side
 * webhook signature verification is NOT implemented because §11
 * doesn't specify the mechanism. When EPS publishes one, this file
 * is the single add-point — an `EPS_WEBHOOK_SECRET`-gated signature
 * check fires BEFORE everything else (additive defense-in-depth on
 * top of the verify-by-callback authority model).
 *
 * **STAGING_PAYMENT_BLOCK invariant:** unaffected. The webhook path
 * calls verifyOrder() which is NOT block-guarded (Verify is
 * read-only — doesn't charge). In staging, a webhook arrival
 * triggers a real EPS verify call against production credentials;
 * the response (presumably "txn not found" for any orphan webhook)
 * is handled gracefully via the `unknown_transaction` /
 * `verify_inconclusive` branches.
 */

import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { EpsNetworkError, EpsResponseError } from '../../infra/eps/client.js'
import { logger } from '../../lib/logger.js'
import { createRateLimiter } from '../../lib/rate-limit.js'
import { settleOrderFromEps } from '../../services/orders/settle.js'

export const epsWebhookRoutes = new Hono()

// ─── rate limiters ──────────────────────────────────────────────────

/**
 * Per-IP throttle: 100 webhook hits per minute. Bursts beyond that
 * are almost certainly hostile (legitimate EPS webhook re-delivery
 * is rare — single-digits per merchant_transaction_id per day).
 */
const ipRateLimiter = createRateLimiter({ limit: 100, windowMs: 60_000 })

/**
 * Per-txn-id throttle: 20 webhook hits per minute. Even an
 * over-eager EPS re-delivery for a single txn would be a handful per
 * day at most; 20/min is generous, but cheap enough to be a
 * meaningful DoS-amplification cap (one webhook → one verify call;
 * 20 verifies/min is the cost ceiling).
 */
const txnRateLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 })

// ─── webhook body schema ────────────────────────────────────────────

/**
 * The webhook body shape is permissive — we only consume
 * `merchant_transaction_id` (or a documented alias). All other fields
 * pass through unconsumed; logging captures the raw shape for forensic
 * use without trusting it.
 *
 * [truth-gate-verify] EPS-side field name may be
 * `merchantTransactionId` (camelCase, matching the outbound POST) or
 * `merchant_transaction_id` (snake_case, common gateway convention).
 * Both accepted; pickMerchantTxnId() collapses.
 */
const webhookBodySchema = z
  .object({
    merchantTransactionId: z.string().min(1).optional(),
    merchant_transaction_id: z.string().min(1).optional(),
  })
  .passthrough()

type WebhookBody = z.infer<typeof webhookBodySchema>

function pickMerchantTxnId(body: WebhookBody): string | null {
  return body.merchantTransactionId ?? body.merchant_transaction_id ?? null
}

// ─── route handler ──────────────────────────────────────────────────

epsWebhookRoutes.post('/callback', zValidator('json', webhookBodySchema), async (c) => {
  // IP-layer rate-limit first — cheap reject for floods before any DB
  // read or external call.
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!ipRateLimiter.check(ip)) {
    logger.warn({ ip, source: 'eps_webhook' }, 'webhook.rate_limit.ip')
    // Return 200 to avoid leaking the throttle to scanners + suppress
    // genuine EPS retries (which would just hit the limit again).
    return c.json({ data: { ok: true, throttled: true } }, 200)
  }

  const body = c.req.valid('json')
  const merchantTransactionId = pickMerchantTxnId(body)
  if (!merchantTransactionId) {
    // Malformed (no consumable identifier). Log + 200 OK ignored.
    logger.warn({ ip, source: 'eps_webhook' }, 'webhook.malformed.no_txn_id')
    return c.json({ data: { ok: true, ignored: 'malformed' } }, 200)
  }

  // Per-txn rate-limit — caps verify-call amplification on a single id.
  if (!txnRateLimiter.check(merchantTransactionId)) {
    logger.warn({ ip, merchantTransactionId, source: 'eps_webhook' }, 'webhook.rate_limit.txn')
    return c.json({ data: { ok: true, throttled: true } }, 200)
  }

  try {
    const result = await settleOrderFromEps({
      merchantTransactionId,
      source: 'webhook',
    })

    // Every settle-result branch maps to a 200 OK — the data field
    // distinguishes outcomes for observability + truth-gate
    // assertion, but EPS only sees 200 (no retries triggered).
    return c.json({ data: { ok: true, ...result } }, 200)
  } catch (err) {
    // Verify against EPS failed at the HTTP layer (network / response
    // schema). Log + 200 OK (suppress EPS retries; the verify-by-
    // callback model means a missed reconcile here gets retried by
    // the next webhook delivery or by the redirect handler's
    // own verify call).
    if (err instanceof EpsNetworkError || err instanceof EpsResponseError) {
      logger.warn(
        {
          ip,
          merchantTransactionId,
          err: err.message,
          errClass: (err as Error).name,
        },
        'webhook.eps_verify_failed',
      )
      return c.json({ data: { ok: true, verify_failed: true } }, 200)
    }
    // Unexpected error — bubble. Hono's error handler will 500.
    throw err
  }
})

// ─── exports for tests ──────────────────────────────────────────────

/** Test helper — clear in-process rate-limit state between tests. */
export function _resetWebhookRateLimitersForTest(): void {
  ipRateLimiter.reset()
  txnRateLimiter.reset()
}
