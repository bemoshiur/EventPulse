/**
 * EPS access-token cache — interface + in-memory adapter for Part 1.
 *
 * Per CLAUDE.md §11.2 the access-token GetToken response is to be
 * cached so each downstream EPS call doesn't pay the round-trip cost.
 * Per §11.4 the JWT EPS issues has a ~15-minute TTL; if it expires
 * the next signed request returns `401 Unauthorized`.
 *
 * The playbook calls for a Redis cache. This module ships an
 * in-memory adapter for Day-24 Part 1 work because:
 *
 *   1. There is no live `getAccessToken` caller yet — the wrapper
 *      hasn't been wired into the order pipeline (Day 26+).
 *   2. The project has no Redis client dependency or Redis instance
 *      provisioned. Adding both is its own scope.
 *   3. The interface below is intentionally narrow (get / set with
 *      TTL) so swapping the in-memory adapter for a Redis adapter at
 *      Day 26+ is a single-file change at the construction site.
 *
 * **Day-26+ TODO (load-bearing)** — when the order pipeline wires
 * `getAccessToken` into a real flow, replace the in-memory adapter
 * with a Redis-backed implementation. Pseudo:
 *
 * ```ts
 * import { Redis } from 'ioredis'  // dep added in that PR
 * const redis = new Redis(process.env['REDIS_URL']!)
 * export function redisTokenCache(): TokenCache {
 *   return {
 *     async get(key) { return await redis.get(key) },
 *     async set(key, value, ttl) { await redis.set(key, value, 'EX', ttl) },
 *   }
 * }
 * ```
 *
 * Why per-PM2-process in-memory is acceptable in the interim: the
 * cache is short-lived (TTL ~14 min), the worst-case miss is one
 * extra GetToken call per process per ~15 min, and the cache is
 * deliberately invalidated by process restart so a stale token can
 * never survive a deploy. A multi-process setup (PM2 cluster) would
 * see N tokens fetched within ~15 min instead of 1, but that's a
 * latency/cost issue, not a correctness one. The Redis adapter
 * collapses N → 1 when it lands.
 */

/**
 * Narrow contract any adapter must satisfy. Mirrors a subset of the
 * ioredis API surface so the Redis adapter Day 26+ ships becomes a
 * thin wrapper around an `ioredis` client.
 */
export interface TokenCache {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
}

/**
 * In-memory adapter. NOT for production load — the Redis adapter
 * planned for Day 26+ replaces this. Acceptable as a Day-24 Part 1
 * primitive because no live caller exists yet.
 */
export function inMemoryTokenCache(): TokenCache {
  const store = new Map<string, { value: string; expiresAtMs: number }>()

  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key)
      if (!entry) return null
      if (Date.now() >= entry.expiresAtMs) {
        store.delete(key)
        return null
      }
      return entry.value
    },

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) {
        store.delete(key)
        return
      }
      store.set(key, {
        value,
        expiresAtMs: Date.now() + ttlSeconds * 1000,
      })
    },
  }
}
