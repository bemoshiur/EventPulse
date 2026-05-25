/**
 * Idempotency-Key middleware — Sprint 3 Day 29 Phase 1.
 *
 * Per CLAUDE.md §1.3 R6 (idempotency on money-moving endpoints) +
 * §6.4 (Idempotency-Key header, Redis 24h TTL, replayed key returns
 * cached response).
 *
 * ════════════════════════════════════════════════════════════════════
 * What §6.4 says verbatim (and what it leaves to implementation)
 * ════════════════════════════════════════════════════════════════════
 *
 * Spec verbatim: "Server stores key → response in Redis for 24 hours.
 * Repeated request with same key returns cached response."
 *
 * Gaps the middleware fills, with rationale:
 *
 *   1. **In-flight concurrency.** Two requests arrive with the same
 *      key while the first is still processing. Without protection,
 *      both create orders (defeating the whole point). The middleware
 *      uses Redis SET NX to mark the key as IN_FLIGHT for the duration
 *      of processing; concurrent same-key requests get 409 CONFLICT
 *      with code `IDEMPOTENCY_IN_FLIGHT`. This is the Stripe-style
 *      pattern + the only safe semantic for a money-moving endpoint.
 *
 *   2. **Same key, different body.** A client error: they reused the
 *      key for a different operation. Returning the cached response
 *      from the prior request would silently corrupt state ("you
 *      thought you ordered X, but the cached response says you
 *      ordered Y from yesterday"). The middleware hashes the request
 *      body and stores the hash alongside the cached response; on
 *      replay, mismatch → 422 UNPROCESSABLE_ENTITY with code
 *      `IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY`.
 *
 *   3. **Key scope.** Per-endpoint + per-key. A buyer-supplied UUID
 *      reused across distinct money-moving routes (orders, refunds,
 *      …) is the buyer's bug; we don't merge namespaces. Tenant
 *      scope is implicit in the endpoint context — public buyer
 *      endpoints have no tenant session, so the key namespace is
 *      naturally per-endpoint global.
 *
 *   4. **Missing key.** Per §1.3 R6: "all require Idempotency-Key
 *      header." Missing → 400 BAD_REQUEST with code
 *      `IDEMPOTENCY_KEY_REQUIRED`. The middleware refuses to
 *      pass-through unkey'd money requests.
 *
 *   5. **Cache TTL.** Spec says 24h. Implemented exactly.
 *
 *   6. **In-flight TTL.** Spec silent. Implementation uses 60s — long
 *      enough that no realistic request exceeds it, short enough that
 *      a crashed worker doesn't lock out retries for hours. Caller
 *      can override via `inFlightTtlSec` option.
 *
 * ════════════════════════════════════════════════════════════════════
 * State machine on a key
 * ════════════════════════════════════════════════════════════════════
 *
 *   ┌─────────────┐  SETNX OK     ┌──────────────┐  request done    ┌──────────────┐
 *   │   absent    │ ────────────▶ │  IN_FLIGHT   │ ──────────────▶ │   COMPLETE   │
 *   │ (no key in  │               │ {status:0,   │                  │ {status:n,   │
 *   │  Redis)     │               │  body_hash}  │                  │  body_hash,  │
 *   └─────────────┘               │  TTL: 60s    │                  │  response}   │
 *          ▲                      └──────────────┘                  │  TTL: 24h    │
 *          │ TTL expires                  │                          └──────────────┘
 *          │                              │                                 │
 *          │                              │ next request                    │ next request
 *          │                              │ same key                        │ same key
 *          │                              ▼                                 ▼
 *          │                       ┌──────────────┐                ┌──────────────────────┐
 *          │                       │   409 IN     │                │  body_hash match?    │
 *          │                       │   FLIGHT     │                │   yes → 200 cached   │
 *          │                       └──────────────┘                │   no  → 422 mismatch │
 *          │                                                       └──────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════
 * Body-hash semantic
 * ════════════════════════════════════════════════════════════════════
 *
 * SHA-256 of the raw request body bytes (NOT a canonicalised JSON).
 * Rationale: two requests with the same serialised body bytes are
 * truly identical; semantically-equivalent-but-textually-different
 * payloads (e.g. different key ordering) are TREATED AS DIFFERENT
 * here. This is the safer default — the client's serialiser is
 * deterministic; this prevents the case "the client retried with a
 * tiny field reorder and we returned the wrong cached response."
 *
 * ════════════════════════════════════════════════════════════════════
 * Body re-availability for downstream handlers
 * ════════════════════════════════════════════════════════════════════
 *
 * The middleware reads the body via `c.req.text()` for hashing. Hono's
 * HonoRequest caches the parsed body, so a downstream `zValidator('json')`
 * call reads from the cached text and parses fresh. No body-stream
 * exhaustion. (Verified at integration test time — the existing route
 * still receives the parsed body via zValidator.)
 *
 * ════════════════════════════════════════════════════════════════════
 * Redis absence (degraded behaviour)
 * ════════════════════════════════════════════════════════════════════
 *
 * If Redis is unavailable, the middleware FAILS CLOSED — returns 503
 * SERVICE_UNAVAILABLE with code `IDEMPOTENCY_INFRA_UNAVAILABLE`. This
 * is deliberately fail-closed (not pass-through) because:
 *
 *   - Without Redis, the middleware cannot guarantee at-most-once
 *     processing. Passing through would defeat R6's guarantee.
 *   - Better to surface the infra problem loudly than silently
 *     degrade to a double-charge risk.
 *   - Differs from `enqueueOrderDelivery` (Day 28 Phase 3) which is
 *     fail-open because delivery is a downstream consequence the
 *     operator can retry; settlement is the source of truth.
 *     Idempotency is gating the source-of-truth path; it must be
 *     authoritative or refuse the request.
 */

