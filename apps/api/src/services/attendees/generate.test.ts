/**
 * Attendee row generation — DB-gated integration tests.
 * Sprint 3 Day 28 Phase 1.
 *
 * Pinned behaviour:
 *
 *   1. Happy path: one attendees row per (order_item × quantity);
 *      each with a unique 256-bit QR token; submission_data empty
 *      jsonb; FK relationships intact.
 *   2. Idempotency: re-invoking for an already-generated order
 *      returns `'already_generated'` with the existing attendee
 *      IDs; no double-write. The append-only marker in order_events
 *      is the guard.
 *   3. order_not_paid: only paid|completed orders are eligible;
 *      awaiting_payment / pending / failed / cancelled return
 *      `'order_not_paid'` with no DB mutation.
 *   4. order_not_found: bogus orderId returns
 *      `'order_not_found'` cleanly.
 *   5. Audit row written: `order.attendees_generated` audit + the
 *      matching order_events marker land in the same tx.
 *   6. Multi-tier: an order with multiple order_items + varied
 *      quantities generates the correct breakdown per tier.
 *   7. Multi-quantity naming: for quantity > 1, attendee_name gets
 *      "(Ticket N of M)" suffix; for quantity = 1, buyer name verbatim.
 *
 * Note: NO EPS mocking needed here — the service does NOT call EPS.
 * NO STAGING_PAYMENT_BLOCK concern — this service generates rows from
 * an already-paid order; no money is moved.
 */

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  attendees,
  auditLogs,
  events,
  orderEvents,
  orderItems,
  orders,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'

import { generateAttendeesForOrder } from './generate.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

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
  tierA: string
  tierB: string
}

