/**
 * EPS in-house wrapper — public surface (Part 1 + Part 2).
 *
 * Per `.claude/memory/decisions.md` "EPS library choice locked for
 * Sprint 3 — in-house wrapper" (2026-05-19): no SDK; we own the
 * client. CLAUDE.md §11.2 is the spec for this file.
 *
 * **File-level architecture:**
 *
 *   - `./core.ts` — primitives: cfg, http, BASE_URLS, EpsConfig,
 *     EpsConfigError, EpsNotImplementedError, defaultTokenCache,
 *     _accessTokenCacheKey. Per-endpoint files import from HERE.
 *
 *   - `./get-token.ts`, `./initialise-order.ts`, `./verify-order.ts` —
 *     real HTTP implementations. Each imports from `./core.ts` only.
 *
 *   - `./client.ts` (this file) — public surface. Re-exports the
 *     primitives + defines thin orchestration wrappers
 *     (`getAccessToken`, `initialiseOrder`, `verifyOrder`) that
 *     callers consume. Importing from `./client.js` is the canonical
 *     way to reach the wrapper — no consumer should need to know the
 *     internal split.
 *
 * The split exists to avoid an import cycle that would otherwise
 * arise between client.ts (re-exporting endpoint wrappers) and the
 * endpoint files (importing primitives from client.ts).
 *
 * **Part 1 (Day 24, shipped):**
 *   - cfg, BASE_URLS, http, defaultTokenCache, three error classes
 *   - STAGING_PAYMENT_BLOCK guard wiring on initialiseOrder
 *   - Cache-hit path for getAccessToken
 *
 * **Part 2 (Day 26, shipped):**
 *   - Real `GetToken` POST → JWT parse → cache.set with EPS-derived TTL
 *   - Real `InitializeEPS` POST → redirect URL extraction + 401-refresh-and-retry
 *   - Real `CheckMerchantTransactionStatus` POST → normaliseStatus
 *   - Two new greppable error classes: `EpsNetworkError` (no parseable
 *     response) / `EpsResponseError` (parseable but unusable)
 *
 * **Deferred (Day 26 Phase 2):**
 *   - Swap `inMemoryTokenCache` → `redisTokenCache` at the
 *     `setDefaultTokenCache` seam in `./core.ts`.
 */

// ─── re-exports from sibling primitives + error/status modules ──────────

export { signEpsField } from './hash.js'
export { normaliseStatus, type EpsStatus } from './normalise-status.js'
export {
  assertEpsCallAllowed,
  isStagingPaymentBlockEnabled,
  StagingPaymentBlockedError,
} from './staging-payment-block.js'
export { inMemoryTokenCache, type TokenCache } from './token-cache.js'
export { EpsNetworkError, EpsResponseError } from './eps-http-errors.js'

// ─── re-exports from core (primitives + error classes) ──────────────────

export {
  cfg,
  http,
  BASE_URLS,
  type EpsMode,
  type EpsConfig,
  EpsConfigError,
  EpsNotImplementedError,
  defaultTokenCache,
  setDefaultTokenCache,
  _resetTokenCacheForTest,
  _seedAccessTokenForTest,
  _accessTokenCacheKey,
  _defaultAccessTokenTtlSec,
} from './core.js'

// ─── re-exports from per-endpoint implementations ───────────────────────

export type { InitialiseOrderInput, InitialiseOrderResult } from './initialise-order.js'
export type { VerifyOrderInput, VerifyOrderResult } from './verify-order.js'

import { _accessTokenCacheKey, defaultTokenCache } from './core.js'
import { fetchAccessTokenFromEps } from './get-token.js'
import {
  initialiseOrderHttp,
  type InitialiseOrderInput,
  type InitialiseOrderResult,
} from './initialise-order.js'
import { type EpsStatus } from './normalise-status.js'
import { type TokenCache } from './token-cache.js'
import { verifyOrderHttp, type VerifyOrderInput, type VerifyOrderResult } from './verify-order.js'

// ─── public wrapper surface ─────────────────────────────────────────────

/**
 * Get a usable EPS access token. Cache hit returns the cached value;
 * cache miss fetches a fresh one via `./get-token.ts` and caches it
 * for the EPS-reported TTL (minus a 60s safety margin).
 *
 * @throws {EpsConfigError} missing EPS_* env vars
 * @throws {EpsNetworkError} GetToken HTTP layer failure
 * @throws {EpsResponseError} GetToken response unusable
 */
export async function getAccessToken(cache: TokenCache = defaultTokenCache()): Promise<string> {
  const cached = await cache.get(_accessTokenCacheKey)
  if (cached) return cached
  const { token, ttlSeconds } = await fetchAccessTokenFromEps()
  await cache.set(_accessTokenCacheKey, token, ttlSeconds)
  return token
}

/**
 * Initialise an EPS order. Block-guard fires FIRST (no env reads, no
 * HTTP construction, no network calls when blocked). Implementation
 * detail in `./initialise-order.ts`; this is the public surface.
 *
 * @throws {StagingPaymentBlockedError} block on + priced order
 * @throws {RangeError} merchantTransactionId < 10 chars
 * @throws {EpsConfigError} missing EPS_* env vars
 * @throws {EpsNetworkError} HTTP layer failure (no response)
 * @throws {EpsResponseError} non-2xx, malformed body, missing RedirectURL
 */
export async function initialiseOrder(input: InitialiseOrderInput): Promise<InitialiseOrderResult> {
  return initialiseOrderHttp(input)
}

/**
 * Verify an EPS transaction's final status. No block-guard — Verify
 * is read-only. Implementation in `./verify-order.ts`.
 *
 * @throws {RangeError} merchantTransactionId < 10 chars
 * @throws {EpsConfigError} missing EPS_* env vars
 * @throws {EpsNetworkError} HTTP layer failure
 * @throws {EpsResponseError} non-2xx, malformed body
 */
export async function verifyOrder(input: VerifyOrderInput): Promise<VerifyOrderResult> {
  return verifyOrderHttp(input)
}

// Re-export the bare types referenced by the wrappers' return types
// so callers see the canonical shape names without separate imports.
export type { EpsStatus as _EpsStatusReexport }