import { createHash } from 'node:crypto'

import type { MiddlewareHandler } from 'hono'

import { getRedis } from '../infra/redis/client.js'
import { logger } from '../lib/logger.js'

const DEFAULT_TTL_SEC = 24 * 60 * 60 // §6.4: 24 hours
const DEFAULT_IN_FLIGHT_TTL_SEC = 60 // bounded so a crashed worker doesn't lock out retries

export interface IdempotencyMiddlewareOptions {
  /**
   * Namespace prepended to the Redis key — typically the route path
   * or a logical operation name. Keeps key spaces disjoint when
   * multiple money-moving endpoints share the middleware.
   */
  namespace: string
  /** Cache TTL for completed responses. Defaults to §6.4's 24h. */
  ttlSec?: number
  /** Marker TTL for in-flight requests. Defaults to 60s. */
  inFlightTtlSec?: number
}

interface CompleteEntry {
  v: 1 // version tag for future migration
  status: 'complete'
  body_hash: string
  response_status: number
  response_body: string // already-stringified JSON
  response_headers: Record<string, string> // headers we replay
  completed_at: number
}

interface InFlightEntry {
  v: 1
  status: 'in_flight'
  body_hash: string
  started_at: number
}

type StoredEntry = CompleteEntry | InFlightEntry

