import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { setDefaultTokenCache } from './infra/eps/client.js'
import { redisTokenCache } from './infra/eps/redis-token-cache.js'
import { getRedis } from './infra/redis/client.js'
import { logger } from './lib/logger.js'
import { startDeliveryWorker, stopDeliveryWorker } from './workers/delivery-worker.js'

// Boot-time: wire the EPS token cache to Redis if REDIS_URL is set.
// Falls back to the in-memory adapter (Day 24 Part 1 default) otherwise.
// The seam is per the Day 26 Phase 2 brief: cross-worker token sharing
// requires Redis; without it each PM2 worker maintains its own cache.
const redis = getRedis()
if (redis) {
  setDefaultTokenCache(redisTokenCache(redis))
  logger.info('eps.token_cache.backed_by=redis')
  // Day 29 Phase 1 hotfix #2: warm up the Redis connection at boot.
  // The singleton is `lazyConnect: true` + `enableOfflineQueue: false`
  // (Day 26 design — fail-fast for EPS token cache hot path). Without
  // explicit warm-up, the FIRST request after pm2 reload races against
  // the deferred connect: ioredis throws "Stream isn't writeable" before
  // the socket opens, the idempotency middleware's redis.get() rejects,
  // Hono returns generic 500. Warm-up moves that race off the request
  // path. Errors swallowed because Redis-absent is not a fatal boot
  // condition (each consumer's own absence-handling kicks in — EPS
  // token cache falls back to in-memory; idempotency middleware
  // returns 503 cleanly).
  void redis.connect().catch((err) => {
    logger.warn({ err: err.message }, 'redis.warmup_failed_at_boot')
  })
}

// Day 28 Phase 3 — start the in-process delivery worker. Consumes
// the `tickets-delivery` BullMQ queue + processes post-paid PDF +
// email delivery. Falls back to no-op if Redis is unset (logs).
startDeliveryWorker()

// Graceful shutdown — let in-flight delivery jobs finish.
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutdown.received')
  await stopDeliveryWorker()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

const app = createApp()
const port = Number(process.env['PORT'] ?? 4000)

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, 'eventpulse api listening')
})
