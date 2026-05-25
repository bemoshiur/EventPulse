/**
 * Redis-backed token cache adapter — Day 26 Phase 2.
 *
 * Replaces the Day 24 Part 1 in-memory adapter (still kept as a
 * sibling for tests + local-dev fallback). The seam is
 * `setDefaultTokenCache(redisTokenCache(redisClient))` at app boot
 * in `apps/api/src/app.ts` (or wherever the boot wiring lives).
 *
 * Per CLAUDE.md §11.2 + the Day 26 brief:
 *   - EPS access token cached in Redis (shared across all PM2
 *     workers — NOT in-process memory; the point is one token
 *     reused, not re-auth per worker).
 *   - TTL set from the EPS token lifetime (with a safety margin so
 *     it refreshes before expiry — already enforced by
 *     `deriveTokenTtl` in `./get-token.ts`).
 *   - Concurrent-safety: if two workers miss simultaneously the
 *     refresh should not stampede. **Chosen semantics:
 *     accept-double-fetch-but-cache-last** — two workers both miss,
 *     both fetch, both write, last write wins. Rationale:
 *       (a) the TTL is ~14 min so the worst-case wasted-fetch rate
 *           is bounded (1 wasted GetToken per worker per ~14 min),
 *       (b) the wasted call is cheap (single POST, no charge, no
 *           PII), and
 *       (c) the alternative — Redis NX-lock-based single-flight —
 *           adds 60+ LOC for lock-acquire/release + timeout handling
 *           + dead-lock recovery; the operational complexity
 *           outweighs the marginal benefit at MVP scale (~2 PM2
 *           workers max per Day 26).
 *     §11 does not specify a stampede semantic. If a future scale
 *     point surfaces token-fetch contention as a real problem (e.g.
 *     20+ workers, sub-second concurrent traffic at TTL expiry),
 *     swap to single-flight at this seam without touching callers.
 *
 * The adapter is a pure function over an `IORedis` client — the
 * client lifecycle (connect, ready, error, quit) lives in
 * `./redis-client.ts` so this file stays focused on the TokenCache
 * contract.
 *
 * Lookup semantics: `get` returns `null` on cache miss OR on
 * connection error. The caller (getAccessToken in `client.ts`) treats
 * both identically — fetches a fresh token. This avoids surfacing
 * Redis connection failures as user-visible 5xx; the wrapper
 * degrades to "extra GetToken calls" instead.
 */

import type { Redis } from 'ioredis'

import { logger } from '../../lib/logger.js'
import type { TokenCache } from './token-cache.js'

/**
 * Construct a TokenCache backed by the supplied Redis client.
 *
 * Pure function: takes the client, returns the contract. Lifetime
 * + error events on the client are the caller's responsibility
 * (managed in `./redis-client.ts`).
 */
export function redisTokenCache(client: Redis): TokenCache {
  return {
    async get(key: string): Promise<string | null> {
      try {
        const value = await client.get(key)
        return value
      } catch (err) {
        // Connection error / network blip → degrade to cache-miss.
        // The caller will fetch a fresh token. Logging at warn so
        // we can observe Redis health without paging.
        logger.warn(
          { err: (err as Error).message, key },
          'eps.token_cache.redis_get_failed (degrading to cache miss)',
        )
        return null
      }
    },

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) {
        // Same semantics as the in-memory adapter: ttl<=0 means
        // "delete" (used by initialiseOrderHttp's 401 retry path to
        // invalidate a stale token before re-fetching).
        try {
          await client.del(key)
        } catch (err) {
          logger.warn({ err: (err as Error).message, key }, 'eps.token_cache.redis_del_failed')
        }
        return
      }

      try {
        // Redis SET key value EX seconds — single round-trip; atomic
        // with TTL set in the same op. The 'EX' option requires an
        // integer; ttlSeconds is already an integer per
        // deriveTokenTtl's contract.
        await client.set(key, value, 'EX', ttlSeconds)
      } catch (err) {
        // Cache write failed → log + carry on. The downstream call
        // path doesn't actually need the cache to succeed for the
        // current request to work (the caller already has the token
        // in-hand). Worst case: next worker that misses the cache
        // pays one extra GetToken.
        logger.warn(
          { err: (err as Error).message, key, ttlSeconds },
          'eps.token_cache.redis_set_failed (cache write skipped)',
        )
      }
    },
  }
}
