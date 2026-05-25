/**
 * Redis client lifecycle — singleton + connection management.
 *
 * Per CLAUDE.md §1.2 + §17.3: Redis 7 ships on the same EC2 as the
 * Node app. The staging instance has Redis 7 active on the default
 * port (verified Day 26 Phase 0 — `redis-cli ping → PONG`).
 *
 * **Connection config:**
 *   - `REDIS_URL` env var: `redis://localhost:6379` for single-EC2
 *     deploys. Bootstrap-staging.sh writes this verbatim per §11.3
 *     env-var conventions.
 *   - `lazyConnect: true` — defers connect until first command so
 *     boot doesn't crash if Redis is briefly down (the app stays up;
 *     the token cache degrades to cache-miss until Redis recovers).
 *   - `enableOfflineQueue: false` — fail fast on disconnect rather
 *     than buffer commands indefinitely. The redis-token-cache
 *     adapter catches the failure and degrades to cache-miss.
 *   - `maxRetriesPerRequest: 2` — bounded so a slow Redis can't
 *     hang the EPS token-fetch path indefinitely. Two attempts is
 *     enough to clear transient blips without surfacing as latency
 *     to the user.
 *
 * **Singleton pattern:** `getRedis()` returns the same client across
 * all callers within the process; `closeRedis()` is for graceful
 * shutdown (used by tests + future SIGTERM handler).
 *
 * **Optional dependency:** the client is constructed ONLY when
 * `REDIS_URL` is set in env. Local dev that doesn't run Redis just
 * skips the cache wiring (falls back to the in-memory adapter from
 * Phase 1).
 */

import { Redis, type RedisOptions } from 'ioredis'

import { logger } from '../../lib/logger.js'

let _client: Redis | null = null

/**
 * Returns the singleton Redis client, constructing it on first call.
 * Returns `null` if REDIS_URL is not set — caller decides whether
 * to fall back to the in-memory adapter or warn.
 */
export function getRedis(): Redis | null {
  if (_client) return _client
  const url = process.env['REDIS_URL']
  if (!url) return null

  const opts: RedisOptions = {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    // Keep retry strategy bounded — exponential backoff to a cap so
    // we don't hammer a downed Redis.
    retryStrategy: (times) => Math.min(times * 200, 2000),
  }
  _client = new Redis(url, opts)

  _client.on('connect', () => {
    logger.info({ url: redactRedisUrl(url) }, 'redis.connect')
  })
  _client.on('ready', () => {
    logger.info('redis.ready')
  })
  _client.on('error', (err) => {
    logger.warn({ err: err.message }, 'redis.error')
  })
  _client.on('close', () => {
    logger.info('redis.close')
  })

  return _client
}

/**
 * Gracefully close the Redis client. Called by tests + by the
 * future SIGTERM handler. No-op if no client has been constructed.
 */
export async function closeRedis(): Promise<void> {
  if (!_client) return
  try {
    await _client.quit()
  } catch {
    // Force-disconnect if quit fails (already closed, network gone, etc.).
    _client.disconnect()
  }
  _client = null
}

/**
 * Override for tests: inject a Redis client (e.g. ioredis-mock) so
 * adapters using getRedis() see the mock instead of the real one.
 */
export function _setRedisClientForTest(client: Redis | null): void {
  _client = client
}

/**
 * Redact the password component (if any) from a Redis connection
 * URL before logging. Defensive — connection URLs in this project
 * are `redis://localhost:6379` without auth, but logs should never
 * leak credentials if the URL shape ever changes.
 */
function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) {
      parsed.password = '***'
    }
    return parsed.toString()
  } catch {
    return 'redis://***'
  }
}
