/**
 * EPS in-house wrapper — Day 24 Part 1 entrypoint.
 *
 * Per `.claude/memory/decisions.md` "EPS library choice locked for
 * Sprint 3 — in-house wrapper" (2026-05-19): no SDK; we own the
 * client. CLAUDE.md §11.2 is the spec for this file.
 *
 * **Part 1 scope (what ships now):**
 *   - `cfg()` env reader with explicit throws on missing values
 *   - `BASE_URLS` constant for production vs sandbox routing
 *   - axios instance factory (`http()`)
 *   - `getAccessToken()` plumbing through the token cache (no
 *     real network call yet — throws EpsNotImplementedError when
 *     a cache miss would force a network call)
 *   - `initialiseOrder()` STUB — enforces the STAGING_PAYMENT_BLOCK
 *     guard, then throws EpsNotImplementedError because the real
 *     HTTP wire-up lands Day 26-28
 *   - `verifyOrder()` STUB — same shape; no guard (Verify doesn't
 *     charge so it isn't gated)
 *
 * **Part 2 scope (Day 26-28):**
 *   - Real `GetToken` POST + JWT parse → cache.set with TTL ~14 min
 *   - Real `InitializeEPS` POST + redirect URL extraction
 *   - Real `CheckMerchantTransactionStatus` POST + normaliseStatus
 *     → canonical `EpsStatus`
 *   - Replace `inMemoryTokenCache` with a `redisTokenCache` adapter
 *     once ioredis dep + Redis provisioning land alongside the order
 *     pipeline
 *
 * **What's deliberately NOT done in Part 1:**
 *   - No real network calls. Day 24 only ships the primitives + guard +
 *     stubs. The brief is explicit: "NO initialiseOrder real-call wired
 *     to a caller yet — build the method but it's guarded by Phase 1's
 *     block."
 *   - No Redis dep. The in-memory token cache is the Day 24+
 *     placeholder; Redis lands when the first real caller does.
 *
 * The §11.4 hash mechanism is exposed via `signEpsField` from
 * `./hash.js` so callers (and tests) can sign payloads without
 * reaching into client internals.
 */

import axios, { type AxiosInstance } from 'axios'

import { type EpsStatus } from './normalise-status.js'
import { assertEpsCallAllowed } from './staging-payment-block.js'
import { inMemoryTokenCache, type TokenCache } from './token-cache.js'

// Re-export primitives so callers import from `./client.js` as the
// canonical wrapper entrypoint.
export { signEpsField } from './hash.js'
export { normaliseStatus, type EpsStatus } from './normalise-status.js'
export {
  assertEpsCallAllowed,
  isStagingPaymentBlockEnabled,
  StagingPaymentBlockedError,
} from './staging-payment-block.js'
export { inMemoryTokenCache, type TokenCache } from './token-cache.js'

// ─── config ──────────────────────────────────────────────────────────────

export type EpsMode = 'production' | 'sandbox'

export const BASE_URLS: Record<EpsMode, string> = {
  production: 'https://pgapi.eps.com.bd',
  sandbox: 'https://sandbox-pgapi.eps.com.bd',
}

export interface EpsConfig {
  merchantId: string
  storeId: string
  username: string
  password: string
  hashKey: string
  mode: EpsMode
}

/**
 * Read EPS configuration from env. Throws if any required value is
 * missing — fail-loud at boot is strictly preferable to silently
 * failing the first real call.
 *
 * In staging the production credentials are populated alongside
 * STAGING_PAYMENT_BLOCK=1; see `.claude/memory/decisions.md`
 * "EPS production credentials intentionally used in staging" (2026-05-19).
 */
export function cfg(): EpsConfig {
  const merchantId = process.env['EPS_MERCHANT_ID']
  const storeId = process.env['EPS_STORE_ID']
  const username = process.env['EPS_USERNAME']
  const password = process.env['EPS_PASSWORD']
  const hashKey = process.env['EPS_HASH_KEY']
  const modeRaw = process.env['EPS_MODE'] ?? 'production'

  const missing: string[] = []
  if (!merchantId) missing.push('EPS_MERCHANT_ID')
  if (!storeId) missing.push('EPS_STORE_ID')
  if (!username) missing.push('EPS_USERNAME')
  if (!password) missing.push('EPS_PASSWORD')
  if (!hashKey) missing.push('EPS_HASH_KEY')

  if (missing.length > 0) {
    throw new EpsConfigError(`EPS env vars missing: ${missing.join(', ')}`)
  }
  if (modeRaw !== 'production' && modeRaw !== 'sandbox') {
    throw new EpsConfigError(
      `EPS_MODE must be 'production' or 'sandbox'; received '${modeRaw}'`,
    )
  }

  return {
    merchantId: merchantId!,
    storeId: storeId!,
    username: username!,
    password: password!,
    hashKey: hashKey!,
    mode: modeRaw,
  }
}

/**
 * Greppable. Thrown when cfg() or http() construction fails because
 * required env is absent. Distinct from `EpsNotImplementedError`
 * (which signals "real call not wired yet") and from
 * `StagingPaymentBlockedError` (which signals "real call refused by
 * guard"). Three distinct error classes lets the caller distinguish
 * "config bug" vs "scope gap" vs "intentional safety refusal".
 */
export class EpsConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpsConfigError'
  }
}

/**
 * Greppable. Thrown when a wrapper method that has no live HTTP
 * implementation yet is called. Distinct from
 * `StagingPaymentBlockedError` so a Day 26-28 caller can tell the
 * difference between "blocked deliberately" and "not yet built."
 */
