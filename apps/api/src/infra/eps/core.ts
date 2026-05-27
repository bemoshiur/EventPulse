/**
 * EPS wrapper — primitives module.
 *
 * Holds env-reading, base-URL routing, HTTP factory, error classes,
 * and the module-level token-cache singleton. Per-endpoint
 * implementation files (`get-token.ts`, `initialise-order.ts`,
 * `verify-order.ts`) import from HERE — never from `client.ts` —
 * to keep the dependency graph acyclic.
 *
 * `client.ts` is the public surface: it re-exports from this module
 * + the per-endpoint files and defines the thin wrapper functions
 * (`getAccessToken`, `initialiseOrder`, `verifyOrder`) callers
 * consume. The split exists strictly to break what would otherwise
 * be a cycle between client.ts and the per-endpoint files.
 *
 * No public API change vs the Day-24 single-file shape — every
 * symbol still imports cleanly via `from './client.js'`.
 */

import axios, { type AxiosInstance } from 'axios'

import { inMemoryTokenCache, type TokenCache } from './token-cache.js'

// ─── config ──────────────────────────────────────────────────────────────

export type EpsMode = 'production' | 'sandbox'

export const BASE_URLS: Record<EpsMode, string> = {
  production: 'https://pgapi.eps.com.bd',
  // V4 sandbox guide + Postman collection: `sandboxpgapi.eps.com.bd`
  // (single word, no hyphen). An earlier incorrect `sandbox-pgapi.eps.com.bd`
  // value was caught at Day-36 truth-gate pre-flight; the hyphenated
  // hostname doesn't resolve.
  sandbox: 'https://sandboxpgapi.eps.com.bd',
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
 * Per-call dependency bundle for the real-HTTP wrapper endpoints
 * (`fetchAccessTokenFromEps`, `initialiseOrderHttp`, `verifyOrderHttp`).
 *
 * **Why this exists — the injection seam for the Decision-N truth-gate.**
 * The running api/worker processes never construct one of these: they
 * call the public surface (`initialiseOrder`/`verifyOrder`/`getAccessToken`
 * in `client.ts`) with no deps, so the wrapper resolves
 * {@link defaultEpsCallDeps} internally — which reads `EPS_MODE` (=
 * `production` on staging per `.claude/memory/decisions.md` "EPS
 * production credentials intentionally used in staging") and the
 * production base URL, and shares the module-level token-cache singleton.
 *
 * The ONLY code that supplies an explicit `EpsCallDeps` is the truth-gate
 * harness path (`./truth-gate/run-truth-gate.ts`), which injects a
 * SANDBOX bundle built by `./sandbox-config.ts` — its own axios client
 * pinned to the sandbox base URL + its own ephemeral token cache + a
 * config whose `mode` is hard-coded `'sandbox'` and loaded from Secrets
 * Manager, never from `process.env`. This is the structural enforcement
 * of bidirectional isolation: production callers cannot reach sandbox
 * (they never inject deps), and the harness cannot reach production (its
 * injected client's baseURL is the sandbox host and its config.mode is
 * sandbox). No shared mutable config state crosses the boundary.
 *
 * `config` + `client` are immutable here (passed by value); the only
 * mutable member is `cache`, and the sandbox path uses a fresh instance
 * so a sandbox token can never poison the running process's cache.
 */
export interface EpsCallDeps {
  config: EpsConfig
  client: AxiosInstance
  cache: TokenCache
  /**
   * InitializeEPS-only buyer-return URLs. When absent (the default/env
   * path), `initialiseOrderHttp` falls back to `readInitRedirectUrls()`
   * which reads `EPS_SUCCESS_URL`/`EPS_FAIL_URL`/`EPS_CANCEL_URL` from
   * env. The sandbox path supplies these explicitly so it touches no
   * env at all.
   */
  redirectUrls?: { successUrl: string; failUrl: string; cancelUrl: string }
}

/**
 * The default (env-bound, production-mode-on-staging) dependency bundle.
 *
 * **MUST be called from inside a wrapper function body, AFTER any safety
 * guard — never as a default parameter value.** Default-parameter
 * expressions evaluate at call entry, which would run `cfg()`/`http()`
 * (env reads) BEFORE `assertEpsCallAllowed` in `initialiseOrderHttp`,
 * violating the §11.0 "guard fires first, before any env read"
 * invariant pinned by `initialise-order.test.ts`.
 */
export function defaultEpsCallDeps(): EpsCallDeps {
  return { config: cfg(), client: http(), cache: defaultTokenCache() }
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
    throw new EpsConfigError(`EPS_MODE must be 'production' or 'sandbox'; received '${modeRaw}'`)
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

// ─── error classes ───────────────────────────────────────────────────────

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
 *
 * Day 26 Part 2 reduces the surface where this fires (real HTTP now
 * lives behind getAccessToken / initialiseOrder / verifyOrder); the
 * class stays to keep the three-class-distinct invariant + as a
 * surface for any future scope gap (e.g. refunds when EPS's public
 * refund API lands per §11.4).
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

// ─── token-cache singleton ──────────────────────────────────────────────

/**
 * Default token cache for the running process. Module-level singleton
 * so all callers within a single PM2 worker share the cache. Day 26
 * Phase 2 swaps the in-memory adapter for a Redis-backed one at this
 * seam — single call site to change.
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
 * Override the default cache adapter from outside (Phase 2 uses this
 * to swap in a Redis adapter at process boot). Idempotent — repeated
 * calls with the same adapter are no-ops.
 *
 * Public + named with a leading underscore-equivalent ("set" prefix
 * vs the singleton convention) so it's discoverable but not the
 * primary surface. Callers should prefer dependency-injecting a
 * cache directly to `getAccessToken(cache)` where they can.
 */
export function setDefaultTokenCache(cache: TokenCache): void {
  _defaultTokenCache = cache
}

/**
 * Cache key for the GetToken-derived JWT. Single-tenant per process
 * (the credentials are per-platform, not per-tenant), so a fixed key
 * is correct. If a future enterprise tier ever requires per-tenant
 * EPS credentials, this becomes a function of (tenantId, credHash).
 */
export const _accessTokenCacheKey = 'eps:access-token:v1'

/**
 * Default token cache TTL — EPS JWT TTL is ~15 min per §11.4; 14 min
 * default gives a 1-min safety margin against clock skew + in-flight
 * calls. The actual TTL used at set-time is derived from the EPS
 * `ExpiresIn` response field when present (`deriveTokenTtl` in
 * `./get-token.ts`); this constant is only used by the test-seed
 * helper below.
 */
export const _defaultAccessTokenTtlSec = 14 * 60

/**
 * Test helper to bypass the network for development — write a value
 * straight into the default cache. Not for production code paths.
 */
export async function _seedAccessTokenForTest(
  value: string,
  ttlSeconds: number = _defaultAccessTokenTtlSec,
): Promise<void> {
  await defaultTokenCache().set(_accessTokenCacheKey, value, ttlSeconds)
}
