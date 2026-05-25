/**
 * Tenant attendee list route — DB-gated integration tests.
 * Sprint 4 Day 32 Phase 1.
 *
 * Pinned security + correctness invariants:
 *
 *   1. **Cross-tenant isolation (THE security property).** Tenant A
 *      staff requesting tenant B's event's attendees → empty result.
 *      A data-leak here would be a breach.
 *   2. **Auth gate.** No token → 401.
 *   3. **Happy path — list returns own attendees** with the expected
 *      shape (id, name, email, phone, tier, order status, check-in
 *      status, etc.).
 *   4. **Search.** ?search= filters by name OR email (case-insensitive).
 *   5. **Filter — tier.** ?tierId= filters to one tier.
 *   6. **Filter — check-in.** ?checkIn=checked_in / not_checked_in.
 *   7. **Filter — order status.** ?orderStatus=paid only returns paid.
 *   8. **Cursor pagination.** Two pages of attendees with limit=N
 *      returns N + nextCursor + hasMore; second page returns the rest.
 *   9. **NO per-row audit** on list reads (Decision G precedent).
 *      A list request does NOT write audit_logs rows per attendee.
 */

import { count, sql } from 'drizzle-orm'
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
  eventId: string
  // Two tiers so the tier filter can discriminate.
  tierGA: string
  tierVIP: string
  staffToken: string
}

async function seedTenantScope(seed: string): Promise<ScopeFixture> {
  return withSuperAdmin(async (db) => {
    const [owner] = await db
      .insert(users)
      .values({
        email: `attendee-list-owner-${seed}@test.local`,
        fullName: 'Attendee List Owner',
      })
      .returning({ id: users.id })

    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Attendee List Tenant',
        slug: `attendee-list-${seed}`,
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

    const [evt] = await db
      .insert(events)
      .values({
        tenantId: t!.id,
        slug: `attendee-list-event-${seed}`,
        type: 'concert',
        title: 'Attendee List Event',
        status: 'on_sale',
        startsAt: future(30 * 24 * 60 * 60 * 1000),
        endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
        venue: physicalVenue,
        createdBy: owner!.id,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      })
      .returning({ id: events.id })

    const [tierGA] = await db
      .insert(ticketTiers)
      .values({
        tenantId: t!.id,
        eventId: evt!.id,
        name: 'General',
        pricePaisa: 0n,
        capacity: 100,
      })
      .returning({ id: ticketTiers.id })

    const [tierVIP] = await db
      .insert(ticketTiers)
      .values({
        tenantId: t!.id,
        eventId: evt!.id,
        name: 'VIP',
        pricePaisa: 0n,
        capacity: 50,
      })
      .returning({ id: ticketTiers.id })

    const staffToken = (
      await signTokens({
        sub: owner!.id,
        audience: 'tenant',
        tenantId: t!.id,
        sessionId: `sess_attlist_${seed}`,
      })
    ).accessToken

    return {
      ownerId: owner!.id,
      tenantId: t!.id,
      eventId: evt!.id,
      tierGA: tierGA!.id,
      tierVIP: tierVIP!.id,
      staffToken,
    }
  })
}

interface AttendeeRow {
  id: string
  name: string
  email: string
  orderStatus: 'paid' | 'pending'
  tierId: string
  checkedIn: boolean
}

