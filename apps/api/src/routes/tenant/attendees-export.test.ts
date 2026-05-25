/**
 * Tenant attendee CSV export — DB-gated integration tests.
 * Sprint 4 Day 32 Phase 3.
 *
 * Pinned correctness + security invariants:
 *
 *   1. **Auth gate** — 401 when missing token.
 *   2. **Happy path** — returns text/csv with the expected header
 *      row + one data row per attendee; Content-Disposition
 *      attachment; x-row-count header matches.
 *   3. **UTF-8 BOM** — body starts with the BOM byte sequence so
 *      Excel-on-Windows opens Bangla names correctly.
 *   4. **RFC 4180 escaping through the route** — a name with a
 *      comma gets quoted; embedded quotes get doubled.
 *   5. **Filter respected** — ?tierId=X exports only that tier.
 *   6. **Cross-tenant isolation (THE security one)** — tenant B
 *      cannot export tenant A's attendees; the response is the
 *      header row only (0 data rows) AND an audit row is written
 *      recording the attempt (row_count=0 cross-tenant probe).
 *   7. **Audit row written per export** (Day-32 Phase-3 decision:
 *      bulk PII extraction = discrete operational event).
 *   8. **Bangla attendee names render correctly** through the full
 *      stack (UTF-8 round-trip).
 */

import { sql } from 'drizzle-orm'
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
  tierGA: string
  tierVIP: string
  staffToken: string
}

