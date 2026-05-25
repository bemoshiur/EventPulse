/**
 * Redis-backed token cache adapter — behaviour tests.
 *
 * Uses `ioredis-mock` (drop-in replacement for ioredis) so tests
 * are deterministic + fast + don't require a running Redis. The
 * cross-worker-sharing test exploits the fact that two adapter
 * instances wrapping the SAME mock client see each other's writes
 * — exactly mirroring how two PM2 workers connected to the same
 * Redis would share the cache.
 *
 * Behaviour pinned:
 *   - get/set round-trip
 *   - TTL: set with EX honoured (key expires after ttlSeconds)
 *   - TTL: ttl <= 0 deletes the key (semantics match in-memory adapter)
 *   - Missing key returns null
 *   - Cross-worker sharing: two TokenCache instances over the same
 *     client see each other's writes (the whole point of Redis)
 *   - Survives "process restart" (new adapter sees pre-existing keys
 *     on the shared client — simulated by constructing two adapters)
 *   - Redis get-error degrades to cache miss (returns null instead of
 *     throwing — caller fetches a fresh token)
 *   - Redis set-error logs + carries on (no throw — current request
 *     already has the token in-hand)
 *   - Redis del-error on TTL<=0 logs + carries on
 */

import RedisMock from 'ioredis-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { redisTokenCache } from './redis-token-cache.js'

// Helper. NB: ioredis-mock shares its in-memory store across instances
// by default (mirroring a real Redis server which is process-wide). The
// `beforeEach` below flushes between tests so isolation holds; isolation
// WITHIN a test (e.g. cross-worker sharing) is established by passing
// the same client into multiple adapters intentionally.
function makeRedisMock(): InstanceType<typeof RedisMock> {
  return new RedisMock()
}

beforeEach(async () => {
  // Wipe the shared backing store before each test so prior-test keys
  // don't leak. Each test then constructs the adapter(s) it needs
  // against a fresh state.
  await makeRedisMock().flushall()
})

describe('redisTokenCache — get/set round-trip', () => {
  it('returns null on cache miss', async () => {
    const cache = redisTokenCache(makeRedisMock() as never)
    expect(await cache.get('eps:access-token:v1')).toBeNull()
  })

  it('set then get returns the stored value', async () => {
    const cache = redisTokenCache(makeRedisMock() as never)
    await cache.set('eps:access-token:v1', 'jwt-xyz', 60)
    expect(await cache.get('eps:access-token:v1')).toBe('jwt-xyz')
  })

  it('overwriting an existing key updates the value (last write wins)', async () => {
    const cache = redisTokenCache(makeRedisMock() as never)
    await cache.set('k', 'first', 60)
    await cache.set('k', 'second', 60)
    expect(await cache.get('k')).toBe('second')
  })
})

describe('redisTokenCache — TTL semantics', () => {
  it('honours TTL — key expires after ttlSeconds', async () => {
    const client = makeRedisMock()
    const cache = redisTokenCache(client as never)
    await cache.set('k', 'v', 60)
    const ttl = await client.ttl('k')
    expect(ttl).toBeGreaterThan(55)
    expect(ttl).toBeLessThanOrEqual(60)
  })

  it('ttl <= 0 deletes the key (parity with in-memory adapter)', async () => {
    const client = makeRedisMock()
    const cache = redisTokenCache(client as never)
    await cache.set('k', 'v', 60)
    expect(await cache.get('k')).toBe('v')
    await cache.set('k', 'v', 0)
    expect(await cache.get('k')).toBeNull()
  })

  it('ttl <= 0 on a non-existent key is a no-op', async () => {
    const cache = redisTokenCache(makeRedisMock() as never)
    await expect(cache.set('never-set', 'x', 0)).resolves.toBeUndefined()
  })

  it('ttl <= 0 also deletes when used as an explicit invalidation (initialiseOrder 401 retry path)', async () => {
    // Mirrors the call pattern in initialise-order.ts:
    //   await cache.set(_accessTokenCacheKey, '', 0) // invalidate
    const client = makeRedisMock()
    const cache = redisTokenCache(client as never)
    await cache.set('k', 'jwt', 60)
    await cache.set('k', '', 0)
    expect(await client.get('k')).toBeNull()
  })
})

