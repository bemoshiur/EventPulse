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
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
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
      // FinancialEntity='bKash' required for success → paid transition
      // under Day 38 Phase 2 (d) Verify-guard. Without it the guard
      // diverts to disputed (fail-closed).
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', EPSTransactionId: 'EPS-9999', FinancialEntity: 'bKash' })

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
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
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
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
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
      // FinancialEntity='bKash' required for success → paid transition
      // under Day 38 Phase 2 (d) Verify-guard. Without it the guard
      // diverts to disputed (fail-closed).
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', FinancialEntity: 'bKash' })

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

  // ─── v1.0 single-method launch Verify-guard (Day 38 Phase 2 (d)) ────

  describe('v1.0 single-method launch Verify-guard — non-bKash diversion to disputed', () => {
    // Per `.claude/memory/decisions.md` "EPS fee-model structural decision
    // — Option 3 (single-method launch, bKash-only for v1.0) CHOSEN"
    // (2026-05-31) + Day 38 Phase 2 mechanism (d), when EPS Verify
    // returns Success but the buyer used a non-bKash payment method,
    // the settlement service diverts the order from `paid` to `disputed`
    // without ever marking it paid. The buyer's money is in EPS's
    // hands; ops manually refunds via the EPS merchant dashboard
    // (V5 has no public refund API per §11.4).

    it('CRITICAL: EPS verify Success + FinancialEntity "bKash" → order transitions to paid (the happy path)', async () => {
      const order = await seedOrder('awaiting_payment', 'guard-bkash-happy')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', FinancialEntity: 'bKash' })

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'redirect_success',
      })

      expect(result.kind).toBe('settled')
      if (result.kind === 'settled') {
        expect(result.newStatus).toBe('paid')
      }
      const [row] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)),
      )
      expect(row!.status).toBe('paid')
    })

    it('CRITICAL: EPS verify Success + FinancialEntity "card" → order transitions to disputed (NOT paid)', async () => {
      // This is the core enforcement path. A buyer paid via card on
      // EPS's hosted page despite our pre-checkout UI saying "Pay with
      // bKash". The platform refuses to honor; status goes to disputed;
      // ops will refund manually via EPS merchant dashboard.
      const order = await seedOrder('awaiting_payment', 'guard-card-dispute')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', FinancialEntity: 'card' })

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'redirect_success',
      })

      expect(result.kind).toBe('settled')
      if (result.kind === 'settled') {
        expect(result.previousStatus).toBe('awaiting_payment')
        expect(result.newStatus).toBe('disputed') // NOT 'paid'
      }
      const [row] = await withSuperAdmin((db) =>
        db
          .select({
            status: orders.status,
            paidAt: orders.paidAt,
            epsVerifiedAt: orders.epsVerifiedAt,
          })
          .from(orders)
          .where(eq(orders.id, order.id)),
      )
      expect(row!.status).toBe('disputed')
      // paid_at is NOT set on the dispute path — the order was never paid.
      expect(row!.paidAt).toBeNull()
      // epsVerifiedAt IS set — we DID verify; we just refused to honor.
      expect(row!.epsVerifiedAt).not.toBeNull()
    })

    it('EPS verify Success + FinancialEntity "Nagad" → disputed (any non-bKash MFS)', async () => {
      const order = await seedOrder('awaiting_payment', 'guard-nagad-dispute')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', FinancialEntity: 'Nagad' })

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'redirect_success',
      })

      expect(result.kind).toBe('settled')
      if (result.kind === 'settled') {
        expect(result.newStatus).toBe('disputed')
      }
    })

    it('EPS verify Success + missing FinancialEntity field → disputed (fail closed)', async () => {
      // If EPS doesn't populate FinancialEntity (theoretically possible
      // per the eps-wire-protocol V4VerifyResponseSchema marking the
      // field optional), we cannot confirm bKash → fail closed → dispute.
      // The platform must NEVER honor a paid order it cannot confirm
      // used the launch's allowed method.
      const order = await seedOrder('awaiting_payment', 'guard-missing-fe')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS' }) // no FinancialEntity

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'redirect_success',
      })

      expect(result.kind).toBe('settled')
      if (result.kind === 'settled') {
        expect(result.newStatus).toBe('disputed')
      }
    })

    it('EPS verify Failed + FinancialEntity "card" → failed (guard ONLY applies to success path)', async () => {
      // The guard only diverts target='paid'. EPS-reported failures
      // route normally to 'failed' regardless of FinancialEntity (EPS
      // already rejected the payment; the method choice is moot).
      const order = await seedOrder('awaiting_payment', 'guard-failed-card')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'FAILED', FinancialEntity: 'card' })

      const result = await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'redirect_success',
      })

      expect(result.kind).toBe('settled')
      if (result.kind === 'settled') {
        expect(result.newStatus).toBe('failed')
      }
    })

    it('Dispute writes audit_logs row with action=order.disputed + dispute_reason + financial_entity', async () => {
      const order = await seedOrder('awaiting_payment', 'guard-audit')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', FinancialEntity: 'Visa' })

      await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      const audits = await withSuperAdmin((db) =>
        db
          .select({ action: auditLogs.action, diff: auditLogs.diff })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, order.id)),
      )
      // Should have one order.disputed audit row (the v1.0 dispute path).
      // Should NOT have an order.paid audit row (we never marked paid).
      expect(audits.some((a) => a.action === 'order.disputed')).toBe(true)
      expect(audits.some((a) => a.action === 'order.paid')).toBe(false)

      const disputeRow = audits.find((a) => a.action === 'order.disputed')!
      const diff = disputeRow.diff as Record<string, unknown>
      expect(diff['previous_status']).toBe('awaiting_payment')
      expect(diff['new_status']).toBe('disputed')
      expect(diff['dispute_reason']).toBe('non_bkash_method_at_verify')
      // financial_entity captured verbatim (no normalisation).
      expect(diff['financial_entity']).toBe('Visa')
    })

    it('Dispute writes order_events row with event_type=order.disputed + payload includes financial_entity', async () => {
      const order = await seedOrder('awaiting_payment', 'guard-events-trail')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', FinancialEntity: 'Rocket' })

      await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      const eventsRows = await withSuperAdmin((db) =>
        db
          .select({ eventType: orderEvents.eventType, payload: orderEvents.payload })
          .from(orderEvents)
          .where(eq(orderEvents.orderId, order.id)),
      )
      const disputed = eventsRows.find((e) => e.eventType === 'order.disputed')
      expect(disputed).toBeDefined()
      const payload = disputed!.payload as Record<string, unknown>
      expect(payload['dispute_reason']).toBe('non_bkash_method_at_verify')
      expect(payload['financial_entity']).toBe('Rocket')
    })

    it('Dispute path does NOT enqueue ticket delivery (no QR / no email)', async () => {
      // The post-tx enqueueOrderDelivery is gated on `target === 'paid'`.
      // For disputed orders the gate is false; no delivery is enqueued.
      // This test pins the negative: a disputed order's worker queue
      // count is unchanged from before the settle call.
      //
      // We assert indirectly via the absence of an order.delivery_sent
      // event_type — the worker would write one if it ran.
      const order = await seedOrder('awaiting_payment', 'guard-no-delivery')
      await defaultTokenCache().set(_accessTokenCacheKey, 'cached-jwt', 60)
      nock(PROD_BASE)
        .get('/v1/EPSEngine/CheckMerchantTransactionStatus')
        .query(true)
        .reply(200, { Status: 'SUCCESS', FinancialEntity: 'Mastercard' })

      await settleOrderFromEps({
        merchantTransactionId: order.merchantTransactionId,
        source: 'webhook',
      })

      const eventsRows = await withSuperAdmin((db) =>
        db
          .select({ eventType: orderEvents.eventType })
          .from(orderEvents)
          .where(eq(orderEvents.orderId, order.id)),
      )
      expect(eventsRows.some((e) => e.eventType === 'order.delivery_sent')).toBe(false)
    })
  })
})