describeIfDb('generateAttendeesForOrder', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const txnId = (suffix: string) => `TXN-att-${seed}-${suffix}`

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `attendee-test-owner-${seed}@test.local`,
          fullName: 'Attendee Test Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const [t] = await db
        .insert(tenants)
        .values({
          name: 'Attendee Test Tenant',
          slug: `attendee-test-tenant-${seed}`,
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
          slug: `attendee-test-event-${seed}`,
          type: 'concert',
          title: 'Attendee Test Event',
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

      const [a] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          name: 'General',
          pricePaisa: 100_000n,
          capacity: 100,
        })
        .returning({ id: ticketTiers.id })
      fx.tierA = a!.id

      const [b] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          name: 'VIP',
          pricePaisa: 250_000n,
          capacity: 20,
        })
        .returning({ id: ticketTiers.id })
      fx.tierB = b!.id
    })
  })

  afterAll(async () => {
    await resetPool()
  })

  /**
   * Helper — seed an order at a given status with a defined set of
   * (tier, quantity) pairs. Returns the order id + item ids for
   * downstream assertions.
   */
  async function seedOrder(
    status: 'awaiting_payment' | 'paid' | 'failed' | 'completed' | 'cancelled',
    suffix: string,
    selections: Array<{ tierId: string; quantity: number }>,
    overrides?: { buyerName?: string },
  ): Promise<{ id: string; orderItemIds: string[] }> {
    return withSuperAdmin(async (db) => {
      const subtotal = selections.reduce((acc, s) => acc + 100_000n * BigInt(s.quantity), 0n)
      const [o] = await db
        .insert(orders)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          merchantTransactionId: txnId(suffix),
          buyerName: overrides?.buyerName ?? 'Test Buyer',
          buyerEmail: `buyer-${suffix}@test.local`,
          buyerPhone: '+8801700000000',
          subtotalPaisa: subtotal,
          epsFeePaisa: 0n,
          platformFeePaisa: 0n,
          totalPaisa: subtotal,
          netToOrganiserPaisa: subtotal,
          platformFeeBps: 25,
          epsFeeBps: 250,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
          status,
        })
        .returning({ id: orders.id })

      const itemIds: string[] = []
      for (const sel of selections) {
        const [item] = await db
          .insert(orderItems)
          .values({
            tenantId: fx.tenantId,
            orderId: o!.id,
            ticketTierId: sel.tierId,
            quantity: sel.quantity,
            unitPricePaisa: 100_000n,
            subtotalPaisa: 100_000n * BigInt(sel.quantity),
          })
          .returning({ id: orderItems.id })
        itemIds.push(item!.id)
      }

      return { id: o!.id, orderItemIds: itemIds }
    })
  }

  describe('happy path — single tier, quantity 1', () => {
    it('generates exactly one attendees row with a 256-bit QR token', async () => {
      const order = await seedOrder('paid', 'happy-1', [{ tierId: fx.tierA, quantity: 1 }])

      const result = await generateAttendeesForOrder({ orderId: order.id })

      expect(result.kind).toBe('generated')
      if (result.kind !== 'generated') return
      expect(result.attendeeIds).toHaveLength(1)
      expect(result.qrTokens).toHaveLength(1)
      expect(result.qrTokens[0]).toMatch(/^[A-Za-z0-9_-]{43}$/)

      const rows = await withSuperAdmin((db) =>
        db.select().from(attendees).where(eq(attendees.orderId, order.id)),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.attendeeName).toBe('Test Buyer')
      expect(rows[0]!.attendeeEmail).toMatch(/^buyer-happy-1@/)
      expect(rows[0]!.qrCode).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(rows[0]!.tenantId).toBe(fx.tenantId)
      expect(rows[0]!.orderItemId).toBe(order.orderItemIds[0])
      expect(rows[0]!.ticketTierId).toBe(fx.tierA)
    })
  })

  describe('happy path — quantity > 1', () => {
    it('generates N attendee rows with "(Ticket N of M)" naming + N unique tokens', async () => {
      const order = await seedOrder('paid', 'happy-3', [{ tierId: fx.tierA, quantity: 3 }], {
        buyerName: 'Alice',
      })

      const result = await generateAttendeesForOrder({ orderId: order.id })
      expect(result.kind).toBe('generated')
      if (result.kind !== 'generated') return
      expect(result.attendeeIds).toHaveLength(3)

      const rows = await withSuperAdmin((db) =>
        db
          .select({ id: attendees.id, name: attendees.attendeeName, qr: attendees.qrCode })
          .from(attendees)
          .where(eq(attendees.orderId, order.id)),
      )
      expect(rows).toHaveLength(3)

      const names = rows.map((r) => r.name).sort()
      expect(names).toEqual([
        'Alice (Ticket 1 of 3)',
        'Alice (Ticket 2 of 3)',
        'Alice (Ticket 3 of 3)',
      ])

      // All QR tokens unique.
      const tokens = new Set(rows.map((r) => r.qr))
      expect(tokens.size).toBe(3)
    })
  })

  describe('multi-tier breakdown', () => {
    it('handles 2 tiers with mixed quantities (1 × tierA + 2 × tierB) → 3 attendees with correct tier breakdown', async () => {
      const order = await seedOrder('paid', 'multi', [
        { tierId: fx.tierA, quantity: 1 },
        { tierId: fx.tierB, quantity: 2 },
      ])

      const result = await generateAttendeesForOrder({ orderId: order.id })
      expect(result.kind).toBe('generated')
      if (result.kind !== 'generated') return
      expect(result.attendeeIds).toHaveLength(3)

      const rows = await withSuperAdmin((db) =>
        db
          .select({ tierId: attendees.ticketTierId })
          .from(attendees)
          .where(eq(attendees.orderId, order.id)),
      )

      const tierCounts = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.tierId] = (acc[r.tierId] ?? 0) + 1
        return acc
      }, {})
      expect(tierCounts[fx.tierA]).toBe(1)
      expect(tierCounts[fx.tierB]).toBe(2)
    })
  })

  describe('idempotency — re-invocation', () => {
    it('returns already_generated with existing attendee IDs; does not double-write', async () => {
      const order = await seedOrder('paid', 'idem', [{ tierId: fx.tierA, quantity: 2 }])

      const first = await generateAttendeesForOrder({ orderId: order.id })
      expect(first.kind).toBe('generated')
      if (first.kind !== 'generated') return
      const firstIds = first.attendeeIds.sort()

      // Re-invoke — must not create new rows.
      const second = await generateAttendeesForOrder({ orderId: order.id })
      expect(second.kind).toBe('already_generated')
      if (second.kind !== 'already_generated') return
      expect(second.attendeeIds.sort()).toEqual(firstIds)

      // DB confirms only 2 attendee rows exist (not 4).
      const count = await withSuperAdmin((db) =>
        db
          .select({ c: sql<number>`count(*)::int` })
          .from(attendees)
          .where(eq(attendees.orderId, order.id)),
      )
      expect(count[0]!.c).toBe(2)
    })

    it('the `order.attendees_generated` marker is written exactly once', async () => {
      const order = await seedOrder('paid', 'idem-marker', [{ tierId: fx.tierA, quantity: 1 }])

      await generateAttendeesForOrder({ orderId: order.id })
      await generateAttendeesForOrder({ orderId: order.id })
      await generateAttendeesForOrder({ orderId: order.id })

      const markers = await withSuperAdmin((db) =>
        db
          .select()
          .from(orderEvents)
          .where(
            sql`${orderEvents.orderId} = ${order.id} AND ${orderEvents.eventType} = 'order.attendees_generated'`,
          ),
      )
      expect(markers).toHaveLength(1)
    })
  })

  describe('eligibility guards', () => {
    it('order_not_paid: awaiting_payment status → no mutation', async () => {
      const order = await seedOrder('awaiting_payment', 'not-paid', [
        { tierId: fx.tierA, quantity: 1 },
      ])

      const result = await generateAttendeesForOrder({ orderId: order.id })
      expect(result.kind).toBe('order_not_paid')
      if (result.kind !== 'order_not_paid') return
      expect(result.currentStatus).toBe('awaiting_payment')

      const rows = await withSuperAdmin((db) =>
        db.select().from(attendees).where(eq(attendees.orderId, order.id)),
      )
      expect(rows).toHaveLength(0)
    })

    it('order_not_paid: failed status → no mutation', async () => {
      const order = await seedOrder('failed', 'failed-order', [{ tierId: fx.tierA, quantity: 1 }])

      const result = await generateAttendeesForOrder({ orderId: order.id })
      expect(result.kind).toBe('order_not_paid')

      const rows = await withSuperAdmin((db) =>
        db.select().from(attendees).where(eq(attendees.orderId, order.id)),
      )
      expect(rows).toHaveLength(0)
    })

    it('order_not_paid: cancelled status → no mutation', async () => {
      const order = await seedOrder('cancelled', 'cancelled-order', [
        { tierId: fx.tierA, quantity: 1 },
      ])

      const result = await generateAttendeesForOrder({ orderId: order.id })
      expect(result.kind).toBe('order_not_paid')
    })

    it('completed orders ARE eligible (resend scenario)', async () => {
      const order = await seedOrder('completed', 'completed-order', [
        { tierId: fx.tierA, quantity: 1 },
      ])

      const result = await generateAttendeesForOrder({ orderId: order.id })
      expect(result.kind).toBe('generated')
    })

    it('order_not_found: bogus uuid → no mutation', async () => {
      const result = await generateAttendeesForOrder({
        orderId: '00000000-0000-0000-0000-000000000000',
      })
      expect(result.kind).toBe('order_not_found')
    })
  })

  describe('audit trail', () => {
    it('writes audit_logs row + order_events marker in the same tx', async () => {
      const order = await seedOrder('paid', 'audit', [{ tierId: fx.tierA, quantity: 2 }])

      await generateAttendeesForOrder({ orderId: order.id })

      const audits = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            sql`${auditLogs.entityType} = 'order' AND ${auditLogs.entityId} = ${order.id} AND ${auditLogs.action} = 'order.attendees_generated'`,
          ),
      )
      expect(audits).toHaveLength(1)

      const diff = audits[0]!.diff as {
        attendee_count?: number
        tier_breakdown?: Record<string, number>
      }
      expect(diff.attendee_count).toBe(2)
      expect(diff.tier_breakdown?.[fx.tierA]).toBe(2)

      const markers = await withSuperAdmin((db) =>
        db
          .select()
          .from(orderEvents)
          .where(
            sql`${orderEvents.orderId} = ${order.id} AND ${orderEvents.eventType} = 'order.attendees_generated'`,
          ),
      )
      expect(markers).toHaveLength(1)
    })
  })
})
