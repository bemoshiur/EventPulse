/**
 * Delivery worker — BullMQ consumer side. Sprint 3 Day 28 Phase 3.
 *
 * Runs in-process inside the API server (single-EC2 architecture per
 * §17). Consumes the `tickets-delivery` queue; for each job, calls
 * `deliverOrder({ orderId })` which orchestrates the whole post-paid
 * pipeline (attendee gen + PDF render + email send).
 *
 * ════════════════════════════════════════════════════════════════════
 * Why in-process (not a separate worker process)
 * ════════════════════════════════════════════════════════════════════
 *
 *   - §17 MVP architecture: single EC2, PM2-managed Node processes.
 *     No separate worker tier in Phase 1.
 *   - Same Node process = same DB pool + same Redis client. Cheaper +
 *     simpler than coordinating two processes.
 *   - Concurrency = 2: enough to parallelise without saturating the
 *     PDF render path (CPU-bound) or SES throttle. Tunable via env.
 *   - When traffic justifies, the worker code moves to a separate
 *     PM2 entry — no service code changes needed (worker.ts can be
 *     run standalone).
 *
 * ════════════════════════════════════════════════════════════════════
 * Failure handling
 * ════════════════════════════════════════════════════════════════════
 *
 * `deliverOrder()` returns a discriminated union for business outcomes
 * (`already_delivered` / `order_not_eligible` / etc.) and throws ONLY
 * on infra failures. BullMQ's retry handles the throw path; backoff
 * config lives in delivery-queue.ts.
 *
 * Catch-all: jobs that exhaust retries go to DLQ. Operator inspects
 * via `bullmq` admin UI or directly via Redis. The order stays paid;
 * audit + order_events show what tried (or didn't).
 */

import { Worker, type Job } from 'bullmq'

import { getRedis } from '../infra/redis/client.js'
import { logger } from '../lib/logger.js'

import { deliverOrder } from '../services/tickets/deliver-order.js'

import { DELIVERY_JOB_NAME, DELIVERY_QUEUE_NAME, type DeliveryJobData } from './delivery-queue.js'

let _worker: Worker<DeliveryJobData> | null = null

/**
 * Start the in-process delivery worker. Idempotent — safe to call
 * multiple times (boot path calls once). Returns null if Redis is
 * unset (worker doesn't start; jobs would never enqueue either).
 */
export function startDeliveryWorker(): Worker<DeliveryJobData> | null {
  if (_worker) return _worker
  const redis = getRedis()
  if (!redis) {
    logger.warn('tickets.delivery_worker.not_started.no_redis')
    return null
  }

  const concurrency = Number(process.env['DELIVERY_WORKER_CONCURRENCY'] ?? 2)

  _worker = new Worker<DeliveryJobData>(
    DELIVERY_QUEUE_NAME,
    async (job: Job<DeliveryJobData>) => {
      if (job.name !== DELIVERY_JOB_NAME) {
        throw new Error(`unknown job name: ${job.name}`)
      }
      const orderId = job.data.orderId
      logger.info(
        { orderId, jobId: job.id, attempt: job.attemptsMade + 1 },
        'tickets.delivery_worker.processing',
      )
      const result = await deliverOrder({ orderId })
      logger.info(
        { orderId, jobId: job.id, kind: result.kind },
        'tickets.delivery_worker.completed',
      )
      return result
    },
    {
      connection: redis,
      concurrency,
    },
  )

  _worker.on('failed', (job, err) => {
    logger.error(
      {
        orderId: job?.data.orderId,
        jobId: job?.id,
        attempt: job?.attemptsMade,
        err: err.message,
      },
      'tickets.delivery_worker.job_failed',
    )
  })

  _worker.on('error', (err) => {
    logger.error({ err: err.message }, 'tickets.delivery_worker.error')
  })

  logger.info({ queue: DELIVERY_QUEUE_NAME, concurrency }, 'tickets.delivery_worker.started')

  return _worker
}

/**
 * Graceful shutdown. Called on SIGTERM; allows in-flight jobs to
 * finish before the process exits.
 */
export async function stopDeliveryWorker(): Promise<void> {
  if (!_worker) return
  await _worker.close()
  _worker = null
}

/**
 * Test helper — reset the worker singleton.
 */
export function _resetDeliveryWorkerForTest(): void {
  _worker = null
}
