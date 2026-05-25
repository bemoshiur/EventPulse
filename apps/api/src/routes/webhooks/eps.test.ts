/**
 * EPS webhook route — handler-level tests (no DB).
 * Sprint 3 Day 27 Phase 2.
 *
 * Pinned:
 *   1. Malformed payload → 200 OK with `{ignored: 'malformed'}` (NOT
 *      400 — webhooks always return 200 to suppress EPS retries +
 *      avoid leaking).
 *   2. IP rate-limit kicks in beyond the configured budget → 200
 *      with `{throttled: true}`.
 *   3. Txn-id rate-limit kicks in independently of IP limit.
 *   4. Routing is wired (Hono picks up `epsWebhookRoutes` via
 *      `app.route('/api/v1/webhooks/eps', ...)`).
 *   5. Service-level outcomes from `settleOrderFromEps` are passed
 *      through the response data field (for observability + the
 *      truth-gate assertion harness).
 *
 * Settlement behaviour (DB-touching) is covered by
 * `services/orders/settle.test.ts` against a real DB. Here we mock
 * `settleOrderFromEps` so the route boundary stays a pure unit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` of the settle service must be declared BEFORE any import
// that transitively pulls it in. Vitest hoists vi.mock calls so this
// works at the file-top level.
vi.mock('../../services/orders/settle.js', () => ({
  settleOrderFromEps: vi.fn(async () => ({
    kind: 'unknown_transaction',
    merchantTransactionId: 'TXN-MOCKED',
  })),
}))

import { createApp } from '../../app.js'
import { settleOrderFromEps } from '../../services/orders/settle.js'
import { _resetWebhookRateLimitersForTest } from './eps.js'

beforeEach(() => {
  _resetWebhookRateLimitersForTest()
  vi.mocked(settleOrderFromEps).mockClear()
  // Default mock: unknown_transaction (cheap; no nock needed in tests
  // that don't exercise a settle outcome).
  vi.mocked(settleOrderFromEps).mockResolvedValue({
    kind: 'unknown_transaction',
    merchantTransactionId: 'TXN-MOCKED',
  })
})

afterEach(() => {
  _resetWebhookRateLimitersForTest()
})

async function postWebhook(body: unknown, headers: Record<string, string> = {}) {
  const app = createApp()
  return app.request('/api/v1/webhooks/eps/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('webhook route — malformed payload boundary', () => {
  it('payload missing merchant_transaction_id → 200 OK + ignored:malformed', async () => {
    const res = await postWebhook({ Status: 'SUCCESS' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ data: { ok: true, ignored: 'malformed' } })
    // Settle service NOT called on malformed payload.
    expect(settleOrderFromEps).not.toHaveBeenCalled()
  })

  it('empty body → 200 OK + ignored:malformed', async () => {
    const res = await postWebhook({})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ data: { ok: true, ignored: 'malformed' } })
    expect(settleOrderFromEps).not.toHaveBeenCalled()
  })

  it('JSON-invalid body → 400 from zod-validator (the one path that does not 200)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/webhooks/eps/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('webhook route — IP rate-limit', () => {
  // The fixed-window limiter uses Date.now() to bucket. Without
  // frozen time, a slow CI runner can push the 100th and 101st hits
  // into different buckets and the test flakes ("expected throttled
  // got allowed"). Freezing the clock for the budget-exhaustion tests
  // makes window boundaries deterministic without changing the
  // limiter's semantics.
  beforeEach(() => {
    // vi.useFakeTimers({now: ...}) in vitest 2.1.x sets the initial
    // fake time but doesn't reliably mock Date.now() across all
    // call paths (Day 30 CI flake on PR #179 surfaced this — the
    // limiter's Math.floor(Date.now() / windowMs) saw advancing
    // values across 101 hits, allowing all of them). Belt-and-
    // braces: explicit vi.setSystemTime() guarantees Date.now()
    // returns the frozen value for every call site.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('100 hits from same IP pass; 101st throttled', async () => {
    const ip = '203.0.113.1'
    let allowed = 0
    let throttled = 0
    for (let i = 0; i < 101; i++) {
      const res = await postWebhook({}, { 'x-forwarded-for': ip }) // empty body → ignored:malformed branch
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { throttled?: boolean } }
      if (body.data.throttled) throttled += 1
      else allowed += 1
    }
    expect(allowed).toBe(100)
    expect(throttled).toBe(1)
  })

  it('different IPs have independent IP budgets', async () => {
    for (let i = 0; i < 100; i++) {
      await postWebhook({}, { 'x-forwarded-for': '203.0.113.10' })
    }
    const resA = await postWebhook({}, { 'x-forwarded-for': '203.0.113.10' })
    expect(((await resA.json()) as { data: { throttled?: boolean } }).data.throttled).toBe(true)

    const resB = await postWebhook({}, { 'x-forwarded-for': '203.0.113.11' })
    const bodyB = (await resB.json()) as { data: { throttled?: boolean } }
    expect(bodyB.data.throttled).toBeUndefined()
  })
})

describe('webhook route — txn-id rate-limit', () => {
  // Same flake-prevention as the IP rate-limit suite above — freeze
  // Date.now() for the duration of the budget-exhaustion tests so
  // the limiter's fixed-window bucket cannot roll mid-test.
  beforeEach(() => {
    // vi.useFakeTimers({now: ...}) in vitest 2.1.x sets the initial
    // fake time but doesn't reliably mock Date.now() across all
    // call paths (Day 30 CI flake on PR #179 surfaced this — the
    // limiter's Math.floor(Date.now() / windowMs) saw advancing
    // values across 101 hits, allowing all of them). Belt-and-
    // braces: explicit vi.setSystemTime() guarantees Date.now()
    // returns the frozen value for every call site.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-25T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('20 hits on the same txn-id pass; 21st throttled (independent of IP budget)', async () => {
    // Each hit from a different IP so IP limiter never trips; txn
    // limiter is the constraint.
    const txnId = 'TXN-RL-TXNONLY-001'
    let allowed = 0
    let throttled = 0
    for (let i = 0; i < 21; i++) {
      const res = await postWebhook(
        { merchant_transaction_id: txnId },
        { 'x-forwarded-for': `198.51.100.${i + 1}` },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { data: { throttled?: boolean } }
      if (body.data.throttled) throttled += 1
      else allowed += 1
    }
    expect(allowed).toBe(20)
    expect(throttled).toBe(1)
  })

  it('different txn-ids have independent budgets', async () => {
    // Exhaust txn-id A
    for (let i = 0; i < 20; i++) {
      await postWebhook(
        { merchant_transaction_id: 'TXN-RL-A' },
        { 'x-forwarded-for': `198.51.100.${100 + i}` },
      )
    }
    const resA = await postWebhook(
      { merchant_transaction_id: 'TXN-RL-A' },
      { 'x-forwarded-for': '198.51.100.250' },
    )
    expect(((await resA.json()) as { data: { throttled?: boolean } }).data.throttled).toBe(true)

    // txn-id B still has full budget
    const resB = await postWebhook(
      { merchant_transaction_id: 'TXN-RL-B' },
      { 'x-forwarded-for': '198.51.100.251' },
    )
    const bodyB = (await resB.json()) as { data: { throttled?: boolean } }
    expect(bodyB.data.throttled).toBeUndefined()
  })
})

describe('webhook route — settle-outcome passthrough (for observability)', () => {
  it('settle returns settled → response carries kind:settled fields', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-1',
      previousStatus: 'awaiting_payment',
      newStatus: 'paid',
    })
    const res = await postWebhook(
      { merchant_transaction_id: 'TXN-SETTLED-1' },
      { 'x-forwarded-for': '198.51.100.50' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { ok: boolean; kind: string; newStatus?: string }
    }
    expect(body.data.kind).toBe('settled')
    expect(body.data.newStatus).toBe('paid')
  })

  it('settle returns idempotent_noop → response carries that outcome', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'idempotent_noop',
      orderId: 'ord-2',
      currentStatus: 'paid',
    })
    const res = await postWebhook(
      { merchant_transaction_id: 'TXN-IDEMPOTENT' },
      { 'x-forwarded-for': '198.51.100.51' },
    )
    const body = (await res.json()) as { data: { kind: string } }
    expect(body.data.kind).toBe('idempotent_noop')
  })

  it('settle returns invalid_transition → response carries it; 200 OK', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'invalid_transition',
      orderId: 'ord-3',
      currentStatus: 'cancelled',
      attemptedTarget: 'paid',
      reason: 'Order cannot transition from cancelled to paid.',
    })
    const res = await postWebhook(
      { merchant_transaction_id: 'TXN-INVAL' },
      { 'x-forwarded-for': '198.51.100.52' },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { kind: string } }
    expect(body.data.kind).toBe('invalid_transition')
  })

  it('settle throws — bubbles to 500', async () => {
    // Generic error (not EpsNetworkError / EpsResponseError) → bubbles.
    vi.mocked(settleOrderFromEps).mockRejectedValueOnce(new Error('db down'))
    const res = await postWebhook(
      { merchant_transaction_id: 'TXN-DB-DOWN' },
      { 'x-forwarded-for': '198.51.100.53' },
    )
    expect(res.status).toBe(500)
  })
})

describe('webhook route — wiring sanity', () => {
  it('returns 404 on GET (route only accepts POST)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/webhooks/eps/callback', { method: 'GET' })
    expect(res.status).toBe(404)
  })
})