async function seedTenantScope(seed: string): Promise<ScopeFixture> {
  return withSuperAdmin(async (db) => {
    const [owner] = await db
      .insert(users)
      .values({
        email: `attendee-export-owner-${seed}@test.local`,
        fullName: 'Export Owner',
      })
      .returning({ id: users.id })

    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Export Tenant',
        slug: `attendee-export-${seed}`,
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
        slug: `attendee-export-event-${seed}`,
        type: 'concert',
        title: 'Export Event',
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
        sessionId: `sess_export_${seed}`,
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

async function seedAttendee(
  fx: ScopeFixture,
  spec: { suffix: string; name?: string; email?: string; tierId: string },
): Promise<string> {
  return withSuperAdmin(async (db) => {
    const [order] = await db
      .insert(orders)
      .values({
        tenantId: fx.tenantId,
        eventId: fx.eventId,
        merchantTransactionId: `TXN-export-${spec.suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
        status: 'paid',
        paidAt: new Date(),
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
      })
      .returning({ id: attendees.id })
    return att!.id
  })
}

describeIfDb('GET /api/v1/tenant/events/:eventId/attendees/export', () => {
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

  async function exportCsv(token: string, eventId: string, qs = '') {
    const app = createApp()
    const url = qs
      ? `/api/v1/tenant/events/${eventId}/attendees/export?${qs}`
      : `/api/v1/tenant/events/${eventId}/attendees/export`
    return app.request(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  // ─── auth gate ──────────────────────────────────────────────────

  it('401 missing auth token', async () => {
    const app = createApp()
    const res = await app.request(`/api/v1/tenant/events/${tenantA.eventId}/attendees/export`)
    expect(res.status).toBe(401)
  })

  // ─── happy path + headers + audit ──────────────────────────────

  it('returns text/csv with the expected headers + a data row per attendee + audit row written', async () => {
    const fx = await seedTenantScope(`${Date.now()}-happy`)
    await seedAttendee(fx, { suffix: 'h1', tierId: fx.tierGA })
    await seedAttendee(fx, { suffix: 'h2', tierId: fx.tierGA })

    const res = await exportCsv(fx.staffToken, fx.eventId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="attendees-/)
    expect(res.headers.get('x-row-count')).toBe('2')

    // BOM check must be against the RAW bytes — WHATWG Response.text()
    // strips a leading UTF-8 BOM during decoding (it treats it as an
    // encoding marker, not content). Verify EF BB BF in the buffer.
    const buf = new Uint8Array(await res.arrayBuffer())
    expect(buf[0]).toBe(0xef)
    expect(buf[1]).toBe(0xbb)
    expect(buf[2]).toBe(0xbf)
    const body = new TextDecoder('utf-8').decode(buf)
    expect(body).toMatch(
      /attendee_id,attendee_name,attendee_email,attendee_phone,ticket_tier,order_status,checked_in_at,checked_in_gate,voided_at,registered_at/,
    )
    // Three CRLF-terminated lines: header + 2 attendees. (Trailing \r\n
    // means the split yields one extra empty element at the end.)
    const dataLines = body.split('\r\n').filter((l) => l.length > 0)
    expect(dataLines.length).toBe(3)

    // Audit row written exactly once for this export
    const audits = await withSuperAdmin((db) =>
      db
        .select()
        .from(auditLogs)
        .where(
          sql`${auditLogs.entityId} = ${fx.eventId} AND ${auditLogs.action} = 'attendees.exported_csv' AND ${auditLogs.actorId} = ${fx.ownerId}`,
        ),
    )
    expect(audits).toHaveLength(1)
    expect(audits[0]!.actorType).toBe('tenant_user')
    const diff = audits[0]!.diff as { row_count: number; filter: Record<string, unknown> }
    expect(diff.row_count).toBe(2)
    expect(diff.filter).toBeDefined()
  })

  // ─── RFC 4180 escaping through the route ─────────────────────────

  it('quotes attendee names containing commas; doubles embedded quotes', async () => {
    const fx = await seedTenantScope(`${Date.now()}-csv-esc`)
    await seedAttendee(fx, {
      suffix: 'comma',
      name: 'Smith, Jane',
      email: 'jane@test.local',
      tierId: fx.tierGA,
    })
    await seedAttendee(fx, {
      suffix: 'quote',
      name: 'She said "hi"',
      email: 'q@test.local',
      tierId: fx.tierGA,
    })

    const res = await exportCsv(fx.staffToken, fx.eventId)
    const body = await res.text()
    expect(body).toContain('"Smith, Jane"')
    expect(body).toContain('"She said ""hi"""')
  })

  // ─── UTF-8 (Bangla names) ────────────────────────────────────────

  it('Bangla attendee names round-trip through the export', async () => {
    const fx = await seedTenantScope(`${Date.now()}-bn`)
    await seedAttendee(fx, {
      suffix: 'rina',
      name: 'রিনা বেগম',
      email: 'rina@test.local',
      tierId: fx.tierGA,
    })

    const res = await exportCsv(fx.staffToken, fx.eventId)
    const body = await res.text()
    expect(body).toContain('রিনা বেগম')
  })

  // ─── filter respected ────────────────────────────────────────────

  it('respects tierId filter — exports only that tier', async () => {
    const fx = await seedTenantScope(`${Date.now()}-tier`)
    await seedAttendee(fx, { suffix: 'ga1', tierId: fx.tierGA })
    await seedAttendee(fx, { suffix: 'ga2', tierId: fx.tierGA })
    await seedAttendee(fx, { suffix: 'vip1', tierId: fx.tierVIP })

    const res = await exportCsv(fx.staffToken, fx.eventId, `tierId=${fx.tierVIP}`)
    expect(res.headers.get('x-row-count')).toBe('1')
    const body = await res.text()
    expect(body).toContain('VIP')
    expect(body).not.toContain('General')
  })

  // ─── cross-tenant isolation (THE security property) ─────────────

  it('cross-tenant: tenant B cannot export tenant A attendees → 0 rows + audit row recording the attempt', async () => {
    // Seed an attendee in tenantA so there's something to (not) leak.
    await seedAttendee(tenantA, { suffix: 'xtenant', tierId: tenantA.tierGA })

    const res = await exportCsv(tenantB.staffToken, tenantA.eventId)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-row-count')).toBe('0')

    const body = await res.text()
    // Only BOM + header + trailing newline; no data rows
    const dataLines = body.split('\r\n').filter((l) => l.length > 0)
    expect(dataLines.length).toBe(1) // header only

    // Audit row recording the cross-tenant attempt — actor is tenant B's
    // owner, tenant_id is tenant B's tenant (the audit RLS context is
    // tenant B's session inside withTenant(tenantB.id)).
    const audits = await withSuperAdmin((db) =>
      db
        .select()
        .from(auditLogs)
        .where(
          sql`${auditLogs.entityId} = ${tenantA.eventId} AND ${auditLogs.action} = 'attendees.exported_csv' AND ${auditLogs.actorId} = ${tenantB.ownerId}`,
        ),
    )
    expect(audits).toHaveLength(1)
    const diff = audits[0]!.diff as { row_count: number }
    expect(diff.row_count).toBe(0)
  })
})
