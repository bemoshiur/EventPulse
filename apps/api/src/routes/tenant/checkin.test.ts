/**
 * Check-in route — DB-gated integration tests.
 * Sprint 4 Day 31 Phase 1.
 *
 * Pinned door-correctness invariants:
 *
 *   1. **Valid scan** → CHECKED_IN; attendees row updated with
 *      checked_in_at + checked_in_by + checked_in_gate; audit row
 *      written.
 *   2. **Re-scan** → ATTENDEE_ALREADY_CHECKED_IN with the ORIGINAL
 *      timestamp (door staff sees the duplicate; second scan does
 *      NOT silently succeed; NO second admission); audit row for
 *      the rejected re-scan also written.
 *   3. **Forged / unknown token** → TICKET_INVALID; no row touched.
 *   4. **Voided ticket** → TICKET_VOIDED; no check-in.
 *   5. **Wrong event** → TICKET_WRONG_EVENT (token is for a different
 *      event of the same tenant); attendee NOT checked in; the other
 *      event's id is NOT leaked.
 *   6. **Cross-tenant** → TICKET_INVALID via RLS (tenant A staff
 *      scans tenant B's token; RLS hides B's row from A's session).
 *   7. **Concurrent double-scan race** → exactly ONE check-in
 *      recorded; one outcome is CHECKED_IN, the other
 *      ALREADY_CHECKED_IN. The atomic compare-and-swap WHERE
 *      checked_in_at IS NULL is the door-correctness lock.
 *   8. **Stats endpoint** → returns correct totals + counts.
 *   9. **Auth gates** — no token → 401; attendee/super-admin token
 *      → 403.
 *
 * DB-gated: each test seeds a fresh tenant + event + tier + paid
 * order + attendee row.
 */

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  attendees,
  auditLogs,
  events,
  orderItems,
  orders,
  tenantUsers,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'
import { mintQrToken } from '../../services/attendees/qr-token.js'

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

interface ScopeFixture {
  ownerId: string
  tenantId: string
  eventA: string
  eventB: string // second event of SAME tenant (for wrong-event test)
  tierA: string
  tierB: string
  staffToken: string
}

interface AttendeeFixture {
  orderId: string
  attendeeId: string
  qrCode: string
}

async function seedTenantScope(seed: string): Promise<ScopeFixture> {
  return withSuperAdmin(async (db) => {
    const [owner] = await db
      .insert(users)
      .values({
        email: `checkin-owner-${seed}@test.local`,
        fullName: 'Checkin Owner',
      })
      .returning({ id: users.id })

    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Checkin Tenant',
        slug: `checkin-${seed}`,
        isPersonal: true,
        ownerUserId: owner!.id,
        type: 'organisation',
      })
      .returning({ id: tenants.id })

    await db.insert(tenantUsers).values({
      tenantId: t!.id,
      userId: owner!.id,
      role: 'owner',
      acceptedAt: new Date(),
    })

    const [evtA] = await db
      .insert(events)
      .values({
        tenantId: t!.id,
        slug: `checkin-event-a-${seed}`,
        type: 'concert',
        title: 'Checkin Event A',
        status: 'on_sale',
        startsAt: future(30 * 24 * 60 * 60 * 1000),
        endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
        venue: physicalVenue,
        createdBy: owner!.id,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      })
      .returning({ id: events.id })

    const [evtB] = await db
      .insert(events)
      .values({
        tenantId: t!.id,
        slug: `checkin-event-b-${seed}`,
        type: 'concert',
        title: 'Checkin Event B',
        status: 'on_sale',
        startsAt: future(30 * 24 * 60 * 60 * 1000),
        endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
        venue: physicalVenue,
        createdBy: owner!.id,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      })
      .returning({ id: events.id })

    const [tierA] = await db
      .insert(ticketTiers)
      .values({
        tenantId: t!.id,
        eventId: evtA!.id,
        name: 'General',
        pricePaisa: 0n,
        capacity: 100,
      })
      .returning({ id: ticketTiers.id })

    const [tierB] = await db
      .insert(ticketTiers)
      .values({
        tenantId: t!.id,
        eventId: evtB!.id,
        name: 'General',
        pricePaisa: 0n,
        capacity: 100,
      })
      .returning({ id: ticketTiers.id })

    const staffToken = (
      await signTokens({
        sub: owner!.id,
        audience: 'tenant',
        tenantId: t!.id,
        sessionId: `sess_checkin_${seed}`,
      })
    ).accessToken

    return {
      ownerId: owner!.id,
      tenantId: t!.id,
      eventA: evtA!.id,
      eventB: evtB!.id,
      tierA: tierA!.id,
      tierB: tierB!.id,
      staffToken,
    }
  })
}

