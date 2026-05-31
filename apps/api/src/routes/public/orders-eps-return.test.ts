/**
 * EPS browser redirect handlers — route tests (no DB).
 * Sprint 3 Day 27 Phase 3.
 *
 * Pinned (the critical Day 27 invariants):
 *
 *   1. **CRITICAL: success-redirect does NOT mark an order paid on
 *      its own.** Settlement comes from verifyOrder()'s response,
 *      not from which URL the browser hit. Test simulates a buyer
 *      landing on `/eps-return/success` with a real txn id; service
 *      mock returns `verify_inconclusive` (EPS says pending);
 *      browser is redirected to the PENDING frontend page, NOT the
 *      success page.
 *
 *   2. Outbound redirect path is computed from the settlement
 *      result, NOT from the inbound path. e.g. user lands on
 *      `/success` but service confirms verified-failed → browser is
 *      redirected to `/orders/return/fail`.
 *
 *   3. Unknown txn → redirected to `/orders/return/error` (no
 *      orderId leakage; the browser never learns whether the txn
 *      existed).
 *
 *   4. Malformed query (missing txn id) → error page.
 *
 *   5. Already-paid order (idempotent_noop) → success page (browser
 *      sees the resolved status regardless of inbound path).
 *
 *   6. EPS verify HTTP failure → pending page (not 500); the
 *      webhook will reconcile, the frontend can poll.
 *
 *   7. GET-only — POST returns 404.
 *
 * Settle service is vi.mock'd so tests stay unit-level. The
 * DB-touching behaviour is exercised in `services/orders/
 * settle.test.ts` against a real DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/orders/settle.js', () => ({
  settleOrderFromEps: vi.fn(async () => ({
    kind: 'unknown_transaction',
    merchantTransactionId: 'TXN-MOCKED',
  })),
}))

import { createApp } from '../../app.js'
import { EpsNetworkError } from '../../infra/eps/client.js'
import { settleOrderFromEps } from '../../services/orders/settle.js'

const ORIGINAL_WEB_BASE = process.env['EVENTPULSE_WEB_BASE_URL']

beforeEach(() => {
  vi.mocked(settleOrderFromEps).mockClear()
  process.env['EVENTPULSE_WEB_BASE_URL'] = 'https://staging.eventpulse.com.bd'
})

afterEach(() => {
  if (ORIGINAL_WEB_BASE === undefined) {
    delete process.env['EVENTPULSE_WEB_BASE_URL']
  } else {
    process.env['EVENTPULSE_WEB_BASE_URL'] = ORIGINAL_WEB_BASE
  }
})

const TXN = 'TXN-test-merchant-12345'

async function hitReturn(
  flavour: 'success' | 'fail' | 'cancel',
  query: Record<string, string> = { merchantTransactionId: TXN },
) {
  const app = createApp()
  const qs = new URLSearchParams(query).toString()
  return app.request(`/api/v1/public/orders/eps-return/${flavour}?${qs}`, { method: 'GET' })
}

function expectRedirect(res: Response, expectedSuffix: string) {
  expect(res.status).toBe(302)
  const location = res.headers.get('location')
  expect(location).not.toBeNull()
  expect(location!).toContain(expectedSuffix)
  return location!
}

// ─── THE CRITICAL fraud-prevention invariant ────────────────────────

describe('CRITICAL: redirect URL is NEVER authoritative for payment status', () => {
  it('buyer lands on /success but EPS says PENDING → browser redirected to /orders/return/pending (NOT /success)', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'verify_inconclusive',
      orderId: 'ord-pending',
      epsStatus: 'pending',
    })

    const res = await hitReturn('success')

    // The user hit /success but the service determined pending →
    // browser must land on /orders/return/pending, NOT /success.
    expectRedirect(res, '/orders/return/pending')
    expect(res.headers.get('location')).not.toContain('/orders/return/success')
  })

  it('buyer lands on /success but EPS verifies FAILED → browser redirected to /orders/return/fail', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-1',
      previousStatus: 'awaiting_payment',
      newStatus: 'failed',
    })

    const res = await hitReturn('success')
    expectRedirect(res, '/orders/return/fail?orderId=ord-1')
    expect(res.headers.get('location')).not.toContain('/orders/return/success')
  })

  it('buyer lands on /fail but EPS verifies SUCCESS → browser redirected to /orders/return/success', async () => {
    // EPS sent the user to /fail (maybe a redirect race) but verify
    // confirms success. The truth wins; browser lands on /success.
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-2',
      previousStatus: 'awaiting_payment',
      newStatus: 'paid',
    })

    const res = await hitReturn('fail')
    expectRedirect(res, '/orders/return/success?orderId=ord-2')
  })
})

// ─── happy-path redirects (verified status matches inbound path) ────

describe('happy-path: settlement and inbound path agree', () => {
  it('/success + verified paid → /orders/return/success?orderId=...', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-happy-paid',
      previousStatus: 'awaiting_payment',
      newStatus: 'paid',
    })
    const res = await hitReturn('success')
    expectRedirect(res, '/orders/return/success?orderId=ord-happy-paid')
  })

  it('/fail + verified failed → /orders/return/fail', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-happy-fail',
      previousStatus: 'awaiting_payment',
      newStatus: 'failed',
    })
    const res = await hitReturn('fail')
    expectRedirect(res, '/orders/return/fail?orderId=ord-happy-fail')
  })

  it('/cancel + verified cancelled → /orders/return/cancel', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-happy-cancel',
      previousStatus: 'awaiting_payment',
      newStatus: 'cancelled',
    })
    const res = await hitReturn('cancel')
    expectRedirect(res, '/orders/return/cancel?orderId=ord-happy-cancel')
  })

  it('/success + verified disputed (non-bKash method) → /orders/return/wrong-method', async () => {
    // v1.0 single-method launch Verify-guard outcome (Day 38 Phase 2 (d)
    // per decisions.md 2026-05-31 Option 3). Buyer paid via non-bKash
    // method on EPS's hosted page; platform refused to honor; redirect
    // to the bKash-only explanation page.
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-disputed-wrong-method',
      previousStatus: 'awaiting_payment',
      newStatus: 'disputed',
    })
    const res = await hitReturn('success')
    expectRedirect(res, '/orders/return/wrong-method?orderId=ord-disputed-wrong-method')
  })

  it('source label flows correctly: /success → settleOrderFromEps called with source=redirect_success', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-source',
      previousStatus: 'awaiting_payment',
      newStatus: 'paid',
    })
    await hitReturn('success')
    expect(settleOrderFromEps).toHaveBeenCalledWith({
      merchantTransactionId: TXN,
      source: 'redirect_success',
    })
  })
})

// ─── idempotent / already-settled cases ─────────────────────────────

describe('already-settled idempotent paths', () => {
  it('already paid (idempotent_noop) → /orders/return/success', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'idempotent_noop',
      orderId: 'ord-already-paid',
      currentStatus: 'paid',
    })
    const res = await hitReturn('success')
    expectRedirect(res, '/orders/return/success?orderId=ord-already-paid')
  })

  it('already disputed (idempotent_noop) → /orders/return/wrong-method (consistent with fresh-dispute path)', async () => {
    // Re-delivered webhook or buyer back-button for an already-disputed
    // order — same explanation page as the fresh-dispute path so the
    // buyer sees a consistent message regardless of arrival path.
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'idempotent_noop',
      orderId: 'ord-already-disputed',
      currentStatus: 'disputed',
    })
    const res = await hitReturn('success')
    expectRedirect(res, '/orders/return/wrong-method?orderId=ord-already-disputed')
  })

  it('already failed (idempotent_noop) → /orders/return/fail', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'idempotent_noop',
      orderId: 'ord-already-failed',
      currentStatus: 'failed',
    })
    const res = await hitReturn('success') // user lands on success, but already-failed wins
    expectRedirect(res, '/orders/return/fail?orderId=ord-already-failed')
  })

  it('already cancelled (idempotent_noop) → /orders/return/cancel', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'idempotent_noop',
      orderId: 'ord-already-cancelled',
      currentStatus: 'cancelled',
    })
    const res = await hitReturn('cancel')
    expectRedirect(res, '/orders/return/cancel?orderId=ord-already-cancelled')
  })
})

// ─── unknown / tampered / malformed ────────────────────────────────

describe('safe rejection of unknown / tampered / malformed', () => {
  it('unknown txn → /orders/return/error (no orderId leakage)', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'unknown_transaction',
      merchantTransactionId: 'TXN-spoofed-12345',
    })
    const res = await hitReturn('success', { merchantTransactionId: 'TXN-spoofed-12345' })
    const location = expectRedirect(res, '/orders/return/error')
    expect(location).not.toContain('orderId=')
    expect(location).not.toContain('TXN-spoofed-12345')
  })

  it('missing merchantTransactionId query param → /orders/return/error', async () => {
    const res = await hitReturn('success', {} as Record<string, string>)
    expectRedirect(res, '/orders/return/error')
  })

  it('merchantTransactionId too short → /orders/return/error', async () => {
    // <10 chars fails zod
    const res = await hitReturn('success', { merchantTransactionId: 'short' })
    expectRedirect(res, '/orders/return/error')
  })

  it('snake_case alias `merchant_transaction_id` is also accepted', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-snake',
      previousStatus: 'awaiting_payment',
      newStatus: 'paid',
    })
    const res = await hitReturn('success', { merchant_transaction_id: 'TXN-snake-12345-snake' })
    expectRedirect(res, '/orders/return/success?orderId=ord-snake')
    expect(settleOrderFromEps).toHaveBeenCalledWith({
      merchantTransactionId: 'TXN-snake-12345-snake',
      source: 'redirect_success',
    })
  })
})

// ─── EPS verify failure handling ────────────────────────────────────

describe('EPS verify HTTP failure', () => {
  it('verify network error → /orders/return/pending (not 500); the buyer sees a pending UI, webhook reconciles', async () => {
    vi.mocked(settleOrderFromEps).mockRejectedValueOnce(
      new EpsNetworkError('connect ECONNREFUSED', new Error('econn'), 'req-1'),
    )
    const res = await hitReturn('success')
    expectRedirect(res, '/orders/return/pending')
  })

  it('generic (non-EPS) error → bubbles to 500', async () => {
    vi.mocked(settleOrderFromEps).mockRejectedValueOnce(new Error('unexpected'))
    const res = await hitReturn('success')
    expect(res.status).toBe(500)
  })
})

// ─── method + wiring sanity ────────────────────────────────────────

describe('routing sanity', () => {
  it('POST /eps-return/success → 404 (GET only)', async () => {
    const app = createApp()
    const res = await app.request(
      `/api/v1/public/orders/eps-return/success?merchantTransactionId=${TXN}`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
  })

  it('all 3 flavours are mounted', async () => {
    vi.mocked(settleOrderFromEps).mockResolvedValue({
      kind: 'verify_inconclusive',
      orderId: 'ord-x',
      epsStatus: 'pending',
    })
    for (const flavour of ['success', 'fail', 'cancel'] as const) {
      const res = await hitReturn(flavour)
      expect(res.status).toBe(302) // all redirect
    }
  })
})

// ─── infra misconfig ───────────────────────────────────────────────

describe('infra misconfig', () => {
  it('EVENTPULSE_WEB_BASE_URL unset → 500 with inline error (not silent bad redirect)', async () => {
    delete process.env['EVENTPULSE_WEB_BASE_URL']
    vi.mocked(settleOrderFromEps).mockResolvedValueOnce({
      kind: 'settled',
      orderId: 'ord-noconfig',
      previousStatus: 'awaiting_payment',
      newStatus: 'paid',
    })
    const res = await hitReturn('success')
    expect(res.status).toBe(500)
  })
})