async function seedAttendee(
  fx: ScopeFixture,
  spec: {
    suffix: string
    name?: string
    email?: string
    tierId: string
    orderStatus?: 'paid' | 'pending'
    checkedIn?: boolean
  },
): Promise<AttendeeRow> {
  return withSuperAdmin(async (db) => {
    const [order] = await db
      .insert(orders)
      .values({
        tenantId: fx.tenantId,
        eventId: fx.eventId,
        merchantTransactionId: `TXN-attlist-${spec.suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        buyerName: spec.name ?? `Buyer ${spec.suffix}`,
        buyerEmail: spec.email ?? `buyer-${spec.suffix}@test.local`,
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
        status: spec.orderStatus ?? 'paid',
        ...(spec.orderStatus === 'pending' ? {} : { paidAt: new Date() }),
      })
      .returning({ id: orders.id })

    const [item] = await db
      .insert(orderItems)
      .values({
        tenantId: fx.tenantId,
        orderId: order!.id,
        ticketTierId: spec.tierId,
        quantity: 1,
        unitPricePaisa: 0n,
        subtotalPaisa: 0n,
      })
      .returning({ id: orderItems.id })

    const [att] = await db
      .insert(attendees)
      .values({
        tenantId: fx.tenantId,
        orderId: order!.id,
        orderItemId: item!.id,
        ticketTierId: spec.tierId,
        attendeeName: spec.name ?? `Attendee ${spec.suffix}`,
        attendeeEmail: spec.email ?? `att-${spec.suffix}@test.local`,
        qrCode: mintQrToken(),
        ...(spec.checkedIn
          ? { checkedInAt: new Date(), checkedInBy: fx.ownerId, checkedInGate: 'Gate 1' }
          : {}),
      })
      .returning({ id: attendees.id })

    return {
      id: att!.id,
      name: spec.name ?? `Attendee ${spec.suffix}`,
      email: spec.email ?? `att-${spec.suffix}@test.local`,
      orderStatus: spec.orderStatus ?? 'paid',
      tierId: spec.tierId,
      checkedIn: spec.checkedIn ?? false,
    }
  })
}

interface ListResponse {
  data: Array<{
    id: string
    attendeeName: string
    attendeeEmail: string | null
    tierId: string
    tierName: string
    orderStatus: string
    checkedInAt: string | null
    checkedInGate: string | null
    createdAt: string
  }>
  meta: { nextCursor: string | null; hasMore: boolean }
}

describeIfDb('GET /api/v1/tenant/events/:eventId/attendees', () => {
  let tenantA: ScopeFixture
  let tenantB: ScopeFixture

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)
    tenantA = await seedTenantScope(`${Date.now()}-a`)
    tenantB = await seedTenantScope(`${Date.now()}-b`)
  })

  afterAll(async () => {
    await resetPool()
  })

  async function getList(token: string, eventId: string, qs = '') {
    const app = createApp()
    const url = qs
      ? `/api/v1/tenant/events/${eventId}/attendees?${qs}`
      : `/api/v1/tenant/events/${eventId}/attendees`
    return app.request(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  // ─── auth ────────────────────────────────────────────────────────

  it('401 when missing auth token', async () => {
    const app = createApp()
    const res = await app.request(`/api/v1/tenant/events/${tenantA.eventId}/attendees`, {
      method: 'GET',
    })
    expect(res.status).toBe(401)
  })

  // ─── happy path + shape ──────────────────────────────────────────

  it('lists own attendees with the expected envelope + shape', async () => {
    await seedAttendee(tenantA, { suffix: 'shape-1', tierId: tenantA.tierGA })

    const res = await getList(tenantA.staffToken, tenantA.eventId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    expect(body.data.length).toBeGreaterThanOrEqual(1)
    const row = body.data.find((r) => r.attendeeName.includes('shape-1'))
    expect(row).toBeTruthy()
    expect(row!.tierName).toBe('General')
    expect(row!.orderStatus).toBe('paid')
    expect(typeof row!.createdAt).toBe('string')
    expect(body.meta).toBeDefined()
    expect(body.meta.hasMore).toBe(false)
  })

  // ─── cross-tenant isolation (THE security property) ──────────────

  it('cross-tenant isolation: tenant B staff cannot list tenant A attendees', async () => {
    await seedAttendee(tenantA, { suffix: 'xtenant', tierId: tenantA.tierGA })

    // tenant B's staffToken hits tenant A's eventId — RLS + app filter
    // should hide tenant A's attendees from tenant B's session.
    const res = await getList(tenantB.staffToken, tenantA.eventId)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    // Empty: the event doesn't exist in B's RLS scope, so the join
    // through `events` matches nothing. Either way the result is empty.
    expect(body.data).toHaveLength(0)
  })

  // ─── search ──────────────────────────────────────────────────────

  it('search filters by name (case-insensitive)', async () => {
    await seedAttendee(tenantA, {
      suffix: 'search-rina',
      name: 'Rina Begum',
      tierId: tenantA.tierGA,
    })
    await seedAttendee(tenantA, {
      suffix: 'search-other',
      name: 'Karim Ahmed',
      tierId: tenantA.tierGA,
    })

    const res = await getList(tenantA.staffToken, tenantA.eventId, 'search=rina')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    expect(body.data.some((r) => r.attendeeName === 'Rina Begum')).toBe(true)
    expect(body.data.some((r) => r.attendeeName === 'Karim Ahmed')).toBe(false)
  })

  it('search filters by email', async () => {
    await seedAttendee(tenantA, {
      suffix: 'mail',
      email: 'unique-email-marker@test.local',
      tierId: tenantA.tierGA,
    })

    const res = await getList(tenantA.staffToken, tenantA.eventId, 'search=unique-email-marker')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    expect(body.data).toHaveLength(1)
    expect(body.data[0]!.attendeeEmail).toBe('unique-email-marker@test.local')
  })

  // ─── tier filter ─────────────────────────────────────────────────

  it('tierId filter returns only that tier', async () => {
    await seedAttendee(tenantA, { suffix: 'tier-ga', tierId: tenantA.tierGA })
    await seedAttendee(tenantA, { suffix: 'tier-vip', tierId: tenantA.tierVIP })

    const res = await getList(tenantA.staffToken, tenantA.eventId, `tierId=${tenantA.tierVIP}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    expect(body.data.length).toBeGreaterThan(0)
    for (const r of body.data) {
      expect(r.tierId).toBe(tenantA.tierVIP)
      expect(r.tierName).toBe('VIP')
    }
  })

  // ─── check-in filter ─────────────────────────────────────────────

  it('checkIn=checked_in returns only checked-in attendees', async () => {
    await seedAttendee(tenantA, {
      suffix: 'ci-yes',
      tierId: tenantA.tierGA,
      checkedIn: true,
    })
    await seedAttendee(tenantA, {
      suffix: 'ci-no',
      tierId: tenantA.tierGA,
      checkedIn: false,
    })

    const res = await getList(tenantA.staffToken, tenantA.eventId, 'checkIn=checked_in')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    expect(body.data.length).toBeGreaterThan(0)
    for (const r of body.data) {
      expect(r.checkedInAt).not.toBeNull()
    }
  })

  it('checkIn=not_checked_in excludes checked-in attendees', async () => {
    const res = await getList(tenantA.staffToken, tenantA.eventId, 'checkIn=not_checked_in')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    for (const r of body.data) {
      expect(r.checkedInAt).toBeNull()
    }
  })

  // ─── order status filter ─────────────────────────────────────────

  it('orderStatus=paid excludes pending orders', async () => {
    await seedAttendee(tenantA, {
      suffix: 'pending-order',
      tierId: tenantA.tierGA,
      orderStatus: 'pending',
    })
    const res = await getList(tenantA.staffToken, tenantA.eventId, 'orderStatus=paid')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ListResponse
    for (const r of body.data) {
      expect(r.orderStatus).toBe('paid')
    }
  })

  // ─── cursor pagination ───────────────────────────────────────────

  it('cursor pagination: limit=2 across 3+ rows returns 2 + nextCursor; second page returns rest', async () => {
    // Seed a fresh tenant scope so the previous tests' attendees don't
    // pollute the page counts.
    const tenantC = await seedTenantScope(`${Date.now()}-c`)
    for (const s of ['p1', 'p2', 'p3', 'p4']) {
      await seedAttendee(tenantC, { suffix: s, tierId: tenantC.tierGA })
    }

    const res1 = await getList(tenantC.staffToken, tenantC.eventId, 'limit=2')
    expect(res1.status).toBe(200)
    const body1 = (await res1.json()) as ListResponse
    expect(body1.data).toHaveLength(2)
    expect(body1.meta.hasMore).toBe(true)
    expect(body1.meta.nextCursor).toBeTruthy()

    const res2 = await getList(
      tenantC.staffToken,
      tenantC.eventId,
      `limit=2&cursor=${encodeURIComponent(body1.meta.nextCursor!)}`,
    )
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as ListResponse
    expect(body2.data.length).toBeGreaterThanOrEqual(2)
    // No id overlap across pages
    const idsPage1 = new Set(body1.data.map((r) => r.id))
    for (const r of body2.data) {
      expect(idsPage1.has(r.id)).toBe(false)
    }
  })

  // ─── no per-row audit on list reads (Decision G precedent) ───────

  it('list endpoint does NOT write per-row audit_logs entries', async () => {
    const att = await seedAttendee(tenantA, {
      suffix: 'no-audit',
      tierId: tenantA.tierGA,
    })

    const beforeCount = await withSuperAdmin((db) =>
      db
        .select({ n: count() })
        .from(auditLogs)
        .where(sql`${auditLogs.entityId} = ${att.id} AND ${auditLogs.entityType} = 'attendee'`),
    )

    const res = await getList(tenantA.staffToken, tenantA.eventId, 'search=no-audit')
    expect(res.status).toBe(200)

    const afterCount = await withSuperAdmin((db) =>
      db
        .select({ n: count() })
        .from(auditLogs)
        .where(sql`${auditLogs.entityId} = ${att.id} AND ${auditLogs.entityType} = 'attendee'`),
    )

    expect(afterCount[0]!.n).toBe(beforeCount[0]!.n)
  })
})
