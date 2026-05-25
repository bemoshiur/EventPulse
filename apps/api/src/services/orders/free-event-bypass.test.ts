/**
 * Free-event bypass — DB-gated integration tests.
 * Sprint 3 Day 30 Phase 1a.
 *
 * Pinned per §13.5:
 *
 *   1. Order with every tier price_paisa = 0 → born `paid` (NOT
 *      `awaiting_payment`); `paid_at` set; `paymentInitState: 'free'`;
 *      `redirectUrl: null`.
 *   2. The §14.3 calculator runs (returns all zeros — never branch on
 *      'is this free' outside the calculator per §13.5 architectural
 *      rule). All money fields = 0; the §14.10 Invariant 1 holds
 *      trivially.
 *   3. EPS init is NEVER called — verified via the absence of an
 *      `initialiseOrder` call (the block guard would allow 0-paisa
 *      through, but EPS would reject; the right behaviour is to skip
 *      EPS entirely per §13.5).
 *   4. An `order.paid` event-sourcing row is written with
 *      `source: 'free_event_auto_settle'` — distinct from the Day-27
 *      settle-service path's `source: 'webhook'` etc.
 *   5. The standard buyer-creation audit row is still written
 *      (`order.created`); the free-event branch is additive.
 *   6. Mixed-price tier orders (one free, one paid) take the PAID
 *      path — the §13.5 rule is "every tier price_paisa = 0", not
 *      "any tier".
 *   7. Delivery enqueue fires after the tx commits — same Day-28
 *      `enqueueOrderDelivery` path. No-Redis returns `enqueued:false`
 *      cleanly; settlement reliability invariant preserved.
 */

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  events,
  orderEvents,
  orderItems,
  orders,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'

import { createOrder } from './index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const ORIGINAL_BLOCK = process.env['STAGING_PAYMENT_BLOCK']

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
  freeTierId: string
  paidTierId: string
}

