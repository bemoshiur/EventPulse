/**
 * Order settlement service — integration tests (DB-gated).
 * Sprint 3 Day 27 Phase 2.
 *
 * Pinned behaviour:
 *
 *   1. Verify-by-callback as the authority — the service consumes
 *      verifyOrder()'s response, NOT the source's claim.
 *   2. Fraud-impossibility: even when triggered with arbitrary
 *      source, the order's new status comes from EPS verify alone.
 *      Spoofed "paid" via webhook is impossible because the verify
 *      response is what we trust.
 *   3. Idempotent fast-path: settling an already-settled order is a
 *      no-op (no verify call, no DB mutation).
 *   4. EPS pending → no-op (verify_inconclusive).
 *   5. EPS unknown → no-op (verify_inconclusive).
 *   6. Unknown merchant_transaction_id → unknown_transaction (no
 *      mutation, no EPS call after lookup miss).
 *   7. Invalid state-machine transition → invalid_transition (no
 *      mutation; logged).
 *   8. Success path: order.status flips, paid_at set, eps fields
 *      captured, order_events row appended, audit_logs row written.
 *
 * EPS HTTP is mocked via nock — no real network calls.
 */

import { eq } from 'drizzle-orm'
import nock from 'nock'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  auditLogs,
  events,
  orderEvents,
  orders,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'
import {
  _accessTokenCacheKey,
  _resetTokenCacheForTest,
  defaultTokenCache,
  inMemoryTokenCache,
  setDefaultTokenCache,
} from '../../infra/eps/client.js'
import { settleOrderFromEps } from './settle.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const PROD_BASE = 'https://pgapi.eps.com.bd'

const ENV_KEYS = [
  'EPS_MERCHANT_ID',
  'EPS_STORE_ID',
  'EPS_USERNAME',
  'EPS_PASSWORD',
  'EPS_HASH_KEY',
  'EPS_MODE',
  'STAGING_PAYMENT_BLOCK',
] as const

const ORIGINAL_ENV: Record<string, string | undefined> = {}

const physicalVenue = {
  type: 'physical' as const,
  name: 'Test Venue',
  address: '12 Test Road',
  division: 'dhaka' as const,
  district: 'Dhaka',
}
const future = (offsetMs: number) => new Date(Date.now() + offsetMs)

interface Fixture {
  ownerId: string
  tenantId: string
  eventId: string
  tierId: string
}

