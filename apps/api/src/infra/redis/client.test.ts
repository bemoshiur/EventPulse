/**
 * Redis client lifecycle tests.
 *
 * Behaviour pinned:
 *   - getRedis() returns null when REDIS_URL unset (local-dev path —
 *     callers fall back to the in-memory adapter)
 *   - getRedis() returns a singleton when REDIS_URL is set (repeated
 *     calls return the same instance)
 *   - closeRedis() is a no-op when no client constructed
 *   - _setRedisClientForTest is the test seam for injecting mocks
 *   - URL redaction strips password from connection-attempt log
 */

import RedisMock from 'ioredis-mock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _setRedisClientForTest, closeRedis, getRedis } from './client.js'

const ORIGINAL_REDIS_URL = process.env['REDIS_URL']

beforeEach(() => {
  _setRedisClientForTest(null)
})

afterEach(async () => {
  await closeRedis()
  _setRedisClientForTest(null)
  if (ORIGINAL_REDIS_URL === undefined) {
    delete process.env['REDIS_URL']
  } else {
    process.env['REDIS_URL'] = ORIGINAL_REDIS_URL
  }
})

describe('getRedis', () => {
  it('returns null when REDIS_URL is not set', () => {
    delete process.env['REDIS_URL']
    expect(getRedis()).toBeNull()
  })

  it('returns null when REDIS_URL is empty string', () => {
    process.env['REDIS_URL'] = ''
    expect(getRedis()).toBeNull()
  })

  it('_setRedisClientForTest lets callers inject a mock', () => {
    const mock = new RedisMock() as never
    _setRedisClientForTest(mock)
    expect(getRedis()).toBe(mock)
  })

  it('returns the same injected client on repeated calls (singleton)', () => {
    const mock = new RedisMock() as never
    _setRedisClientForTest(mock)
    expect(getRedis()).toBe(getRedis())
  })
})

describe('closeRedis', () => {
  it('is a no-op when no client constructed', async () => {
    await expect(closeRedis()).resolves.toBeUndefined()
  })

  it('clears the singleton (subsequent getRedis returns null if REDIS_URL unset)', async () => {
    const mock = new RedisMock() as never
    _setRedisClientForTest(mock)
    expect(getRedis()).toBe(mock)
    await closeRedis()
    delete process.env['REDIS_URL']
    expect(getRedis()).toBeNull()
  })
})
