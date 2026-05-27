/**
 * EPS InitializeEPS — real HTTP wire-up. Part 2 of the in-house wrapper.
 *
 * Per CLAUDE.md §11 + §11.4:
 *   - POST `/api/v1/InitializeEPS` to the active mode's base URL
 *   - Headers:
 *     - `Authorization: Bearer <jwt>` (from GetToken via the cache)
 *     - `x-hash: <HMAC-SHA512 Base64 of merchantTransactionId, keyed by hashKey>`
 *   - Body (defensively typed; §11.4 + SDK shape):
 *     - `merchantId`, `storeId`              — platform identity
 *     - `merchantTransactionId`              — our reference id; must be globally
 *                                              unique per merchant + min 10 chars
 *     - `totalAmount`                        — BDT *decimal*, e.g. "1000.00"
 *                                              (EPS rate card is decimal; we hold
 *                                              paisa internally per §1.3 R2 +
 *                                              format at the boundary)
 *     - `transactionTypeId: 1`               — 1=Web per §11.4
 *     - `successUrl`, `failUrl`, `cancelUrl` — buyer-return targets (from env)
 *   - Response: `RedirectURL` to the buyer-facing hosted checkout page
 *
 * **Safety invariant (§1.3 R3 + §11.0):**
 *   `assertEpsCallAllowed(input.totalPaisa)` is the FIRST line of this
 *   function. It throws `StagingPaymentBlockedError` BEFORE any
 *   credential is loaded, any HTTP request is constructed, or any
 *   network call is made. The block is tested by asserting nock NEVER
 *   sees a request when the block is on — not just that the call
 *   throws (a future regression could throw AFTER firing the request).
 *
 * **401-retry semantics (§11.4 gotcha):**
 *   If the cached JWT expired between cache hit + InitializeEPS call,
 *   EPS returns 401. The wrapper invalidates the cache + fetches a
 *   fresh token + retries ONCE. A second 401 is treated as a real
 *   credential problem (`EpsResponseError` with httpStatus=401).
 *
 * **No PII in logs (§1.3 R5):** `buyer_*` fields don't flow through
 * this layer; only `merchantTransactionId` (our own non-PII reference)
 * + amount metadata. Logs use deterministic identifiers only.
 */

import { type AxiosError } from 'axios'
import { z } from 'zod'

import { logger } from '../../lib/logger.js'
import {
  _accessTokenCacheKey,
  defaultEpsCallDeps,
  EpsConfigError,
  type EpsCallDeps,
} from './core.js'
import { EpsNetworkError, EpsResponseError } from './eps-http-errors.js'
import { fetchAccessTokenFromEps } from './get-token.js'
import { signEpsField } from './hash.js'
import { assertEpsCallAllowed } from './staging-payment-block.js'

/**
 * Caller-supplied: the minimum the wrapper needs to construct an
 * EPS init request. Day 26 keeps this narrow — buyer-facing fields
 * stay in the order-creation layer; this wrapper is the wire-shape
 * boundary only.
 */
export interface InitialiseOrderInput {
  /** Our reference id. §11.4: globally unique per merchant + min 10 chars. */
  merchantTransactionId: string
  /** Total to charge in PAISA (bigint per §1.3 R2). Wrapper formats to BDT-decimal at the wire. */
  totalPaisa: bigint
}

export interface InitialiseOrderResult {
  redirectUrl: string
  /** Raw response body — captured for audit + truth-gate observation. */
  raw: unknown
}

/**
 * §11.4: `merchantTransactionId` must be globally unique per merchant
 * AND >= 10 chars. The caller (order creation in Day 26 Phase 4)
 * already mints IDs meeting these constraints, but defence-in-depth.
 */
const MERCHANT_TXN_ID_MIN_LENGTH = 10

/**
 * EPS InitializeEPS response shape — defensively typed + passthrough.
 * `RedirectURL` is the only field we consume; aliases captured
 * defensively in case EPS varies casing.
 *
 * [truth-gate-verify] EPS field name may be `RedirectURL` (per SDK
 * source) or `redirectUrl`. Both accepted; pick-fn collapses.
 */
