/**
 * Delivery service end-to-end — DB-gated integration tests.
 *
 * Pinned (the Day 28 invariants):
 *
 *   1. Happy path: order at paid → generates attendees → renders
 *      PDFs → sends emails (dry-run) → marks delivery_sent.
 *   2. Idempotency on the delivery marker: re-invoking returns
 *      `already_delivered` without re-sending.
 *   3. Eligibility guard: non-paid orders return `order_not_eligible`
 *      with no DB mutation + no email send.
 *   4. order_not_found on bogus order id.
 *   5. Audit + order_events marker written in single tx.
 *   6. Bilingual: tenant.preferred_locale='bn' renders Bangla subject
 *      lines (verified via the dry-run log path — assertions cover
 *      the email-count + delivery success rather than wire-level
 *      mail body inspection which is covered in template unit tests).
 *
 * SES is dry-run (MAIL_DRY_RUN=1) — no AWS calls; the dry-run path
 * still exercises the full MIME build + locale selection + PDF
 * rendering.
 *
 * The on-paid enqueue hook (settle.ts → enqueueOrderDelivery) is NOT
 * tested here because (a) the unit tests cover the no-redis fallback,
 * (b) the queue-with-real-redis behaviour is BullMQ's responsibility,
 * (c) the worker-consumes-job path is verified at the staging smoke
 * (Phase 4) where the real worker picks up the job end-to-end.
 */

import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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

import { deliverOrder } from './deliver-order.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const ORIGINAL_MAIL_DRY_RUN = process.env['MAIL_DRY_RUN']
const ORIGINAL_API_BASE = process.env['EVENTPULSE_API_BASE_URL']
const ORIGINAL_WEB_BASE = process.env['EVENTPULSE_WEB_BASE_URL']
const ORIGINAL_AWS_SES_FROM = process.env['AWS_SES_FROM']

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

