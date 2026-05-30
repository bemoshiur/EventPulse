/**
 * EPS CheckMerchantTransactionStatus — real HTTP wire-up. Part 2 of the
 * in-house wrapper.
 *
 * Per CLAUDE.md §11 + §11.4:
 *   - POST `/api/v1/CheckMerchantTransactionStatus`
 *   - Headers:
 *     - `Authorization: Bearer <jwt>` (from GetToken via cache)
 *     - `x-hash: <HMAC-SHA512 Base64 of merchantTransactionId, keyed by hashKey>`
 *   - Body: `{ merchantId, storeId, merchantTransactionId }`
 *   - Response: an alias-laden status field (see normalise-status.ts)
 *
 * **No `STAGING_PAYMENT_BLOCK` guard on this path.** Per §11 + the
 * existing Part-1 stub: Verify is read-only — it doesn't charge —
 * so the safety gate does not apply. This is documented at the
 * `staging-payment-block.ts` module header + at the Part-1 stub.
 *
 * **§1.3 R3 implication for callers:** "Payment status comes from
 * EPS, not from the redirect." This function is the canonical
 * EPS-status read; the Day-27 callback handler is its primary
 * caller; the redirect-page handler is a SECONDARY caller that
 * MUST also call this (never trust the query-string status).
 *
 * **401-retry semantics:** same as init — one retry on token-expiry,
 * second 401 → `EpsResponseError` w/ httpStatus=401.
 */

import { type AxiosError } from 'axios'
import { z } from 'zod'

import { logger } from '../../lib/logger.js'
import { _accessTokenCacheKey, defaultEpsCallDeps, type EpsCallDeps } from './core.js'
import { EpsNetworkError, EpsResponseError } from './eps-http-errors.js'
import { fetchAccessTokenFromEps } from './get-token.js'
import { signEpsField } from './hash.js'
import { normaliseStatus, type EpsStatus } from './normalise-status.js'

export interface VerifyOrderInput {
  merchantTransactionId: string
}

export interface VerifyOrderResult {
  status: EpsStatus
  /** Raw EPS response — preserved for audit + reconciliation downstream. */
  raw: unknown
}

/**
 * §11.4: merchantTransactionId is the field hashed for Verify (could
 * also be EPSTransactionId; we use merchantTransactionId because we
 * always know it whereas EPSTransactionId is EPS-side-only).
 */
const MERCHANT_TXN_ID_MIN_LENGTH = 10

/**
 * Verify response is permissive — the normalise-status shim handles
 * field-location + alias variation; we just need to validate the
 * response is an object. `passthrough()` keeps all fields available
 * for downstream audit.
 */
const VerifyResponseSchema = z.object({}).passthrough()

function pickStringField(data: unknown, field: string): string | null {
  if (data == null || typeof data !== 'object') return null
  const value = (data as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

/**
 * Real verifyOrder. No payment-block guard (read-only call).
 */
export async function verifyOrderHttp(
  input: VerifyOrderInput,
  deps?: EpsCallDeps,
): Promise<VerifyOrderResult> {
  if (input.merchantTransactionId.length < MERCHANT_TXN_ID_MIN_LENGTH) {
    throw new RangeError(
      `merchantTransactionId must be >= ${MERCHANT_TXN_ID_MIN_LENGTH} chars; received ${input.merchantTransactionId.length}`,
    )
  }

  // No payment-block guard (read-only call). deps resolved here: omitted
  // → env/production (running services); injected → sandbox (harness).
  const d = deps ?? defaultEpsCallDeps()
  const token = await getOrFetchToken(d)
  return performVerifyWithRetry(input, token, d, /* retried */ false)
}

async function getOrFetchToken(deps: EpsCallDeps): Promise<string> {
  const cached = await deps.cache.get(_accessTokenCacheKey)
  if (cached) return cached
  const { token, ttlSeconds } = await fetchAccessTokenFromEps(deps)
  await deps.cache.set(_accessTokenCacheKey, token, ttlSeconds)
  return token
}

async function performVerifyWithRetry(
  input: VerifyOrderInput,
  token: string,
  deps: EpsCallDeps,
  retried: boolean,
): Promise<VerifyOrderResult> {
  const { config, client } = deps
  const requestId = `eps-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const xHash = signEpsField(input.merchantTransactionId, config.hashKey)

  const body = {
    merchantId: config.merchantId,
    storeId: config.storeId,
    merchantTransactionId: input.merchantTransactionId,
  }

  const startMs = Date.now()
  let response
  try {
    response = await client.post(config.paths.verify, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-hash': xHash,
      },
    })
  } catch (err) {
    const durationMs = Date.now() - startMs
    const axiosErr = err as AxiosError
    if (axiosErr.response) {
      if (axiosErr.response.status === 401 && !retried) {
        logger.info(
          { eps: { endpoint: 'CheckMerchantTransactionStatus', requestId, mode: config.mode } },
          'eps.verify.refresh_token_and_retry',
        )
        await deps.cache.set(_accessTokenCacheKey, '', 0)
        const { token: fresh, ttlSeconds } = await fetchAccessTokenFromEps(deps)
        await deps.cache.set(_accessTokenCacheKey, fresh, ttlSeconds)
        return performVerifyWithRetry(input, fresh, deps, true)
      }
      logger.warn(
        {
          eps: {
            endpoint: 'CheckMerchantTransactionStatus',
            requestId,
            mode: config.mode,
            httpStatus: axiosErr.response.status,
            durationMs,
          },
        },
        'eps.verify.http_error',
      )
      throw new EpsResponseError(
        `EPS CheckMerchantTransactionStatus returned HTTP ${axiosErr.response.status}`,
        {
          httpStatus: axiosErr.response.status,
          epsCode: pickStringField(axiosErr.response.data, 'Code'),
          epsMessage: pickStringField(axiosErr.response.data, 'Message'),
          requestId,
        },
      )
    }
    logger.warn(
      {
        eps: {
          endpoint: 'CheckMerchantTransactionStatus',
          requestId,
          mode: config.mode,
          durationMs,
        },
        err: (err as Error).message,
      },
      'eps.verify.network_failure',
    )
    throw new EpsNetworkError('EPS CheckMerchantTransactionStatus network failure', err, requestId)
  }

  const durationMs = Date.now() - startMs
  logger.info(
    {
      eps: {
        endpoint: 'CheckMerchantTransactionStatus',
        requestId,
        mode: config.mode,
        httpStatus: response.status,
        durationMs,
      },
    },
    'eps.verify.ok',
  )

  const parseResult = VerifyResponseSchema.safeParse(response.data)
  if (!parseResult.success) {
    throw new EpsResponseError(
      'EPS CheckMerchantTransactionStatus response failed schema validation',
      { httpStatus: response.status, requestId },
    )
  }
  const status = normaliseStatus(parseResult.data)
  return { status, raw: parseResult.data }
}
