/**
 * Minimal in-memory rate limiter — Sprint 3 Day 27 Phase 2.
 *
 * Fixed-window counter per key, single-process. Used as defense-in-
 * depth on the EPS webhook endpoint (`apps/api/src/routes/webhooks/
 * eps.ts`) — the verify-by-callback security model handles
 * fraud-prevention; this layer prevents a DoS via webhook flood.
 *
 * **Scope (deliberately narrow):**
 *   - In-memory only — each PM2 worker enforces independently.
 *     2 workers × N/min = 2N/min total worst case, acceptable for
 *     the webhook endpoint at MVP scale.
 *   - Fixed window (not sliding) — simpler, well-understood,
 *     adequate for the threat model (block bursts, not micro-
 *     bursts at window boundaries).
 *   - No persistence — process restart resets all counters.
 *     Acceptable because (a) restart is rare in steady state, and
 *     (b) the verify-by-callback model means a momentary
 *     rate-limit gap can't fabricate fraud, only briefly raise
 *     the per-worker GetToken+Verify cost.
 *
 * **What it is NOT:**
 *   - NOT the production-scale rate limiter for the auth surface
 *     (which is Redis-backed per §5.2 — landed elsewhere).
 *   - NOT the Day 29 idempotency middleware (which dedupes
 *     `Idempotency-Key`-header requests on money-moving endpoints).
 *   - NOT a token bucket (we don't need burst-smoothing here).
 *
 * **Future:** if a higher-scale need surfaces, swap to a Redis-backed
 * adapter at the same call site — the function returns a simple
 * boolean and the data shape is window-keyed, so the swap is
 * mechanical.
 *
 * **Implementation notes:**
 *   - Map<key, {count, windowStart}>. windowStart is the start of
 *     the current fixed window (Date.now() floored to bucket).
 *   - Stale entries are cleaned lazily on access. A periodic sweep
 *     isn't needed at the rate we expect.
 *   - Pure function `checkRateLimit` over the closure'd Map; no
 *     side-effects beyond the map mutation.
 */

export interface RateLimiter {
  /**
   * Returns `true` if the request is allowed, `false` if it should be
   * rejected. Mutates internal state on every call to track the count.
   */
  check(key: string): boolean
  /** For tests: clear all state. */
  reset(): void
  /** For tests: peek at the current count for a key (or 0). */
  count(key: string): number
}

export interface RateLimiterOptions {
  /** Maximum requests allowed per window. */
  limit: number
  /** Window size in milliseconds. */
  windowMs: number
  /**
   * Clock injection — defaults to Date.now. Tests pass a controllable
   * clock to verify window-boundary behaviour without sleeping.
   */
  now?: () => number
}

/**
 * Create a fresh rate limiter with the given config. Each instance
 * holds its own state map; instances do NOT share state.
 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = opts
  const now = opts.now ?? Date.now
  if (limit < 1) throw new RangeError(`limit must be >= 1; received ${limit}`)
  if (windowMs < 1) throw new RangeError(`windowMs must be >= 1; received ${windowMs}`)

  const state = new Map<string, { count: number; windowStart: number }>()

  return {
    check(key: string): boolean {
      const t = now()
      const bucketStart = Math.floor(t / windowMs) * windowMs
      const entry = state.get(key)
      if (!entry || entry.windowStart !== bucketStart) {
        state.set(key, { count: 1, windowStart: bucketStart })
        return true
      }
      if (entry.count >= limit) {
        return false
      }
      entry.count += 1
      return true
    },

    reset(): void {
      state.clear()
    },

    count(key: string): number {
      return state.get(key)?.count ?? 0
    },
  }
}