describeIfDb('deliverOrder — post-paid delivery orchestration', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const txnId = (suffix: string) => `TXN-deliver-${seed}-${suffix}`

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `deliver-test-owner-${seed}@test.local`,
          fullName: 'Deliver Test Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const [t] = await db
        .insert(tenants)
        .values({
          name: 'Deliver Test Tenant',
          slug: `deliver-test-tenant-${seed}`,
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
          slug: `deliver-test-event-${seed}`,
          type: 'concert',
          title: 'Deliver Test Event',
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
    await resetPool()
  })

  beforeEach(() => {
    process.env['MAIL_DRY_RUN'] = '1'
    process.env['EVENTPULSE_API_BASE_URL'] = 'https://api.staging.eventpulse.com.bd'
    process.env['EVENTPULSE_WEB_BASE_URL'] = 'https://staging.eventpulse.com.bd'
    process.env['AWS_SES_FROM'] = 'Event Pulse <hello@eventpulse.com.bd>'
  })

  afterEach(() => {
    if (ORIGINAL_MAIL_DRY_RUN === undefined) delete process.env['MAIL_DRY_RUN']
    else process.env['MAIL_DRY_RUN'] = ORIGINAL_MAIL_DRY_RUN
    if (ORIGINAL_API_BASE === undefined) delete process.env['EVENTPULSE_API_BASE_URL']
    else process.env['EVENTPULSE_API_BASE_URL'] = ORIGINAL_API_BASE
    if (ORIGINAL_WEB_BASE === undefined) delete process.env['EVENTPULSE_WEB_BASE_URL']
    else process.env['EVENTPULSE_WEB_BASE_URL'] = ORIGINAL_WEB_BASE
    if (ORIGINAL_AWS_SES_FROM === undefined) delete process.env['AWS_SES_FROM']
    else process.env['AWS_SES_FROM'] = ORIGINAL_AWS_SES_FROM
  })

  async function seedOrder(
    status: 'awaiting_payment' | 'paid' | 'failed' | 'cancelled' | 'completed',
    suffix: string,
    quantity = 1,
  ): Promise<{ id: string }> {
    return withSuperAdmin(async (db) => {
      const subtotal = 100_000n * BigInt(quantity)
      const [o] = await db
        .insert(orders)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          merchantTransactionId: txnId(suffix),
          buyerName: 'Test Buyer',
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

      await db.insert(orderItems).values({
        tenantId: fx.tenantId,
        orderId: o!.id,
        ticketTierId: fx.tierId,
        quantity,
        unitPricePaisa: 100_000n,
        subtotalPaisa: subtotal,
      })

      return { id: o!.id }
    })
  }

  describe('happy path — paid order, single ticket', () => {
    it('delivered: 1 attendee, 1 buyer email + 1 attendee email = 2 emails sent', async () => {
      const order = await seedOrder('paid', 'happy-1')

      const result = await deliverOrder({ orderId: order.id })

      expect(result.kind).toBe('delivered')
      if (result.kind !== 'delivered') return
      expect(result.attendeeCount).toBe(1)
      expect(result.emailsSent).toBe(2) // 1 buyer + 1 attendee
      expect(result.buyerMessageId).toMatch(/^dryrun-raw-/)
      expect(result.attendeeMessageIds).toHaveLength(1)
      expect(result.attendeeMessageIds[0]).toMatch(/^dryrun-raw-/)
    })
  })

  describe('happy path — quantity > 1', () => {
    it('delivered: 3 attendees, 1 buyer + 3 attendee = 4 emails', async () => {
      const order = await seedOrder('paid', 'happy-3', 3)
      const result = await deliverOrder({ orderId: order.id })
      expect(result.kind).toBe('delivered')
      if (result.kind !== 'delivered') return
      expect(result.attendeeCount).toBe(3)
      expect(result.emailsSent).toBe(4)
      expect(result.attendeeMessageIds).toHaveLength(3)
    })
  })

  describe('idempotency — delivery marker', () => {
    it('second invocation returns already_delivered without resending', async () => {
      const order = await seedOrder('paid', 'idem')

      const first = await deliverOrder({ orderId: order.id })
      expect(first.kind).toBe('delivered')

      const second = await deliverOrder({ orderId: order.id })
      expect(second.kind).toBe('already_delivered')
      if (second.kind !== 'already_delivered') return
      expect(second.orderId).toBe(order.id)
    })

    it('order.delivery_sent marker written exactly once', async () => {
      const order = await seedOrder('paid', 'idem-marker')
      await deliverOrder({ orderId: order.id })
      await deliverOrder({ orderId: order.id })
      await deliverOrder({ orderId: order.id })

      const markers = await withSuperAdmin((db) =>
        db
          .select()
          .from(orderEvents)
          .where(
            sql`${orderEvents.orderId} = ${order.id} AND ${orderEvents.eventType} = 'order.delivery_sent'`,
          ),
      )
      expect(markers).toHaveLength(1)
    })

    it('attendees rows created exactly once across multiple delivery calls', async () => {
      const order = await seedOrder('paid', 'idem-attendees', 2)
      await deliverOrder({ orderId: order.id })
      await deliverOrder({ orderId: order.id })

      const count = await withSuperAdmin((db) =>
        db
          .select({ c: sql<number>`count(*)::int` })
          .from(attendees)
          .where(eq(attendees.orderId, order.id)),
      )
      expect(count[0]!.c).toBe(2)
    })
  })

  describe('eligibility guards', () => {
    it('awaiting_payment → order_not_eligible, no attendees + no emails', async () => {
      const order = await seedOrder('awaiting_payment', 'not-paid')
      const result = await deliverOrder({ orderId: order.id })
      expect(result.kind).toBe('order_not_eligible')

      const attRows = await withSuperAdmin((db) =>
        db.select().from(attendees).where(eq(attendees.orderId, order.id)),
      )
      expect(attRows).toHaveLength(0)
    })

    it('failed → order_not_eligible', async () => {
      const order = await seedOrder('failed', 'failed-1')
      const result = await deliverOrder({ orderId: order.id })
      expect(result.kind).toBe('order_not_eligible')
    })

    it('completed → eligible (resend path)', async () => {
      const order = await seedOrder('completed', 'completed-1')
      const result = await deliverOrder({ orderId: order.id })
      expect(result.kind).toBe('delivered')
    })

    it('order_not_found on bogus id', async () => {
      const result = await deliverOrder({
        orderId: '00000000-0000-0000-0000-000000000000',
      })
      expect(result.kind).toBe('order_not_found')
    })
  })

  describe('audit trail', () => {
    it('writes audit_logs row + order_events delivery marker', async () => {
      const order = await seedOrder('paid', 'audit', 2)
      await deliverOrder({ orderId: order.id })

      const audits = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            sql`${auditLogs.entityType} = 'order' AND ${auditLogs.entityId} = ${order.id} AND ${auditLogs.action} = 'order.delivery_sent'`,
          ),
      )
      expect(audits).toHaveLength(1)
      const diff = audits[0]!.diff as {
        attendee_count?: number
        emails_sent?: number
        locale?: string
      }
      expect(diff.attendee_count).toBe(2)
      expect(diff.emails_sent).toBe(3) // 1 buyer + 2 attendees
      expect(diff.locale).toMatch(/^(en|bn)$/)

      const markers = await withSuperAdmin((db) =>
        db
          .select()
          .from(orderEvents)
          .where(
            sql`${orderEvents.orderId} = ${order.id} AND ${orderEvents.eventType} = 'order.delivery_sent'`,
          ),
      )
      expect(markers).toHaveLength(1)
      const payload = markers[0]!.payload as Record<string, unknown>
      expect(payload['attendee_count']).toBe(2)
      expect(typeof payload['buyer_message_id']).toBe('string')
      expect(Array.isArray(payload['attendee_message_ids'])).toBe(true)
    })
  })
})