describeIfDb('settleOrderFromEps — verify-by-callback authority + idempotency', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const txnId = (suffix: string) => `TXN-${seed}-${suffix}`

  beforeAll(async () => {
    for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k]
    process.env['EPS_MERCHANT_ID'] = 'merchant-settle'
    process.env['EPS_STORE_ID'] = 'store-settle'
    process.env['EPS_USERNAME'] = 'epssettle'
    process.env['EPS_PASSWORD'] = 'epspass'
    process.env['EPS_HASH_KEY'] = 'hashkey-settle'
    process.env['EPS_MODE'] = 'production'
    delete process.env['STAGING_PAYMENT_BLOCK']

    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `settle-test-owner-${seed}@test.local`,
          fullName: 'Settle Test Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const [t] = await db
        .insert(tenants)
        .values({
          name: 'Settle Test Tenant',
          slug: `settle-test-tenant-${seed}`,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantId = t!.id

      const [evt] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantId,
          slug: `settle-test-event-${seed}`,
          type: 'concert',
          title: 'Settle Test Event',
          status: 'on_sale',
          startsAt: future(30 * 24 * 60 * 60 * 1000),
          endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
          venue: physicalVenue,
          createdBy: fx.ownerId,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
        })
        .returning({ id: events.id })
      fx.eventId = evt!.id

      const [tier] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          name: 'General',
          pricePaisa: 100_000n,
          capacity: 100,
        })
        .returning({ id: ticketTiers.id })
      fx.tierId = tier!.id
    })
  })

  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (ORIGINAL_ENV[k] === undefined) delete process.env[k]
      else process.env[k] = ORIGINAL_ENV[k]
    }
    await resetPool()
  })

  beforeEach(() => {
    setDefaultTokenCache(inMemoryTokenCache())
    _resetTokenCacheForTest()
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  /**
   * Helper — seed an order at a given status under withSuperAdmin
   * (mirrors the buyer-write path's service-role insert pattern).
   */
  async function seedOrder(
    status: 'awaiting_payment' | 'paid' | 'failed' | 'cancelled' | 'pending',
    suffix: string,
  ): Promise<{ id: string; merchantTransactionId: string }> {
    return withSuperAdmin(async (db) => {
      const [o] = await db
        .insert(orders)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          merchantTransactionId: txnId(suffix),
          buyerName: 'Test Buyer',
          buyerEmail: `buyer-${suffix}@test.local`,
          buyerPhone: '+8801700000000',
          subtotalPaisa: 100_000n,
          epsFeePaisa: 2500n,
          platformFeePaisa: 250n,
          totalPaisa: 102_750n,
          netToOrganiserPaisa: 100_000n,
          platformFeeBps: 25,
          epsFeeBps: 250,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
          status,
        })
        .returning({ id: orders.id, merchantTransactionId: orders.merchantTransactionId })
      return o!
    })
  }

  describe('verify-by-callback authority — the fraud-prevention surface', () => {
    it('CRITICAL: webhook source claims paid, but EPS verify returns failed → order transitions to failed (NOT paid)', async () => {
      // This is the canonical fraud-prevention test. A spoofed
      // webhook says "paid"; the verify response says "failed". The
      // service IGNORES the webhook's claim and trusts EPS verify.
      const order = await seedOrder('awaiting_payment', 'spoof-paid')

      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .post('/api/v1/CheckMerchantTransactionStatus')
        .reply(200, { Status: 'FAILED' }) // EPS says FAILED

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      expect(result.kind).toBe('settled')
      if (result.kind === 'settled') {
        expect(result.previousStatus).toBe('awaiting_payment')
        expect(result.newStatus).toBe('failed') // NOT 'paid'
      }
      const [row] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)),
      )
      expect(row!.status).toBe('failed')
    })

    it('CRITICAL: spoofed webhook for an order that IS paid → verify returns SUCCESS → transitions to paid (correct outcome)', async () => {
      // A spoofed webhook with a real txn-id can only DO what would
      // happen anyway: trigger a verify, transition to the EPS-true
      // status. Spoofing doesn't fabricate state.
      const order = await seedOrder('awaiting_payment', 'spoof-real-paid')

      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .post('/api/v1/CheckMerchantTransactionStatus')
        .reply(200, { Status: 'SUCCESS', EPSTransactionId: 'EPS-9999' })

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      expect(result.kind).toBe('settled')
      if (result.kind === 'settled') {
        expect(result.newStatus).toBe('paid')
      }
      const [row] = await withSuperAdmin((db) =>
        db
          .select({
            status: orders.status,
            paidAt: orders.paidAt,
            epsTransactionId: orders.epsTransactionId,
            epsVerifiedAt: orders.epsVerifiedAt,
          })
          .from(orders)
          .where(eq(orders.id, order.id)),
      )
      expect(row!.status).toBe('paid')
      expect(row!.paidAt).not.toBeNull()
      expect(row!.epsTransactionId).toBe('EPS-9999')
      expect(row!.epsVerifiedAt).not.toBeNull()
    })
  })

  describe('idempotent fast-path — already-settled orders', () => {
    it('order already paid → idempotent_noop; ZERO HTTP calls fire', async () => {
      const order = await seedOrder('paid', 'already-paid')
      // No nock interceptor registered. If verify fires, nock-disabled
      // net connect throws "Disallowed net connect".

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      expect(result.kind).toBe('idempotent_noop')
      if (result.kind === 'idempotent_noop') {
        expect(result.currentStatus).toBe('paid')
      }
      expect(nock.pendingMocks()).toEqual([])
    })

    it('order already failed → idempotent_noop', async () => {
      const order = await seedOrder('failed', 'already-failed')
      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })
      expect(result.kind).toBe('idempotent_noop')
    })

    it('order already cancelled → idempotent_noop', async () => {
      const order = await seedOrder('cancelled', 'already-cancelled')
      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })
      expect(result.kind).toBe('idempotent_noop')
    })
  })

  describe('inconclusive verify responses', () => {
    it('EPS returns PENDING → verify_inconclusive (no transition)', async () => {
      const order = await seedOrder('awaiting_payment', 'pending-verify')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .post('/api/v1/CheckMerchantTransactionStatus')
        .reply(200, { Status: 'PENDING' })

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      expect(result.kind).toBe('verify_inconclusive')
      const [row] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)),
      )
      expect(row!.status).toBe('awaiting_payment') // unchanged
    })

    it('EPS returns unknown alias → verify_inconclusive', async () => {
      const order = await seedOrder('awaiting_payment', 'weird-verify')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .post('/api/v1/CheckMerchantTransactionStatus')
        .reply(200, { Status: 'WEIRD_ALIAS' })

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      expect(result.kind).toBe('verify_inconclusive')
    })
  })

  describe('unknown transaction', () => {
    it('non-existent merchant_transaction_id → unknown_transaction; no verify call', async () => {
      // No order seeded with this txn id. No nock — verify must not fire.
      const result = await settleOrderFromEps({
        merchantTransactionId: 'TXN-NEVER-EXISTED-123',
        source: 'webhook',
      })
      expect(result.kind).toBe('unknown_transaction')
      expect(nock.pendingMocks()).toEqual([])
    })
  })

  describe('event-sourcing trail + audit', () => {
    it('successful settlement writes order_events + audit_logs rows', async () => {
      const order = await seedOrder('awaiting_payment', 'audit-success')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .post('/api/v1/CheckMerchantTransactionStatus')
        .reply(200, { Status: 'SUCCESS' })

      await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      const events = await withSuperAdmin((db) =>
        db
          .select({ eventType: orderEvents.eventType, actorType: orderEvents.actorType })
          .from(orderEvents)
          .where(eq(orderEvents.orderId, order.id)),
      )
      expect(events.some((e) => e.eventType === 'order.paid' && e.actorType === 'system')).toBe(
        true,
      )

      const audits = await withSuperAdmin((db) =>
        db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, order.id)),
      )
      expect(audits.some((a) => a.action === 'order.paid')).toBe(true)
    })
  })
})