function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Build the Redis key. Namespace + key (no tenant — buyer routes
 * have no tenant session; the key itself is namespaced by the
 * route's `namespace`).
 */
function redisKeyFor(namespace: string, idempotencyKey: string): string {
  return `idempotency:${namespace}:${idempotencyKey}`
}

/**
 * Middleware factory. Apply per route via `app.use(idempotencyMiddleware({...}))`
 * BEFORE the zValidator + route handler.
 */
export function idempotencyMiddleware(opts: IdempotencyMiddlewareOptions): MiddlewareHandler {
  const ttl = opts.ttlSec ?? DEFAULT_TTL_SEC
  const inFlightTtl = opts.inFlightTtlSec ?? DEFAULT_IN_FLIGHT_TTL_SEC
  const namespace = opts.namespace

  return async (c, next) => {
    const key = c.req.header('idempotency-key')

    // STEP 1 — missing key → 400 (R6: money-moving endpoints require it).
    if (!key || key.length === 0) {
      return c.json(
        {
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'Idempotency-Key header is required on this endpoint (per §1.3 R6 + §6.4)',
          },
        },
        400,
      )
    }
    // Defensive — reject obviously malformed keys to keep the Redis
    // key namespace clean.
    if (key.length < 8 || key.length > 256) {
      return c.json(
        {
          error: {
            code: 'IDEMPOTENCY_KEY_INVALID',
            message: 'Idempotency-Key must be 8–256 characters',
          },
        },
        400,
      )
    }

    // STEP 2 — read body for hashing. Hono caches the parsed body so
    // downstream handlers (zValidator) can still read it.
    let bodyText: string
    try {
      bodyText = await c.req.text()
    } catch (err) {
      logger.error({ err: (err as Error).message, namespace, key }, 'idempotency.body_read_failed')
      return c.json(
        {
          error: {
            code: 'IDEMPOTENCY_BODY_READ_FAILED',
            message: 'failed to read request body',
          },
        },
        400,
      )
    }
    const bodyHash = sha256Hex(bodyText)

    // STEP 3 — get Redis. Fail closed if unavailable (see file header).
    const redis = getRedis()
    if (!redis) {
      logger.error({ namespace, key }, 'idempotency.no_redis.fail_closed')
      return c.json(
        {
          error: {
            code: 'IDEMPOTENCY_INFRA_UNAVAILABLE',
            message: 'idempotency store unavailable; retry shortly',
          },
        },
        503,
      )
    }

    const rkey = redisKeyFor(namespace, key)

    // STEP 4 — check for existing entry.
    const existingRaw = await redis.get(rkey)
    if (existingRaw) {
      let parsed: StoredEntry
      try {
        parsed = JSON.parse(existingRaw) as StoredEntry
      } catch {
        // Corrupted entry; treat as absent + warn. Edge case; cleanup
        // by overwriting on this request's completion.
        logger.warn({ namespace, key, rkey }, 'idempotency.entry_corrupt.treating_as_absent')
        parsed = null as unknown as StoredEntry
      }

      if (parsed) {
        if (parsed.status === 'in_flight') {
          // Another request is processing right now.
          logger.info(
            { namespace, key, startedAt: parsed.started_at },
            'idempotency.in_flight.conflict',
          )
          return c.json(
            {
              error: {
                code: 'IDEMPOTENCY_IN_FLIGHT',
                message:
                  'a request with this Idempotency-Key is currently in flight; retry shortly',
              },
            },
            409,
          )
        }

        // status === 'complete'
        if (parsed.body_hash !== bodyHash) {
          // Same key, different body — client error.
          logger.warn(
            {
              namespace,
              key,
              expectedHash: parsed.body_hash.slice(0, 12),
              actualHash: bodyHash.slice(0, 12),
            },
            'idempotency.key_reused_different_body',
          )
          return c.json(
            {
              error: {
                code: 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY',
                message:
                  'Idempotency-Key was previously used with a different request body; use a fresh key for new operations',
              },
            },
            422,
          )
        }

        // Replay — return cached response verbatim.
        logger.info(
          { namespace, key, cachedStatus: parsed.response_status },
          'idempotency.replay.cache_hit',
        )
        for (const [k, v] of Object.entries(parsed.response_headers)) {
          c.header(k, v)
        }
        // Mark the response so clients can tell it was replayed.
        c.header('x-idempotency-replay', 'true')
        c.header('content-type', 'application/json')
        // Use c.body to set status + raw body without re-JSON.stringify.
        return c.body(parsed.response_body, parsed.response_status as 200 | 201 | 400 | 409 | 422)
      }
    }

    // STEP 5 — claim in-flight marker via SET NX. If another worker
    // beat us in the race, return 409.
    const inFlightEntry: InFlightEntry = {
      v: 1,
      status: 'in_flight',
      body_hash: bodyHash,
      started_at: Date.now(),
    }
    const setResult = await redis.set(rkey, JSON.stringify(inFlightEntry), 'EX', inFlightTtl, 'NX')
    if (setResult !== 'OK') {
      // Another worker won the race in the microseconds between our
      // GET and SET NX. Re-read + decide.
      const raceRaw = await redis.get(rkey)
      logger.info(
        { namespace, key, raceWonByOther: true },
        'idempotency.race_lost.returning_conflict',
      )
      // We treat this as a 409 IN_FLIGHT regardless of the other
      // worker's progress — the safe choice is to make the client
      // retry; if the other worker has already completed by the time
      // they retry, they'll get the cached response then.
      return c.json(
        {
          error: {
            code: 'IDEMPOTENCY_IN_FLIGHT',
            message: 'a request with this Idempotency-Key is currently in flight; retry shortly',
            ...(raceRaw ? {} : {}),
          },
        },
        409,
      )
    }

    // STEP 6 — process the request. We own the in-flight lock.
    await next()

    // STEP 7 — cache the response (if successful enough to cache).
    // We cache 2xx + 4xx (deterministic-outcome errors); we do NOT
    // cache 5xx because those are usually transient infra failures
    // the client SHOULD be allowed to retry against fresh state.
    const responseStatus = c.res.status
    const shouldCache = responseStatus < 500

    if (shouldCache) {
      const responseBody = await c.res.clone().text()
      const responseHeaders: Record<string, string> = {}
      // Capture content-type only — other headers (set-cookie, etc.)
      // are intentionally NOT replayed to avoid stale-state surprises.
      const ct = c.res.headers.get('content-type')
      if (ct) responseHeaders['content-type'] = ct

      const completeEntry: CompleteEntry = {
        v: 1,
        status: 'complete',
        body_hash: bodyHash,
        response_status: responseStatus,
        response_body: responseBody,
        response_headers: responseHeaders,
        completed_at: Date.now(),
      }
      try {
        await redis.set(rkey, JSON.stringify(completeEntry), 'EX', ttl)
        logger.info({ namespace, key, responseStatus, ttl }, 'idempotency.cached')
      } catch (err) {
        // Cache write failed — the response IS being returned to the
        // client; the worst case is the in-flight marker expires in 60s
        // and a retry hits a stale absence. Log + continue.
        logger.warn(
          { namespace, key, err: (err as Error).message },
          'idempotency.cache_write_failed',
        )
      }
    } else {
      // 5xx — release the in-flight marker so a client retry isn't
      // stuck for 60s.
      try {
        await redis.del(rkey)
      } catch (err) {
        logger.warn(
          { namespace, key, err: (err as Error).message },
          'idempotency.in_flight_release_failed',
        )
      }
    }
  }
}