const InitializeEPSResponseSchema = z
  .object({
    RedirectURL: z.string().min(1).optional(),
    redirectUrl: z.string().min(1).optional(),
    Code: z.string().optional(),
    Message: z.string().optional(),
  })
  .passthrough()

type InitializeEPSResponse = z.infer<typeof InitializeEPSResponseSchema>

function pickRedirectUrl(body: InitializeEPSResponse): string | null {
  return body.RedirectURL ?? body.redirectUrl ?? null
}

/**
 * Format a bigint paisa into the BDT-decimal string EPS expects:
 *   100_000n paisa → "1000.00"
 *      55n  paisa → "0.55"
 *       7n  paisa → "0.07"
 *
 * EPS's `totalAmount` field is a decimal string. We hold paisa as
 * bigint internally per §1.3 R2 "money never lies"; this is the
 * single point where we cross into BDT-decimal at the wire. Pure
 * function, deterministic, no floating-point arithmetic.
 *
 * Negative amounts throw — EPS does not accept negatives, and a
 * caller passing one represents a calculator bug we want to surface
 * loudly rather than silently format.
 */
export function formatPaisaForEpsWire(paisa: bigint): string {
  if (paisa < 0n) {
    throw new RangeError(`paisa must be non-negative; received ${paisa}`)
  }
  const taka = paisa / 100n
  const subTaka = paisa % 100n
  const subTakaStr = subTaka.toString().padStart(2, '0')
  return `${taka.toString()}.${subTakaStr}`
}