export class EpsNotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpsNotImplementedError'
  }
}

// ─── HTTP client ────────────────────────────────────────────────────────

/**
 * Construct an axios instance pre-configured for the active EPS mode.
 * Reads `cfg().mode` at call time so PM2 reload with new env applies
 * without restart.
 *
 * `timeout: 15_000` ms aligns with §11.4 "EPS GetToken is fast but
 * InitializeEPS occasionally takes 5-10s" guidance; 15s keeps the
 * caller responsive without prematurely cancelling a slow gateway.
 */
export function http(): AxiosInstance {
  const config = cfg()
  return axios.create({
    baseURL: BASE_URLS[config.mode],
    timeout: 15_000,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── wrapper surface (Part 1 — primitives + stubs) ───────────────────────

/**
 * Minimum shape `initialiseOrder` needs from a caller. Expanded in
 * Day 26-28 when the real order pipeline wires through (will add
 * buyer details, amount breakdown, success/fail URLs, etc.). For
 * Part 1 only `totalPaisa` is consumed — used by the guard.
 */
export interface InitialiseOrderInput {
  merchantTransactionId: string
  totalPaisa: bigint
}

/**
 * Stub. Enforces the STAGING_PAYMENT_BLOCK guard FIRST — same line
 * that the Day 26-28 real implementation will keep. Then throws
 * EpsNotImplementedError because the real call isn't wired.
 *
 * Day 26-28 will replace the throw with: cfg() → getAccessToken() →
 * signEpsField(merchantTransactionId, cfg().hashKey) → POST
 * `/api/v1/InitializeEPS` → return `RedirectURL` from the validated
 * response body.
 */
export async function initialiseOrder(
  input: InitialiseOrderInput,
): Promise<{ redirectUrl: string }> {
  assertEpsCallAllowed(input.totalPaisa)
  throw new EpsNotImplementedError(
    'initialiseOrder wires the real EPS InitializeEPS call at Day 26-28 — Part 1 ships guard + primitives only',
  )
}

/**
 * Stub. No STAGING_PAYMENT_BLOCK guard because Verify never charges —
 * it only reads back transaction status. Day 26-28 will replace the
 * throw with: cfg() → getAccessToken() →
 * signEpsField(merchantTransactionId, cfg().hashKey) → POST
 * `/api/v1/CheckMerchantTransactionStatus` → normaliseStatus(body) →
 * return the canonical EpsStatus + raw payload.
 */
export async function verifyOrder(_input: {
  merchantTransactionId: string
}): Promise<{ status: EpsStatus; raw: unknown }> {
  throw new EpsNotImplementedError(
    'verifyOrder wires the real EPS CheckMerchantTransactionStatus call at Day 26-28 — Part 1 ships primitives only',
  )
}

/**
 * Default token cache for the running process. Module-level singleton
 * so all callers within a single PM2 worker share the cache. Day 26+
 * swaps this for a Redis-backed adapter when the order pipeline lands.
 */
let _defaultTokenCache: TokenCache | null = null
export function defaultTokenCache(): TokenCache {
  if (!_defaultTokenCache) {
    _defaultTokenCache = inMemoryTokenCache()
  }
  return _defaultTokenCache
}

/**
 * Test helper — reset the module-level cache singleton between tests.
 * Not exported through the public surface; tests import directly.
 */
export function _resetTokenCacheForTest(): void {
  _defaultTokenCache = null
}

/**
 * Cache key for the GetToken-derived JWT. Single-tenant per process
 * (the credentials are per-platform, not per-tenant), so a fixed key
 * is correct. If a future enterprise tier ever requires per-tenant
 * EPS credentials, this becomes a function of (tenantId, credHash).
 */
const ACCESS_TOKEN_CACHE_KEY = 'eps:access-token:v1'

/**
 * Token cache TTL — EPS JWT TTL is ~15 min per §11.4; 14 min cache
 * gives a 1-min safety margin against clock skew + in-flight calls.
 */
const ACCESS_TOKEN_CACHE_TTL_SEC = 14 * 60

/**
 * Stub. Looks up the cached access token first — returns it on hit.
 * On miss, Part 1 throws EpsNotImplementedError; Part 2 will perform
 * a real GetToken POST, parse the JWT, cache + return it.
 *
 * Cache hit path is fully wired so a future test can pre-seed the
 * cache and confirm `getAccessToken` returns the cached value
 * without throwing. This lets downstream code be developed against
 * the real shape today.
 */
export async function getAccessToken(
  cache: TokenCache = defaultTokenCache(),
): Promise<string> {
  const cached = await cache.get(ACCESS_TOKEN_CACHE_KEY)
  if (cached) return cached
  throw new EpsNotImplementedError(
    'getAccessToken wires the real EPS GetToken call at Day 26-28 — Part 1 ships the cache plumbing only. Cache hits work; cache misses throw until Part 2.',
  )
}

/**
 * Test helper to bypass the network for development — write a value
 * straight into the default cache. Not for production code paths.
 */
export async function _seedAccessTokenForTest(
  value: string,
  ttlSeconds: number = ACCESS_TOKEN_CACHE_TTL_SEC,
): Promise<void> {
  await defaultTokenCache().set(ACCESS_TOKEN_CACHE_KEY, value, ttlSeconds)
}

// Re-export the suppressed helper for callers that want to share the
// canonical key; useful for an admin "flush token" surface later.
export const _accessTokenCacheKey = ACCESS_TOKEN_CACHE_KEY