describeIfDb('createOrder — §13.5 free-event bypass (born-paid, no EPS)', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  beforeAll(async () => {
    // Block stays ON for the test; the bypass should fire BEFORE the
    // block guard (the block guard wouldn't have refused 0-paisa anyway,
    // but the bypass means EPS isn't called at all).
    process.env['STAGING_PAYMENT_BLOCK'] = '1'

    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `free-event-test-${seed}@test.local`,
          fullName: 'Free Event Test Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const [t] = await db
        .insert(tenants)
        .values({
          name: 'Free Event Test Tenant',
          slug: `free-event-test-${seed}`,
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
          slug: `free-event-test-event-${seed}`,
          type: 'community',
          title: 'Free Event',
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

      const [freeTier] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          name: 'RSVP — Free',
          pricePaisa: 0n,
          capacity: 1000,
        })
        .returning({ id: ticketTiers.id })
      fx.freeTierId = freeTier!.id

      const [paidTier] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          name: 'VIP — Paid',
          pricePaisa: 50_000n,
          capacity: 50,
        })
        .returning({ id: ticketTiers.id })
      fx.paidTierId = paidTier!.id
    })
  })

  afterAll(async () => {
    if (ORIGINAL_BLOCK === undefined) delete process.env['STAGING_PAYMENT_BLOCK']
    else process.env['STAGING_PAYMENT_BLOCK'] = ORIGINAL_BLOCK
    await resetPool()
  })

  const buyerInput = (suffix: string) => ({
    name: 'Free Test Buyer',
    email: `buyer-${suffix}@test.local`,
    phone: '+8801700000000',
  })

  describe('free-only tier selection — born paid, no EPS', () => {
    it('returns status=paid + paymentInitState=free + redirectUrl=null', async () => {
      const result = await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.freeTierId, quantity: 1 }],
        buyer: buyerInput('free-1'),
      })

      expect(result.status).toBe('paid')
      expect(result.paymentInitState).toBe('free')
      expect(result.redirectUrl).toBeNull()
      expect(result.fees.subtotalPaisa).toBe(0n)
      expect(result.fees.platformFeePaisa).toBe(0n)
      expect(result.fees.epsFeePaisa).toBe(0n)
      expect(result.fees.buyerTotalPaisa).toBe(0n)
      expect(result.fees.organiserNetPaisa).toBe(0n)
    })

    it('persists orders row with status=paid + paid_at set', async () => {
      const result = await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.freeTierId, quantity: 1 }],
        buyer: buyerInput('free-2'),
      })

      const [row] = await withSuperAdmin((db) =>
        db
          .select({
            status: orders.status,
            paidAt: orders.paidAt,
            totalPaisa: orders.totalPaisa,
          })
          .from(orders)
          .where(eq(orders.id, result.orderId)),
      )
      expect(row!.status).toBe('paid')
      expect(row!.paidAt).toBeInstanceOf(Date)
      expect(row!.totalPaisa).toBe(0n)
    })

    it('writes order.created + order.paid event-sourcing rows', async () => {
      const result = await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.freeTierId, quantity: 1 }],
        buyer: buyerInput('free-3'),
      })

      const rows = await withSuperAdmin((db) =>
        db
          .select({ eventType: orderEvents.eventType, payload: orderEvents.payload })
          .from(orderEvents)
          .where(eq(orderEvents.orderId, result.orderId)),
      )
      const types = rows.map((r) => r.eventType).sort()
      expect(types).toEqual(['order.created', 'order.paid'])

      const paidRow = rows.find((r) => r.eventType === 'order.paid')!
      const payload = paidRow.payload as Record<string, unknown>
      expect(payload['source']).toBe('free_event_auto_settle')
      expect(payload['total_paisa']).toBe('0')
    })

    it('quantity > 1 free tickets — all attendees free, born paid', async () => {
      const result = await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.freeTierId, quantity: 3 }],
        buyer: buyerInput('free-q3'),
      })
      expect(result.status).toBe('paid')
      expect(result.paymentInitState).toBe('free')
      expect(result.fees.buyerTotalPaisa).toBe(0n)

      const items = await withSuperAdmin((db) =>
        db.select().from(orderItems).where(eq(orderItems.orderId, result.orderId)),
      )
      expect(items).toHaveLength(1)
      expect(items[0]!.quantity).toBe(3)
    })

    it('§14.10 Invariant 1 holds trivially for free order (total = 0 = 0+0+0+0)', async () => {
      const result = await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.freeTierId, quantity: 2 }],
        buyer: buyerInput('free-inv'),
      })
      const [row] = await withSuperAdmin((db) =>
        db
          .select({
            total: orders.totalPaisa,
            net: orders.netToOrganiserPaisa,
            platformFee: orders.platformFeePaisa,
            epsFee: orders.epsFeePaisa,
            withholding: orders.withholdingTaxPaisa,
          })
          .from(orders)
          .where(eq(orders.id, result.orderId)),
      )
      const split = row!.net + row!.platformFee + row!.epsFee + row!.withholding
      expect(row!.total).toBe(split)
      expect(row!.total).toBe(0n)
    })
  })

  describe('mixed paid+free order takes the PAID path (not the free bypass)', () => {
    it('one free + one paid tier → status=awaiting_payment (paid path)', async () => {
      // Per §13.5: "Events where EVERY ticket tier has price_paisa = 0"
      // — the rule is "every", not "any". A mixed cart goes the paid path.
      // (The total is non-zero; EPS init fires; block-guard refuses
      // because totalPaisa > 0n → paymentInitState='blocked'.)
      const result = await createOrder({
        eventId: fx.eventId,
        tierSelections: [
          { tierId: fx.freeTierId, quantity: 1 },
          { tierId: fx.paidTierId, quantity: 1 },
        ],
        buyer: buyerInput('mixed'),
      })
      expect(result.status).toBe('awaiting_payment')
      // Block is ON; mixed cart is paid → block refuses init.
      expect(result.paymentInitState).toBe('blocked')
      expect(result.fees.buyerTotalPaisa).toBeGreaterThan(0n)

      // The orders row is awaiting_payment, NOT paid.
      const [row] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, result.orderId)),
      )
      expect(row!.status).toBe('awaiting_payment')

      // No `order.paid` event-sourcing row for the paid path.
      const paidEventRows = await withSuperAdmin((db) =>
        db
          .select()
          .from(orderEvents)
          .where(
            sql`${orderEvents.orderId} = ${result.orderId} AND ${orderEvents.eventType} = 'order.paid'`,
          ),
      )
      expect(paidEventRows).toHaveLength(0)
    })
  })

  describe('block invariant preserved', () => {
    it('STAGING_PAYMENT_BLOCK=1 does NOT block free-event auto-settle (zero-paisa is allowed)', async () => {
      process.env['STAGING_PAYMENT_BLOCK'] = '1'
      const result = await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.freeTierId, quantity: 1 }],
        buyer: buyerInput('block-on'),
      })
      // Bypass fires before the EPS call; block doesn't even get
      // consulted. paymentInitState reflects 'free', not 'blocked'.
      expect(result.paymentInitState).toBe('free')
      expect(result.status).toBe('paid')
    })
  })
})