function pickStringField(data: unknown, field: string): string | null {
  if (data == null || typeof data !== 'object') return null
  const value = (data as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

/**
 * Read the three buyer-return URLs from env. Separated from `cfg()`
 * so existing call sites that don't need them (test setup, GetToken
 * paths) aren't broken by adding the URLs to the required-env list.
 * InitializeEPS is the only consumer.
 *
 * Throws `EpsConfigError` if any is missing — fail-loud before HTTP
 * fires.
 */
export function readInitRedirectUrls(): {
  successUrl: string
  failUrl: string
  cancelUrl: string
} {
  const successUrl = process.env['EPS_SUCCESS_URL']
  const failUrl = process.env['EPS_FAIL_URL']
  const cancelUrl = process.env['EPS_CANCEL_URL']
  const missing: string[] = []
  if (!successUrl) missing.push('EPS_SUCCESS_URL')
  if (!failUrl) missing.push('EPS_FAIL_URL')
  if (!cancelUrl) missing.push('EPS_CANCEL_URL')
  if (missing.length > 0) {
    throw new EpsConfigError(`EPS init env vars missing: ${missing.join(', ')}`)
  }
  return { successUrl: successUrl!, failUrl: failUrl!, cancelUrl: cancelUrl! }
}

/**
 * The real `initialiseOrder` implementation. Day 26 Phase 1 deliverable.
 *
 * Block-guard ordering invariant: `assertEpsCallAllowed` MUST be the
 * first line that can throw. The test pinning this is in
 * `initialise-order.test.ts` — it asserts nock sees ZERO requests
 * when the block is on and a priced order is attempted.
 */
export async function initialiseOrderHttp(
  input: InitialiseOrderInput,
  deps?: EpsCallDeps,
): Promise<InitialiseOrderResult> {
  // 1. SAFETY GUARD FIRST. No env reads, no HTTP construction, no
  //    network, no deps resolution. Throws StagingPaymentBlockedError
  //    if block on + totalPaisa > 0.
  assertEpsCallAllowed(input.totalPaisa)

  // 2. Validate input format before any external work.
  if (input.merchantTransactionId.length < MERCHANT_TXN_ID_MIN_LENGTH) {
    throw new RangeError(
      `merchantTransactionId must be >= ${MERCHANT_TXN_ID_MIN_LENGTH} chars; received ${input.merchantTransactionId.length}`,
    )
  }

  // 3. Resolve deps AFTER the guard. When omitted (every running-service
  //    path), defaultEpsCallDeps() reads env here — NOT at call entry —
  //    preserving the §11.0 "guard fires before any env read" invariant.
  //    The truth-gate harness injects sandbox deps instead.
  const d = deps ?? defaultEpsCallDeps()

  // 4. Redirect URLs: sandbox deps carry their own; the env path reads
  //    them from EPS_*_URL (may throw EpsConfigError).
  const redirects = d.redirectUrls ?? readInitRedirectUrls()

  // 5. Get access token (cache or fetch). May throw various error types.
  const token = await getOrFetchToken(d)
  return performInitWithRetry(input, token, d, redirects, /* retried */ false)
}

async function getOrFetchToken(deps: EpsCallDeps): Promise<string> {
  const cached = await deps.cache.get(_accessTokenCacheKey)
  if (cached) return cached
  const { token, ttlSeconds } = await fetchAccessTokenFromEps(deps)
  await deps.cache.set(_accessTokenCacheKey, token, ttlSeconds)
  return token
}

async function performInitWithRetry(
  input: InitialiseOrderInput,
  token: string,
  deps: EpsCallDeps,
  redirects: { successUrl: string; failUrl: string; cancelUrl: string },
  retried: boolean,
): Promise<InitialiseOrderResult> {
  const { config, client } = deps
  const requestId = `eps-init-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const xHash = signEpsField(input.merchantTransactionId, config.hashKey)

  const body = {
    merchantId: config.merchantId,
    storeId: config.storeId,
    merchantTransactionId: input.merchantTransactionId,
    totalAmount: formatPaisaForEpsWire(input.totalPaisa),
    transactionTypeId: 1, // 1=Web per §11.4
    successUrl: redirects.successUrl,
    failUrl: redirects.failUrl,
    cancelUrl: redirects.cancelUrl,
  }

  const startMs = Date.now()
  let response
  try {
    response = await client.post('/api/v1/InitializeEPS', body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-hash': xHash,
      },
    })
  } catch (err) {
    const durationMs = Date.now() - startMs
    const axiosErr = err as AxiosError
    if (axiosErr.response) {
      // 401 + not yet retried → refresh token + retry once.
      if (axiosErr.response.status === 401 && !retried) {
        logger.info(
          { eps: { endpoint: 'InitializeEPS', requestId, mode: config.mode } },
          'eps.init.refresh_token_and_retry',
        )
        await deps.cache.set(_accessTokenCacheKey, '', 0) // invalidate
        const { token: fresh, ttlSeconds } = await fetchAccessTokenFromEps(deps)
        await deps.cache.set(_accessTokenCacheKey, fresh, ttlSeconds)
        return performInitWithRetry(input, fresh, deps, redirects, true)
      }
      logger.warn(
        {
          eps: {
            endpoint: 'InitializeEPS',
            requestId,
            mode: config.mode,
            httpStatus: axiosErr.response.status,
            durationMs,
          },
        },
        'eps.init.http_error',
      )
      throw new EpsResponseError(`EPS InitializeEPS returned HTTP ${axiosErr.response.status}`, {
        httpStatus: axiosErr.response.status,
        epsCode: pickStringField(axiosErr.response.data, 'Code'),
        epsMessage: pickStringField(axiosErr.response.data, 'Message'),
        requestId,
      })
    }
    logger.warn(
      {
        eps: { endpoint: 'InitializeEPS', requestId, mode: config.mode, durationMs },
        err: (err as Error).message,
      },
      'eps.init.network_failure',
    )
    throw new EpsNetworkError('EPS InitializeEPS network failure', err, requestId)
  }

  const durationMs = Date.now() - startMs
  logger.info(
    {
      eps: {
        endpoint: 'InitializeEPS',
        requestId,
        mode: config.mode,
        httpStatus: response.status,
        durationMs,
      },
    },
    'eps.init.ok',
  )

  const parseResult = InitializeEPSResponseSchema.safeParse(response.data)
  if (!parseResult.success) {
    throw new EpsResponseError('EPS InitializeEPS response failed schema validation', {
      httpStatus: response.status,
      requestId,
    })
  }
  const redirectUrl = pickRedirectUrl(parseResult.data)
  if (!redirectUrl) {
    throw new EpsResponseError('EPS InitializeEPS response missing RedirectURL', {
      httpStatus: response.status,
      epsCode: parseResult.data.Code ?? null,
      epsMessage: parseResult.data.Message ?? null,
      requestId,
    })
  }
  return { redirectUrl, raw: parseResult.data }
}