describe('redisTokenCache — cross-worker sharing (THE point of Redis)', () => {
  it('two adapter instances over the SAME client see each other writes', async () => {
    // Single backing client = single Redis = N PM2 workers all pointing
    // at the same Redis. Adapter is a thin wrapper; two wrappers over
    // the same client are exactly what two workers experience.
    const sharedClient = makeRedisMock()
    const workerOne = redisTokenCache(sharedClient as never)
    const workerTwo = redisTokenCache(sharedClient as never)

    await workerOne.set('eps:access-token:v1', 'jwt-from-worker-1', 60)

    // Worker 2's cache lookup sees worker 1's write — the whole point.
    expect(await workerTwo.get('eps:access-token:v1')).toBe('jwt-from-worker-1')
  })

  it('worker write is visible to a freshly-constructed adapter (simulates worker restart)', async () => {
    const sharedClient = makeRedisMock()
    const beforeRestart = redisTokenCache(sharedClient as never)
    await beforeRestart.set('eps:access-token:v1', 'pre-restart-jwt', 60)

    // Simulate worker restart by constructing a NEW adapter instance.
    // Real worker restart would reconnect to the same Redis URL; the
    // mock fakes the in-process equivalent.
    const afterRestart = redisTokenCache(sharedClient as never)
    expect(await afterRestart.get('eps:access-token:v1')).toBe('pre-restart-jwt')
  })
})

describe('redisTokenCache — error degradation (does NOT surface to caller)', () => {
  it('returns null on Redis get error (degrades to cache miss; getAccessToken refetches)', async () => {
    const failingClient = {
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      set: vi.fn(),
      del: vi.fn(),
    }
    const cache = redisTokenCache(failingClient as never)
    expect(await cache.get('eps:access-token:v1')).toBeNull()
    expect(failingClient.get).toHaveBeenCalledOnce()
  })

  it('does NOT throw on Redis set error (caller already has token in-hand)', async () => {
    const failingClient = {
      get: vi.fn(),
      set: vi.fn().mockRejectedValue(new Error('write timeout')),
      del: vi.fn(),
    }
    const cache = redisTokenCache(failingClient as never)
    await expect(cache.set('k', 'v', 60)).resolves.toBeUndefined()
    expect(failingClient.set).toHaveBeenCalledOnce()
  })

  it('does NOT throw on Redis del error (TTL<=0 invalidation path)', async () => {
    const failingClient = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn().mockRejectedValue(new Error('del fail')),
    }
    const cache = redisTokenCache(failingClient as never)
    await expect(cache.set('k', '', 0)).resolves.toBeUndefined()
    expect(failingClient.del).toHaveBeenCalledOnce()
  })
})

describe('redisTokenCache — accept-double-fetch (chosen stampede semantics)', () => {
  it('two simultaneous misses both fetch, both write, last-write-wins (NOT single-flight)', async () => {
    // Documenting the chosen semantic. Two workers both see cache miss,
    // both go fetch the token, both call set — Redis SET with EX is
    // last-write-wins, so whichever .set() resolves last is the cached
    // value. The trade-off (one extra GetToken per worker per ~14min)
    // is acceptable per the redis-token-cache.ts file header rationale.
    const sharedClient = makeRedisMock()
    const workerOne = redisTokenCache(sharedClient as never)
    const workerTwo = redisTokenCache(sharedClient as never)

    // Both miss simultaneously
    const [missOne, missTwo] = await Promise.all([
      workerOne.get('eps:access-token:v1'),
      workerTwo.get('eps:access-token:v1'),
    ])
    expect(missOne).toBeNull()
    expect(missTwo).toBeNull()

    // Both write (simulating both having done a fresh GetToken)
    await Promise.all([
      workerOne.set('eps:access-token:v1', 'jwt-from-worker-1', 900),
      workerTwo.set('eps:access-token:v1', 'jwt-from-worker-2', 900),
    ])

    // Last write wins — exactly one value is cached, both workers see it
    const final = await workerOne.get('eps:access-token:v1')
    expect(['jwt-from-worker-1', 'jwt-from-worker-2']).toContain(final)
    expect(await workerTwo.get('eps:access-token:v1')).toBe(final)
  })
})

describe('redisTokenCache — integration with the wrapper public surface', () => {
  // Sanity check that a real-shape call pattern (the one initialiseOrder
  // uses) wires correctly through the adapter. Doesn't go through the
  // HTTP layer — that's covered by initialise-order.test.ts.
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('full set+get+invalidate+miss cycle behaves correctly', async () => {
    const client = makeRedisMock()
    const cache = redisTokenCache(client as never)

    // Initial miss
    expect(await cache.get('eps:access-token:v1')).toBeNull()
    // Fresh fetch + cache
    await cache.set('eps:access-token:v1', 'jwt-1', 840)
    expect(await cache.get('eps:access-token:v1')).toBe('jwt-1')
    // 401 from EPS → invalidate
    await cache.set('eps:access-token:v1', '', 0)
    expect(await cache.get('eps:access-token:v1')).toBeNull()
    // Re-fetch
    await cache.set('eps:access-token:v1', 'jwt-2', 840)
    expect(await cache.get('eps:access-token:v1')).toBe('jwt-2')
  })
})
