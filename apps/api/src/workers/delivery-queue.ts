/**
 * Delivery queue — BullMQ producer side. Sprint 3 Day 28 Phase 3.
 *
 * Single named queue `tickets-delivery`. Producers (settle.ts on
 * paid transition) call `enqueueOrderDelivery({ orderId })` to push
 * a job. The worker (in delivery-worker.ts) consumes from the same
 * queue.
 *
 * ════════════════════════════════════════════════════════════════════
 * Job design
 * ════════════════════════════════════════════════════════════════════
 *
 *   - **Job name**: 'deliver-order'. Single job type per queue.
 *   - **Data shape**: `{ orderId: string }`. Minimal — the worker
 *     re-loads everything from the DB (no stale snapshot risk; the
 *     order may have moved through additional state by the time the
 *     job runs).
 *   - **Job id**: `delivery:${orderId}`. BullMQ dedupes by jobId, so
 *     enqueueing twice for the same order is a no-op. This is the
 *     enqueue-side idempotency guard; the service-side guard
 *     (`order.delivery_sent` event marker) is the durable one.
 *   - **Retries**: 5 attempts with exponential backoff (5s, 25s,
 *     2m05s, 10m25s, 52m05s). Total ~63 min before DLQ. Covers
 *     transient SES throttles, network blips, EC2 restarts.
 *   - **Remove on complete**: true (jobs don't accumulate in Redis;
 *     audit lives in order_events + audit_logs which are durable).
 *   - **Remove on fail**: keep last 100 (debugging surface for
 *     operator inspection of patterns).
 *
 * ════════════════════════════════════════════════════════════════════
 * Optional dependency on Redis
 * ════════════════════════════════════════════════════════════════════
 *
 * BullMQ requires Redis. If `REDIS_URL` is unset (local dev without
 * Redis), the queue construct fails. `getDeliveryQueue()` returns
 * null in that case, and `enqueueOrderDelivery()` short-circuits
 * with a warning log — settlement is not blocked.
 *
 * This is the SAME degradation pattern as the EPS token cache
 * (Day 26 Phase 2): infrastructure-optional, settlement-authoritative.
 */

import { Queue } from 'bullmq'

import { getRedis } from '../infra/redis/client.js'
import { logger } from '../lib/logger.js'

export const DELIVERY_QUEUE_NAME = 'tickets-delivery'
export const DELIVERY_JOB_NAME = 'deliver-order'

export interface DeliveryJobData {
  orderId: string
}

let _queue: Queue<DeliveryJobData> | null = null

/**
 * Lazy-init the queue. Returns null if REDIS_URL isn't set (BullMQ
 * needs Redis; without it the queue can't exist).
 */
export function getDeliveryQueue(): Queue<DeliveryJobData> | null {
  if (_queue) return _queue
  const redis = getRedis()
  if (!redis) {
    return null
  }
  _queue = new Queue<DeliveryJobData>(DELIVERY_QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    },
  })
  logger.info({ queue: DELIVERY_QUEUE_NAME }, 'tickets.delivery_queue.initialised')
  return _queue
}

export interface EnqueueResult {
  enqueued: boolean
  jobId?: string
  reason?: string
}

/**
 * Enqueue a delivery job for an order. Idempotent on jobId — re-enqueue
 * for the same order is a no-op (BullMQ rejects duplicate jobIds).
 *
 * **Never throws.** Delivery enqueue MUST NOT block settlement —
 * a Redis blip that prevents enqueue is logged + swallowed; the
 * order stays paid; ops can manually re-enqueue later. This is the
 * "settlement reliability is independent of delivery" invariant.
 */
export async function enqueueOrderDelivery(input: DeliveryJobData): Promise<EnqueueResult> {
  const queue = getDeliveryQueue()
  if (!queue) {
    logger.warn({ orderId: input.orderId }, 'tickets.delivery_queue.enqueue.skipped_no_redis')
    return { enqueued: false, reason: 'no_redis' }
  }

  const jobId = `delivery:${input.orderId}`
  try {
    const job = await queue.add(DELIVERY_JOB_NAME, input, { jobId })
    logger.info({ orderId: input.orderId, jobId: job.id }, 'tickets.delivery_queue.enqueued')
    return { enqueued: true, jobId: job.id }
  } catch (err) {
    // BullMQ throws on connection issues; swallow + log.
    logger.error(
      { orderId: input.orderId, err: (err as Error).message },
      'tickets.delivery_queue.enqueue.failed',
    )
    return { enqueued: false, reason: 'enqueue_error' }
  }
}

/**
 * Test helper — reset the queue singleton so a test can inject a
 * different Redis client (e.g. ioredis-mock).
 */
export function _resetDeliveryQueueForTest(): void {
  _queue = null
}
