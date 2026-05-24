/**
 * EPS token cache — in-memory adapter behaviour.
 *
 * Day 26+ Redis adapter will inherit the same interface; the
 * behaviour contract pinned here (get-after-set hits, expired entries
 * miss, ttl<=0 invalidates) applies to both adapters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inMemoryTokenCache } from './token-cache.js'

describe('inMemoryTokenCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('get returns null when key is unset', async () => {
    const cache = inMemoryTokenCache()
    expect(await cache.get('missing')).toBeNull()
  })

  it('get returns the cached value after a set within TTL', async () => {
    const cache = inMemoryTokenCache()
    await cache.set('k', 'v', 60)
    expect(await cache.get('k')).toBe('v')
  })

  it('get returns null after TTL elapses', async () => {
    const cache = inMemoryTokenCache()
    await cache.set('k', 'v', 60)
    vi.advanceTimersByTime(60_000)
    expect(await cache.get('k')).toBeNull()
  })

  it('get returns null AT exactly TTL boundary (>= comparison)', async () => {
    const cache = inMemoryTokenCache()
    await cache.set('k', 'v', 1)
    vi.advanceTimersByTime(1000) // exactly at expiry
    expect(await cache.get('k')).toBeNull()
  })

  it('get still hits just before TTL expires', async () => {
    const cache = inMemoryTokenCache()
    await cache.set('k', 'v', 1)
    vi.advanceTimersByTime(999) // 1 ms before expiry
    expect(await cache.get('k')).toBe('v')
  })

  it('set with ttlSeconds <= 0 deletes the entry', async () => {
    const cache = inMemoryTokenCache()
    await cache.set('k', 'v', 60)
    await cache.set('k', 'overwritten', 0)
    expect(await cache.get('k')).toBeNull()

    await cache.set('k2', 'v2', 60)
    await cache.set('k2', 'overwritten', -1)
    expect(await cache.get('k2')).toBeNull()
  })

  it('set overwrites a previous value with new TTL', async () => {
    const cache = inMemoryTokenCache()
    await cache.set('k', 'v1', 60)
    await cache.set('k', 'v2', 120)
    expect(await cache.get('k')).toBe('v2')
    vi.advanceTimersByTime(90_000)
    expect(await cache.get('k')).toBe('v2') // still under the 120s TTL
  })

  it('multiple keys are independent', async () => {
    const cache = inMemoryTokenCache()
    await cache.set('a', '1', 60)
    await cache.set('b', '2', 30)
    expect(await cache.get('a')).toBe('1')
    expect(await cache.get('b')).toBe('2')

    vi.advanceTimersByTime(30_000)
    expect(await cache.get('a')).toBe('1')
    expect(await cache.get('b')).toBeNull()
  })

  it('each cache instance is isolated', async () => {
    const cacheA = inMemoryTokenCache()
    const cacheB = inMemoryTokenCache()
    await cacheA.set('k', 'a-value', 60)
    expect(await cacheB.get('k')).toBeNull()
  })
})
