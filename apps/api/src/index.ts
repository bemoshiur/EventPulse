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
} else {
  logger.info('eps.token_cache.backed_by=in-memory (REDIS_URL unset)')
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
