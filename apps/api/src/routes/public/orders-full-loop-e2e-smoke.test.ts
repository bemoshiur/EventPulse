/**
 * Full free-event operational loop E2E smoke — Sprint 4 Day 34 Phase 2.
 *
 * ════════════════════════════════════════════════════════════════════
 * The satisfying loop-closure across Days 25-33
 * ════════════════════════════════════════════════════════════════════
 *
 * The Day-30 buyer-journey smoke proved POST /orders → order born-paid
 * → delivery enqueued at the HTTP+DB+middleware layer. This test
 * proves the full operational loop the platform now supports:
 *
 *   1. Buyer flow: POST /api/v1/public/orders (the same path the
 *      Day-34 Phase-1 BuyerForm posts to) → free order born-paid.
 *   2. Delivery: invoke deliverOrder() synchronously (the worker's
 *      single-job entry point) to materialise the attendees row +
 *      QR token. MAIL_DRY_RUN=1 keeps SES out of the loop.
 *   3. Tenant view (Day 32): GET /api/v1/tenant/events/:id/attendees
 *      → the new attendee appears, name + email match the buyer.
 *   4. Check-in (Day 31): POST /api/v1/tenant/events/:id/checkin with
 *      the QR token → success; attendee.checkedInAt set.
 *   5. Sales dashboard (Day 33): GET /api/v1/tenant/reports/sales →
 *      the sale appears in paidOrderCount + ticket count even for a
 *      free order (the dashboard counts paid orders, not revenue).
 *
 * This is the FULL surface a Moshiur browser walkthrough would touch
 * for a free event. The buyer-form UI itself is proven by the Day-34
 * Phase-1 component tests; the post-order pipeline is proven here.
 *
 * ════════════════════════════════════════════════════════════════════
 * Why synchronous deliverOrder() instead of waiting on the worker
 * ════════════════════════════════════════════════════════════════════
 *
 * The delivery worker (apps/api/src/workers/delivery-worker.ts) starts
 * in apps/api/src/index.ts, NOT in createApp(). The test boots only
 * the Hono app — there is no running BullMQ worker consuming the
 * queue. Awaiting attendee materialisation would hang indefinitely.
 *
 * Invoking deliverOrder() directly is what the running worker does
 * per job; the unit-test path for the worker logic already exists
 * (delivery-queue.test + the per-service tests). Calling it
 * synchronously here is the e2e equivalent of "the worker processed
 * the queue", without the worker process orchestration.
 *
 * ════════════════════════════════════════════════════════════════════
 * Payment independence
 * ════════════════════════════════════════════════════════════════════
 *
 * STAGING_PAYMENT_BLOCK stays on throughout. The free-event path
 * never calls EPS (§13.5 born-paid bypass). MAIL_DRY_RUN=1 keeps
 * SES out. Zero outbound network in this test.
 */

import { eq } from 'drizzle-orm'
import RedisMock from 'ioredis-mock'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { signTokens } from '../../auth/jwt.js'
import { createApp } from '../../app.js'
import { resetPool, withSuperAdmin } from '../../db/client.js'
import { attendees, events, tenants, ticketTiers, users } from '../../db/schema/index.js'
import { _setRedisClientForTest } from '../../infra/redis/client.js'
import { deliverOrder } from '../../services/tickets/deliver-order.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const ORIGINAL_BLOCK = process.env['STAGING_PAYMENT_BLOCK']
const ORIGINAL_REDIS_URL = process.env['REDIS_URL']
const ORIGINAL_MAIL_DRY_RUN = process.env['MAIL_DRY_RUN']
const ORIGINAL_JWT_ACCESS = process.env['JWT_ACCESS_SECRET']
const ORIGINAL_JWT_REFRESH = process.env['JWT_REFRESH_SECRET']