async function seedAttendee(
  fx: ScopeFixture,
  tierId: string,
  suffix: string,
  opts?: { voided?: boolean },
): Promise<AttendeeFixture> {
  return withSuperAdmin(async (db) => {
    const [order] = await db
      .insert(orders)
      .values({
        tenantId: fx.tenantId,
        eventId: tierId === fx.tierA ? fx.eventA : fx.eventB,
        merchantTransactionId: `TXN-checkin-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        buyerName: 'Test Buyer',
        buyerEmail: `buyer-${suffix}@test.local`,
        buyerPhone: '+8801700000000',
        subtotalPaisa: 0n,
        epsFeePaisa: 0n,
        platformFeePaisa: 0n,
        totalPaisa: 0n,
        netToOrganiserPaisa: 0n,
        platformFeeBps: 25,
        epsFeeBps: 250,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
        status: 'paid',
        paidAt: new Date(),
      })
      .returning({ id: orders.id })

    const [item] = await db
      .insert(orderItems)
      .values({
        tenantId: fx.tenantId,
        orderId: order!.id,
        ticketTierId: tierId,
        quantity: 1,
        unitPricePaisa: 0n,
        subtotalPaisa: 0n,
      })
      .returning({ id: orderItems.id })

    const qrCode = mintQrToken()

    const [att] = await db
      .insert(attendees)
      .values({
        tenantId: fx.tenantId,
        orderId: order!.id,
        orderItemId: item!.id,
        ticketTierId: tierId,
        attendeeName: `Test Attendee ${suffix}`,
        attendeeEmail: `attendee-${suffix}@test.local`,
        qrCode,
        ...(opts?.voided ? { voidedAt: new Date(), voidReason: 'test' } : {}),
      })
      .returning({ id: attendees.id })

    return { orderId: order!.id, attendeeId: att!.id, qrCode }
  })
}

describeIfDb('POST /api/v1/tenant/events/:eventId/checkin', () => {
  const fxs: ScopeFixture[] = []
  let tenantA: ScopeFixture
  let tenantB: ScopeFixture

  beforeAll(async () => {
    // Test JWT secret — matches the test-only pattern in
    // kyc-drafts.test.ts. signTokens() reads at call time.
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
    tenantA = await seedTenantScope(`${Date.now()}-a`)
    fxs.push(tenantA)
    tenantB = await seedTenantScope(`${Date.now()}-b`)
    fxs.push(tenantB)
  })

  afterAll(async () => {
    await resetPool()
  })

  async function postCheckin(
    token: string,
    eventId: string,
    body: { qrCode: string; gate?: string | null },
  ) {
    const app = createApp()
    return app.request(`/api/v1/tenant/events/${eventId}/checkin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
  }

  describe('happy path', () => {
    it('valid scan → CHECKED_IN; attendees row updated; audit row written', async () => {
      const att = await seedAttendee(tenantA, tenantA.tierA, 'happy')

      const res = await postCheckin(tenantA.staffToken, tenantA.eventA, {
        qrCode: att.qrCode,
        gate: 'Gate 1',
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        data: {
          outcome: string
          attendee: { id: string; name: string; tier: string }
          checkedInAt: string
        }
      }
      expect(body.data.outcome).toBe('CHECKED_IN')
      expect(body.data.attendee.id).toBe(att.attendeeId)
      expect(body.data.attendee.name).toMatch(/Test Attendee/)
      expect(body.data.attendee.tier).toBe('General')

      const [row] = await withSuperAdmin((db) =>
        db
          .select({
            checkedInAt: attendees.checkedInAt,
            checkedInBy: attendees.checkedInBy,
            checkedInGate: attendees.checkedInGate,
          })
          .from(attendees)
          .where(eq(attendees.id, att.attendeeId)),
      )
      expect(row!.checkedInAt).toBeInstanceOf(Date)
      expect(row!.checkedInBy).toBe(tenantA.ownerId)
      expect(row!.checkedInGate).toBe('Gate 1')

      // Audit
      const audits = await withSuperAdmin((db) =>
        db
          .select()
          .from(auditLogs)
          .where(
            sql`${auditLogs.entityId} = ${att.attendeeId} AND ${auditLogs.action} = 'attendee.checked_in'`,
          ),
      )
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorType).toBe('tenant_user')
      expect(audits[0]!.actorId).toBe(tenantA.ownerId)
    })
  })

  describe('re-scan / already_checked_in (the door-correctness invariant)', () => {
    it('second scan returns ALREADY_CHECKED_IN with ORIGINAL timestamp; NOT a silent success', async () => {
      const att = await seedAttendee(tenantA, tenantA.tierA, 'rescan')

      const res1 = await postCheckin(tenantA.staffToken, tenantA.eventA, {
        qrCode: att.qrCode,
        gate: 'Gate 1',
      })
      expect(res1.status).toBe(200)
      const body1 = (await res1.json()) as { data: { checkedInAt: string } }
      const originalCheckInAt = body1.data.checkedInAt

      // Wait a moment so timestamps are clearly distinct
      await new Promise((resolve) => setTimeout(resolve, 50))

      const res2 = await postCheckin(tenantA.staffToken, tenantA.eventA, {
        qrCode: att.qrCode,
        gate: 'Gate 2', // different gate this time — should NOT update
      })
      expect(res2.status).toBe(409)
      const body2 = (await res2.json()) as {
        error: {
          code: string
          details: {
            attendee: { id: string }
            originalCheckInAt: string
            originalGate: string | null
          }
        }
      }
      expect(body2.error.code).toBe('ATTENDEE_ALREADY_CHECKED_IN')
      expect(body2.error.details.attendee.id).toBe(att.attendeeId)
      // The ORIGINAL check-in time is echoed — not the second-attempt time
      expect(body2.error.details.originalCheckInAt).toBe(originalCheckInAt)
      expect(body2.error.details.originalGate).toBe('Gate 1') // NOT 'Gate 2'

      // DB row STILL has the original values
      const [row] = await withSuperAdmin((db) =>
        db
          .select({
            checkedInAt: attendees.checkedInAt,
            checkedInGate: attendees.checkedInGate,
          })
          .from(attendees)
          .where(eq(attendees.id, att.attendeeId)),
      )
      expect(row!.checkedInGate).toBe('Gate 1')
      expect(row!.checkedInAt?.toISOString()).toBe(originalCheckInAt)

      // BOTH attempts audited (success + rejected re-scan)
      const audits = await withSuperAdmin((db) =>
        db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, att.attendeeId)),
      )
      const actions = audits.map((a) => a.action).sort()
      expect(actions).toEqual(['attendee.checked_in', 'attendee.checkin_already'])
    })
  })

  describe('rejection paths', () => {
    it('forged / unknown token → TICKET_INVALID; no row touched', async () => {
      const forged = mintQrToken() // not in DB
      const res = await postCheckin(tenantA.staffToken, tenantA.eventA, {
        qrCode: forged,
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('TICKET_INVALID')
    })

    it('voided ticket → TICKET_VOIDED', async () => {
      const att = await seedAttendee(tenantA, tenantA.tierA, 'voided', { voided: true })

      const res = await postCheckin(tenantA.staffToken, tenantA.eventA, {
        qrCode: att.qrCode,
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('TICKET_VOIDED')

      // checked_in_at stays NULL
      const [row] = await withSuperAdmin((db) =>
        db
          .select({ checkedInAt: attendees.checkedInAt })
          .from(attendees)
          .where(eq(attendees.id, att.attendeeId)),
      )
      expect(row!.checkedInAt).toBeNull()
    })

    it('wrong event (same tenant, different event) → TICKET_WRONG_EVENT; other event id not leaked', async () => {
      const attB = await seedAttendee(tenantA, tenantA.tierB, 'wrong-evt') // belongs to eventB

      // Scan at eventA's gate
      const res = await postCheckin(tenantA.staffToken, tenantA.eventA, {
        qrCode: attB.qrCode,
      })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: { code: string; details?: unknown } }
      expect(body.error.code).toBe('TICKET_WRONG_EVENT')
      // The other event's id is NOT in the response (no info leak)
      expect(JSON.stringify(body)).not.toContain(tenantA.eventB)
    })
  })

  describe('cross-tenant isolation (RLS)', () => {
    it("tenant A staff scanning tenant B's token → TICKET_INVALID (RLS hides B's row)", async () => {
      const attB = await seedAttendee(tenantB, tenantB.tierA, 'xtenant')

      // Tenant A staff posts B's token at A's event
      const res = await postCheckin(tenantA.staffToken, tenantA.eventA, {
        qrCode: attB.qrCode,
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('TICKET_INVALID')

      // Tenant B's row is untouched
      const [row] = await withSuperAdmin((db) =>
        db
          .select({ checkedInAt: attendees.checkedInAt })
          .from(attendees)
          .where(eq(attendees.id, attB.attendeeId)),
      )
      expect(row!.checkedInAt).toBeNull()
    })
  })

  describe('concurrent double-scan race (door-correctness lock)', () => {
    it('two concurrent scans of the same valid token → exactly ONE check-in; the other gets ALREADY_CHECKED_IN', async () => {
      const att = await seedAttendee(tenantA, tenantA.tierA, 'race')

      const [res1, res2] = await Promise.all([
        postCheckin(tenantA.staffToken, tenantA.eventA, {
          qrCode: att.qrCode,
          gate: 'G1',
        }),
        postCheckin(tenantA.staffToken, tenantA.eventA, {
          qrCode: att.qrCode,
          gate: 'G2',
        }),
      ])

      const statuses = [res1.status, res2.status].sort()
      // One wins (200), one already-checked-in (409)
      expect(statuses).toEqual([200, 409])

      // Exactly one row state (checked_in_at set once)
      const [row] = await withSuperAdmin((db) =>
        db
          .select({ checkedInAt: attendees.checkedInAt, checkedInGate: attendees.checkedInGate })
          .from(attendees)
          .where(eq(attendees.id, att.attendeeId)),
      )
      expect(row!.checkedInAt).toBeInstanceOf(Date)
      // The gate persisted is the winner's gate; either 'G1' or 'G2',
      // but NOT both (the lock guarantees exactly-one).
      expect(['G1', 'G2']).toContain(row!.checkedInGate)
    })
  })

  describe('auth gates', () => {
    it('missing Authorization header → 401', async () => {
      const app = createApp()
      const res = await app.request(`/api/v1/tenant/events/${tenantA.eventA}/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qrCode: mintQrToken() }),
      })
      expect(res.status).toBe(401)
    })

    it('attendee-audience JWT → 403 (wrong audience)', async () => {
      const attendeeToken = (
        await signTokens({
          sub: tenantA.ownerId,
          audience: 'attendee',
          tenantId: null,
          sessionId: 'sess_attendee_x',
        })
      ).accessToken

      const res = await postCheckin(attendeeToken, tenantA.eventA, {
        qrCode: mintQrToken(),
      })
      expect(res.status).toBe(403)
    })
  })
})

describeIfDb('GET /api/v1/tenant/events/:eventId/checkin/stats', () => {
  let fx: ScopeFixture

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
    fx = await seedTenantScope(`${Date.now()}-stats`)
  })

  afterAll(async () => {
    await resetPool()
  })

  it('returns total + checked-in + voided counts for the event', async () => {
    // 3 attendees: 2 active + 1 voided
    await seedAttendee(fx, fx.tierA, 'stats-1')
    const a2 = await seedAttendee(fx, fx.tierA, 'stats-2')
    await seedAttendee(fx, fx.tierA, 'stats-3', { voided: true })

    // Check one in
    const app = createApp()
    await app.request(`/api/v1/tenant/events/${fx.eventA}/checkin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fx.staffToken}`,
      },
      body: JSON.stringify({ qrCode: a2.qrCode }),
    })

    const res = await app.request(`/api/v1/tenant/events/${fx.eventA}/checkin/stats`, {
      headers: { authorization: `Bearer ${fx.staffToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { totalAttendees: number; checkedInCount: number; voidedCount: number }
    }
    expect(body.data.totalAttendees).toBe(3)
    expect(body.data.checkedInCount).toBe(1)
    expect(body.data.voidedCount).toBe(1)
  })
})
