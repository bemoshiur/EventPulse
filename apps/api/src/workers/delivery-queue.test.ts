/**
 * Delivery queue — unit tests.
 *
 * Scope: the no-Redis fallback path (the load-bearing settlement-
 * reliability invariant). BullMQ uses Lua scripts that `ioredis-mock`
 * does not fully support, so the with-real-BullMQ behaviour (job id
 * dedup, retry config, DLQ) is verified at integration test time
 * with a real Redis (CI env supplies REDIS_URL).
 *
 * What this file pins:
 *
 *   1. No `REDIS_URL` set → `getDeliveryQueue()` returns null.
 *   2. No `REDIS_URL` set → `enqueueOrderDelivery` returns
 *      `{enqueued: false, reason: 'no_redis'}` and does NOT throw.
 *      Settlement-reliability invariant: an enqueue failure must
 *      NEVER block the order from finishing settlement.
 *   3. The function returns synchronously-resolved promise (no hang
 *      paths even with Redis absent).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _setRedisClientForTest } from '../infra/redis/client.js'

import {
  _resetDeliveryQueueForTest,
  enqueueOrderDelivery,
  getDeliveryQueue,
} from './delivery-queue.js'

const ORIGINAL_REDIS_URL = process.env['REDIS_URL']

beforeEach(() => {
  delete process.env['REDIS_URL']
  _setRedisClientForTest(null)
  _resetDeliveryQueueForTest()
})

afterEach(() => {
  _resetDeliveryQueueForTest()
  _setRedisClientForTest(null)
  if (ORIGINAL_REDIS_URL === undefined) delete process.env['REDIS_URL']
  else process.env['REDIS_URL'] = ORIGINAL_REDIS_URL
})

describe('enqueueOrderDelivery — no Redis (settlement reliability invariant)', () => {
  it('returns enqueued:false reason:no_redis when REDIS_URL unset', async () => {
    const result = await enqueueOrderDelivery({ orderId: 'order-1' })
    expect(result.enqueued).toBe(false)
    expect(result.reason).toBe('no_redis')
    expect(result.jobId).toBeUndefined()
  })

  it('does not throw — settlement must never be blocked by delivery infra', async () => {
    await expect(enqueueOrderDelivery({ orderId: 'order-1' })).resolves.toBeDefined()
  })

  it('does not throw on repeated calls', async () => {
    await enqueueOrderDelivery({ orderId: 'order-1' })
    await enqueueOrderDelivery({ orderId: 'order-2' })
    await enqueueOrderDelivery({ orderId: 'order-3' })
    // No throws above; explicit assertion.
    expect(true).toBe(true)
  })

  it('getDeliveryQueue returns null when Redis unset', () => {
    expect(getDeliveryQueue()).toBeNull()
  })
})