const physicalVenue = {
  type: 'physical' as const,
  name: 'Loop Smoke Venue',
  address: '99 Loop Road',
  division: 'dhaka' as const,
  district: 'Dhaka',
}
const future = (offsetMs: number) => new Date(Date.now() + offsetMs)

interface Fixture {
  ownerId: string
  tenantId: string
  eventId: string
  tierId: string
  staffToken: string
}

describeIfDb('E2E full-loop smoke — buyer form path → attendee → check-in → dashboard', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  beforeAll(async () => {
    // Invariants that hold for the duration of this test.
    process.env['STAGING_PAYMENT_BLOCK'] = '1' // free-event path doesn't touch EPS, but the rest of staging needs it.
    process.env['MAIL_DRY_RUN'] = '1' // SES out of the loop.
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)

    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `loop-smoke-${seed}@test.local`,
          fullName: 'Loop Smoke Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const [t] = await db
        .insert(tenants)
        .values({
          name: 'Loop Smoke Tenant',
          slug: `loop-smoke-${seed}`,
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
          slug: `loop-event-${seed}`,
          type: 'community',
          title: 'Loop Smoke Free Talk',
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
          name: 'RSVP — Free',
          pricePaisa: 0n,
          capacity: 100,
        })
        .returning({ id: ticketTiers.id })
      fx.tierId = tier!.id
    })

    // Tenant-owner-role JWT for the tenant-side requests (steps 3-5).
    fx.staffToken = (
      await signTokens({
        sub: fx.ownerId,
        audience: 'tenant',
        tenantId: fx.tenantId,
        sessionId: `sess_loop_smoke_${seed}`,
      })
    ).accessToken
  })

  afterAll(async () => {
    if (ORIGINAL_BLOCK === undefined) delete process.env['STAGING_PAYMENT_BLOCK']
    else process.env['STAGING_PAYMENT_BLOCK'] = ORIGINAL_BLOCK
    if (ORIGINAL_REDIS_URL === undefined) delete process.env['REDIS_URL']
    else process.env['REDIS_URL'] = ORIGINAL_REDIS_URL
    if (ORIGINAL_MAIL_DRY_RUN === undefined) delete process.env['MAIL_DRY_RUN']
    else process.env['MAIL_DRY_RUN'] = ORIGINAL_MAIL_DRY_RUN
    if (ORIGINAL_JWT_ACCESS === undefined) delete process.env['JWT_ACCESS_SECRET']
    else process.env['JWT_ACCESS_SECRET'] = ORIGINAL_JWT_ACCESS
    if (ORIGINAL_JWT_REFRESH === undefined) delete process.env['JWT_REFRESH_SECRET']
    else process.env['JWT_REFRESH_SECRET'] = ORIGINAL_JWT_REFRESH
    _setRedisClientForTest(null)
    await resetPool()
  })

  beforeEach(() => {
    // Idempotency middleware needs Redis; mock it in-process.
    process.env['REDIS_URL'] = 'redis://mock-for-loop-smoke'
    _setRedisClientForTest(new RedisMock() as unknown as import('ioredis').Redis)
  })

  it('FULL LOOP: buyer-form POST → order born-paid → attendee → check-in → dashboard', async () => {
    const app = createApp()
    const idempotencyKey = `loop-smoke-${seed}-fullloop`
    const buyerName = 'Tahmina Rahman'
    const buyerEmail = `tahmina-${seed}@example.com`

    // ───── STEP 1: buyer form POSTs the order (Day-34 Phase-1 form path) ─────
    const res = await app.request('/api/v1/public/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.tierId, quantity: 1 }],
        buyer: { name: buyerName, email: buyerEmail, phone: '+8801710000034' },
      }),
    })
    expect(res.status).toBe(201)
    const orderBody = (await res.json()) as {
      data: {
        orderId: string
        status: 'paid' | 'awaiting_payment'
        paymentInitState: 'free' | 'ready' | 'blocked'
      }
    }
    // Free path — confirmed.
    expect(orderBody.data.status).toBe('paid')
    expect(orderBody.data.paymentInitState).toBe('free')
    const orderId = orderBody.data.orderId

    // ───── STEP 2: delivery materialises the attendee (worker entry point) ─────
    const deliveryResult = await deliverOrder({ orderId })
    // The worker's outcome union includes 'delivered' for the success path.
    // For free orders, the path is: attendees generated + email dry-run.
    expect(['delivered', 'already_delivered']).toContain(deliveryResult.kind)

    // ───── STEP 3 (Day 32): tenant attendees list shows the new attendee ─────
    const attRes = await app.request(`/api/v1/tenant/events/${fx.eventId}/attendees`, {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.staffToken}` },
    })
    expect(attRes.status).toBe(200)
    const attBody = (await attRes.json()) as {
      data: Array<{
        id: string
        attendeeName: string
        attendeeEmail: string | null
        tierId: string
        orderId: string
        checkedInAt: string | null
      }>
    }
    const ourAttendee = attBody.data.find((a) => a.attendeeEmail === buyerEmail)
    expect(ourAttendee, 'attendee should appear in tenant list after delivery').toBeDefined()
    expect(ourAttendee!.attendeeName).toContain('Tahmina Rahman')
    expect(ourAttendee!.checkedInAt).toBeNull() // not yet checked in
    expect(ourAttendee!.orderId).toBe(orderId)

    // QR code is deliberately NOT in the list response (security — listing
    // is a browse surface, not a scan surface). Read it directly from the
    // attendees row for the next step (the scanner UI reads it from a
    // physically-scanned QR in production).
    const [attendeeRowWithQr] = await withSuperAdmin((db) =>
      db
        .select({ qrCode: attendees.qrCode })
        .from(attendees)
        .where(eq(attendees.id, ourAttendee!.id)),
    )
    const qrCode = attendeeRowWithQr!.qrCode
    expect(qrCode).toBeTruthy()

    // ───── STEP 4 (Day 31): scanner check-in via QR token ─────
    const ciRes = await app.request(`/api/v1/tenant/events/${fx.eventId}/checkin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fx.staffToken}`,
      },
      body: JSON.stringify({ qrCode, gate: 'main' }),
    })
    expect(ciRes.status).toBe(200)
    const ciBody = (await ciRes.json()) as {
      data: { outcome: string; attendee: { id: string }; checkedInAt: string }
    }
    expect(ciBody.data.outcome).toBe('CHECKED_IN')
    expect(ciBody.data.attendee.id).toBe(ourAttendee!.id)
    expect(ciBody.data.checkedInAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Verify the attendees row was actually updated.
    const [attRow] = await withSuperAdmin((db) =>
      db
        .select({ checkedInAt: attendees.checkedInAt, voidedAt: attendees.voidedAt })
        .from(attendees)
        .where(eq(attendees.id, ourAttendee!.id)),
    )
    expect(attRow!.checkedInAt).toBeInstanceOf(Date)
    expect(attRow!.voidedAt).toBeNull()

    // ───── STEP 5 (Day 33): the sale shows in the tenant sales dashboard ─────
    const repRes = await app.request('/api/v1/tenant/reports/sales', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.staffToken}` },
    })
    expect(repRes.status).toBe(200)
    const repBody = (await repRes.json()) as {
      data: {
        headline: {
          grossRevenuePaisa: string
          paidOrderCount: number
        }
      }
    }
    // Free event: gross is 0 paisa, but paidOrderCount ticks. The "paid"
    // bucket on the headline includes paid + completed orders per §26.1
    // Day-33 service collapse policy (Decision A); a born-paid free order
    // is paid from t=0 and counts here.
    expect(repBody.data.headline.grossRevenuePaisa).toBe('0')
    expect(repBody.data.headline.paidOrderCount).toBeGreaterThanOrEqual(1)
  })
})
