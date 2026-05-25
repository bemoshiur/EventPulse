/**
 * Super-admin platform revenue dashboard route tests — Sprint 4 Day 35 §14.7.
 *
 * ════════════════════════════════════════════════════════════════════
 * The SECURITY-CRITICAL test in this file
 * ════════════════════════════════════════════════════════════════════
 *
 * Day-33 tenant-dashboard tests asserted "tenant A cannot see tenant B".
 * Here, cross-tenant data is the POINT — a super admin MUST see across
 * all tenants. So the inverse test matters: a non-super-admin token
 * (tenant audience, attendee audience, or absent token) MUST get 403,
 * NOT 200 with leaked cross-tenant data. The auth gate is the entire
 * security model for this surface.
 *
 * Tests:
 *
 *   - no token → 401
 *   - tenant-audience token → 403
 *   - attendee-audience token → 403
 *   - super-admin token → 200 (returns the cross-tenant aggregate)
 *   - dashboard math: 2 tenants with paid orders + 1 refund + 1 fee
 *     change → KPIs add across tenants; leaderboards rank correctly;
 *     refund anomaly card surfaces the refunding tenant; fee-change
 *     card surfaces the recent change.
 *   - ledger drill: tenantId filter narrows to that tenant; §14.10
 *     Invariant 1 reported per-row (invariantOk=true on healthy data).
 *
 * DB-gated (skipped when DATABASE_URL unset).
 */

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { signTokens } from '../../auth/jwt.js'
import { createApp } from '../../app.js'
import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  events,
  feeOverrideLog,
  orderItems,
  orders,
  refunds,
  superAdmins,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const ORIGINAL_JWT_ACCESS = process.env['JWT_ACCESS_SECRET']
const ORIGINAL_JWT_REFRESH = process.env['JWT_REFRESH_SECRET']

interface Fixture {
  superAdminId: string
  tenantAOwnerId: string
  tenantBOwnerId: string
  tenantAId: string
  tenantBId: string
  tenantAEventId: string
  tenantBEventId: string
  tenantATierId: string
  tenantBTierId: string
  tenantAOrderIds: string[]
  tenantBOrderIds: string[]
  refundedOrderId: string
  superAdminToken: string
  tenantAToken: string
  attendeeToken: string
}

const physicalVenue = {
  type: 'physical' as const,
  name: 'Revenue Smoke Venue',
  address: '7 Revenue Road',
  division: 'dhaka' as const,
  district: 'Dhaka',
}
const future = (offsetMs: number) => new Date(Date.now() + offsetMs)

describeIfDb('GET /api/v1/admin/revenue — platform revenue dashboard (§14.7)', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'x'.repeat(64)
    process.env['JWT_REFRESH_SECRET'] = 'y'.repeat(64)

    await withSuperAdmin(async (db) => {
      // ─── 3 users: 1 super admin + 2 tenant owners ──────────────────
      const [admin] = await db
        .insert(users)
        .values({ email: `admin-rev-${seed}@test.local`, fullName: 'Rev Smoke Admin' })
        .returning({ id: users.id })
      fx.superAdminId = admin!.id
      await db.insert(superAdmins).values({ userId: fx.superAdminId, permissions: [] })

      const [ownerA] = await db
        .insert(users)
        .values({ email: `owner-a-${seed}@test.local`, fullName: 'Tenant A Owner' })
        .returning({ id: users.id })
      fx.tenantAOwnerId = ownerA!.id

      const [ownerB] = await db
        .insert(users)
        .values({ email: `owner-b-${seed}@test.local`, fullName: 'Tenant B Owner' })
        .returning({ id: users.id })
      fx.tenantBOwnerId = ownerB!.id

      // ─── 2 tenants ─────────────────────────────────────────────────
      const [tA] = await db
        .insert(tenants)
        .values({
          name: 'Tenant A',
          slug: `tenant-a-${seed}`,
          type: 'organisation',
          isPersonal: false,
          ownerUserId: fx.tenantAOwnerId,
        })
        .returning({ id: tenants.id })
      fx.tenantAId = tA!.id

      const [tB] = await db
        .insert(tenants)
        .values({
          name: 'Tenant B',
          slug: `tenant-b-${seed}`,
          type: 'organisation',
          isPersonal: false,
          ownerUserId: fx.tenantBOwnerId,
        })
        .returning({ id: tenants.id })
      fx.tenantBId = tB!.id

      // ─── 1 event + 1 tier each ─────────────────────────────────────
      const [evtA] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantAId,
          slug: `evt-a-${seed}`,
          type: 'concert',
          title: 'Tenant A Concert',
          status: 'on_sale',
          startsAt: future(30 * 24 * 60 * 60 * 1000),
          endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
          venue: physicalVenue,
          createdBy: fx.tenantAOwnerId,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
        })
        .returning({ id: events.id })
      fx.tenantAEventId = evtA!.id

      const [evtB] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantBId,
          slug: `evt-b-${seed}`,
          type: 'workshop',
          title: 'Tenant B Workshop',
          status: 'on_sale',
          startsAt: future(30 * 24 * 60 * 60 * 1000),
          endsAt: future(30 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
          venue: physicalVenue,
          createdBy: fx.tenantBOwnerId,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
        })
        .returning({ id: events.id })
      fx.tenantBEventId = evtB!.id

      const [tierA] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantAId,
          eventId: fx.tenantAEventId,
          name: 'GA',
          pricePaisa: 1_000_00n, // 1,000 BDT
          capacity: 100,
        })
        .returning({ id: ticketTiers.id })
      fx.tenantATierId = tierA!.id

      const [tierB] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantBId,
          eventId: fx.tenantBEventId,
          name: 'Workshop',
          pricePaisa: 500_00n, // 500 BDT
          capacity: 50,
        })
        .returning({ id: ticketTiers.id })
      fx.tenantBTierId = tierB!.id

      // ─── orders: 3 paid for A (each 1,000 BDT subtotal, 25 bps
      //     platform fee = 2.50 BDT, 1 also refunded) +
      //     2 paid for B (each 500 BDT subtotal, 25 bps = 1.25 BDT) ──
      //
      // We seed snapshotted fee fields directly; the calculator's job
      // is to produce these on real order creation, but this test
      // pins what the dashboard READS — so we seed canonical values
      // matching what the calculator would produce.
      fx.tenantAOrderIds = []
      fx.tenantBOrderIds = []

      const recentPaidAt = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2h ago — inside headline 24h window

      for (let i = 0; i < 3; i++) {
        const [o] = await db
          .insert(orders)
          .values({
            tenantId: fx.tenantAId,
            eventId: fx.tenantAEventId,
            merchantTransactionId: `TXN-A-${seed}-${i}`,
            buyerName: `Buyer A${i}`,
            buyerEmail: `buyer-a${i}-${seed}@test.local`,
            buyerPhone: `+88017100000${i}`,
            subtotalPaisa: 1_000_00n,
            platformFeePaisa: 250n, // 2.50 BDT
            epsFeePaisa: 0n,
            withholdingTaxPaisa: 0n,
            totalPaisa: 1_000_00n + 250n,
            netToOrganiserPaisa: 1_000_00n,
            currency: 'BDT',
            status: 'paid',
            paidAt: recentPaidAt,
            platformFeeBps: 25,
            epsFeeBps: 0,
            platformFeeHandling: 'pass_through',
            epsFeeHandling: 'pass_through',
          })
          .returning({ id: orders.id })
        fx.tenantAOrderIds.push(o!.id)

        await db.insert(orderItems).values({
          tenantId: fx.tenantAId,
          orderId: o!.id,
          ticketTierId: fx.tenantATierId,
          quantity: 1,
          unitPricePaisa: 1_000_00n,
          subtotalPaisa: 1_000_00n,
        })
      }
      // Refund one of A's orders (anomaly source).
      fx.refundedOrderId = fx.tenantAOrderIds[0]!
      await db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, fx.refundedOrderId))
      await db.insert(refunds).values({
        tenantId: fx.tenantAId,
        orderId: fx.refundedOrderId,
        amountPaisa: 1_000_00n + 250n,
        reason: 'Test refund',
        initiatedBy: fx.tenantAOwnerId,
        status: 'processed',
        processedAt: recentPaidAt,
      })

      // Seed enough A orders to clear the >= 3 minimum sample for the
      // refund-rate anomaly (paid + refunded). 3 already seeded; mark
      // 1 refunded => 2 paid + 1 refunded = 3 total, 33% refund rate.

      for (let i = 0; i < 2; i++) {
        const [o] = await db
          .insert(orders)
          .values({
            tenantId: fx.tenantBId,
            eventId: fx.tenantBEventId,
            merchantTransactionId: `TXN-B-${seed}-${i}`,
            buyerName: `Buyer B${i}`,
            buyerEmail: `buyer-b${i}-${seed}@test.local`,
            buyerPhone: `+88017200000${i}`,
            subtotalPaisa: 500_00n,
            platformFeePaisa: 125n, // 1.25 BDT
            epsFeePaisa: 0n,
            withholdingTaxPaisa: 0n,
            totalPaisa: 500_00n + 125n,
            netToOrganiserPaisa: 500_00n,
            currency: 'BDT',
            status: 'paid',
            paidAt: recentPaidAt,
            platformFeeBps: 25,
            epsFeeBps: 0,
            platformFeeHandling: 'pass_through',
            epsFeeHandling: 'pass_through',
          })
          .returning({ id: orders.id })
        fx.tenantBOrderIds.push(o!.id)

        await db.insert(orderItems).values({
          tenantId: fx.tenantBId,
          orderId: o!.id,
          ticketTierId: fx.tenantBTierId,
          quantity: 1,
          unitPricePaisa: 500_00n,
          subtotalPaisa: 500_00n,
        })
      }

      // ─── recent fee-change on tenant A (anomaly source) ─────────────
      await db.insert(feeOverrideLog).values({
        tenantId: fx.tenantAId,
        changedBy: fx.superAdminId,
        previousFeeBps: 25,
        newFeeBps: 50,
        previousMode: 'pass_through',
        newMode: 'absorb',
        reason: 'Test fee change for anomaly card',
        effectiveFrom: new Date(),
      })
    })

    // ─── tokens for the auth-gate tests ──────────────────────────────
    fx.superAdminToken = (
      await signTokens({
        sub: fx.superAdminId,
        audience: 'super-admin',
        tenantId: null,
        sessionId: `sess_admin_${seed}`,
      })
    ).accessToken

    fx.tenantAToken = (
      await signTokens({
        sub: fx.tenantAOwnerId,
        audience: 'tenant',
        tenantId: fx.tenantAId,
        sessionId: `sess_tenant_a_${seed}`,
      })
    ).accessToken

    fx.attendeeToken = (
      await signTokens({
        sub: fx.tenantAOwnerId,
        audience: 'attendee',
        tenantId: null,
        sessionId: `sess_attendee_${seed}`,
      })
    ).accessToken
  })

  afterAll(async () => {
    // Cleanup in FK-respect order.
    await withSuperAdmin(async (db) => {
      for (const oid of [...fx.tenantAOrderIds, ...fx.tenantBOrderIds]) {
        await db.delete(refunds).where(eq(refunds.orderId, oid))
        await db.delete(orderItems).where(eq(orderItems.orderId, oid))
        await db.delete(orders).where(eq(orders.id, oid))
      }
      await db.delete(feeOverrideLog).where(eq(feeOverrideLog.tenantId, fx.tenantAId))
      await db.delete(ticketTiers).where(eq(ticketTiers.id, fx.tenantATierId))
      await db.delete(ticketTiers).where(eq(ticketTiers.id, fx.tenantBTierId))
      await db.delete(events).where(eq(events.id, fx.tenantAEventId))
      await db.delete(events).where(eq(events.id, fx.tenantBEventId))
      await db.delete(tenants).where(eq(tenants.id, fx.tenantAId))
      await db.delete(tenants).where(eq(tenants.id, fx.tenantBId))
      await db.delete(superAdmins).where(eq(superAdmins.userId, fx.superAdminId))
      for (const u of [fx.superAdminId, fx.tenantAOwnerId, fx.tenantBOwnerId]) {
        await db.delete(users).where(eq(users.id, u))
      }
    })
    if (ORIGINAL_JWT_ACCESS === undefined) delete process.env['JWT_ACCESS_SECRET']
    else process.env['JWT_ACCESS_SECRET'] = ORIGINAL_JWT_ACCESS
    if (ORIGINAL_JWT_REFRESH === undefined) delete process.env['JWT_REFRESH_SECRET']
    else process.env['JWT_REFRESH_SECRET'] = ORIGINAL_JWT_REFRESH
    await resetPool()
  })

  // ─── SECURITY-CRITICAL: auth gate ────────────────────────────────

  it('SECURITY: no token → 401 (must not leak)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', { method: 'GET' })
    expect(res.status).toBe(401)
  })

  it('SECURITY: tenant-audience token → 403 (must not leak cross-tenant)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.tenantAToken}` },
    })
    expect(res.status).toBe(403)
    // Ensure the body is the standard error envelope, not data.
    const body = (await res.json()) as { error?: { code: string }; data?: unknown }
    expect(body.error?.code).toBe('FORBIDDEN')
    expect(body.data).toBeUndefined()
  })

  it('SECURITY: attendee-audience token → 403 (must not leak cross-tenant)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.attendeeToken}` },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: { code: string } }
    expect(body.error?.code).toBe('FORBIDDEN')
  })

  it('SECURITY: ledger endpoint also rejects tenant token', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue/ledger', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.tenantAToken}` },
    })
    expect(res.status).toBe(403)
  })

  // ─── dashboard math ──────────────────────────────────────────────

  it('super-admin sees cross-tenant aggregates (headline KPIs sum across tenants)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        headline: {
          gmvPaisa: string
          platformRevenuePaisa: string
          transactionCount: number
          activeTenantCount: number
          weightedTakeBps: number
        }
      }
    }
    // We seeded: tenant A paid 3 orders (one then refunded → 2 paid +
    // completed); tenant B paid 2 orders. Plus other tests' data may
    // exist in shared DB. Use >= assertions to stay robust to that.
    expect(body.data.headline.transactionCount).toBeGreaterThanOrEqual(4)
    expect(body.data.headline.activeTenantCount).toBeGreaterThanOrEqual(2)
    // GMV >= our 4 paid orders (2 × 100,250 paisa + 2 × 50,125 paisa = 300,750)
    expect(BigInt(body.data.headline.gmvPaisa)).toBeGreaterThanOrEqual(300_750n)
    // Platform revenue >= our 4 paid orders' platform fees (2 × 250 + 2 × 125 = 750)
    expect(BigInt(body.data.headline.platformRevenuePaisa)).toBeGreaterThanOrEqual(750n)
    // Take rate sane (1-100 bps for our seed mix, allowing for other test data)
    expect(body.data.headline.weightedTakeBps).toBeGreaterThan(0)
    expect(body.data.headline.weightedTakeBps).toBeLessThan(1000)
  })

  it('leaderboards rank tenants correctly (tenant A above tenant B by GMV)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    const body = (await res.json()) as {
      data: {
        topByGmv: Array<{ tenantId: string; tenantSlug: string; gmvPaisa: string }>
      }
    }
    const aIndex = body.data.topByGmv.findIndex((r) => r.tenantId === fx.tenantAId)
    const bIndex = body.data.topByGmv.findIndex((r) => r.tenantId === fx.tenantBId)
    expect(aIndex).toBeGreaterThanOrEqual(0)
    expect(bIndex).toBeGreaterThanOrEqual(0)
    // Tenant A's 2 paid orders × 100,250 = 200,500 paisa > Tenant B's 2 × 50,125 = 100,250 paisa
    expect(aIndex).toBeLessThan(bIndex)
  })

  it('refund-rate anomaly surfaces tenant A (1 of 3 refunded = ~33%)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    const body = (await res.json()) as {
      data: {
        anomalies: {
          refundRates: Array<{ tenantId: string; refundRateBps: number }>
        }
      }
    }
    const tenantAAnomaly = body.data.anomalies.refundRates.find((r) => r.tenantId === fx.tenantAId)
    expect(tenantAAnomaly).toBeDefined()
    // 1 refunded out of (2 paid + 1 refunded) = 33.33% = ~3333 bps
    expect(tenantAAnomaly!.refundRateBps).toBeGreaterThanOrEqual(3000)
  })

  it('fee-change anomaly surfaces the recent tenant A change', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    const body = (await res.json()) as {
      data: {
        anomalies: {
          feeChanges: Array<{
            tenantId: string
            previousFeeBps: number
            newFeeBps: number
            absDeltaBps: number
          }>
        }
      }
    }
    const change = body.data.anomalies.feeChanges.find((r) => r.tenantId === fx.tenantAId)
    expect(change).toBeDefined()
    expect(change!.previousFeeBps).toBe(25)
    expect(change!.newFeeBps).toBe(50)
    expect(change!.absDeltaBps).toBe(25) // exceeds the 10 bps 4-eyes threshold
  })

  it('settlement queue includes both seeded tenants with positive pending payouts', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    const body = (await res.json()) as {
      data: {
        settlementQueue: Array<{ tenantId: string; pendingPaisa: string; paidOrderCount: number }>
      }
    }
    const a = body.data.settlementQueue.find((r) => r.tenantId === fx.tenantAId)
    const b = body.data.settlementQueue.find((r) => r.tenantId === fx.tenantBId)
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    // Tenant A's pending = 2 paid orders × 100,000 = 200,000 paisa net
    // (the refunded order's status moved to 'refunded' and is excluded).
    expect(BigInt(a!.pendingPaisa)).toBeGreaterThanOrEqual(200_000n)
    // Tenant B's pending = 2 × 50,000 = 100,000 paisa net
    expect(BigInt(b!.pendingPaisa)).toBeGreaterThanOrEqual(100_000n)
  })

  it('time series returns a chronologically-ordered list', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    const body = (await res.json()) as {
      data: { timeSeries: Array<{ date: string }> }
    }
    expect(body.data.timeSeries.length).toBeGreaterThanOrEqual(1)
    // Asserts ASC ordering (date strings sort lexically since YYYY-MM-DD).
    for (let i = 1; i < body.data.timeSeries.length; i++) {
      expect(body.data.timeSeries[i]!.date >= body.data.timeSeries[i - 1]!.date).toBe(true)
    }
  })

  // ─── ledger drill ────────────────────────────────────────────────

  it('ledger filters by tenant + verifies §14.10 Invariant 1 per row', async () => {
    const app = createApp()
    const res = await app.request(`/api/v1/admin/revenue/ledger?tenantId=${fx.tenantAId}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        rows: Array<{
          orderId: string
          tenantId: string
          totalPaisa: string
          netToOrganiserPaisa: string
          platformFeePaisa: string
          epsFeePaisa: string
          withholdingTaxPaisa: string
        }>
        invariantOk: boolean
        invariantFailureOrderIds: string[]
      }
    }
    // Every row belongs to tenant A (filter respected).
    for (const r of body.data.rows) {
      expect(r.tenantId).toBe(fx.tenantAId)
      // §14.10 Invariant 1 per-row check: total = net + platform_fee + eps_fee + withholding.
      const split =
        BigInt(r.netToOrganiserPaisa) +
        BigInt(r.platformFeePaisa) +
        BigInt(r.epsFeePaisa) +
        BigInt(r.withholdingTaxPaisa)
      expect(BigInt(r.totalPaisa)).toBe(split)
    }
    expect(body.data.invariantOk).toBe(true)
    expect(body.data.invariantFailureOrderIds).toEqual([])
  })

  it('ledger without tenantId returns rows across tenants (cross-tenant intent)', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/admin/revenue/ledger', {
      method: 'GET',
      headers: { authorization: `Bearer ${fx.superAdminToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { rows: Array<{ tenantId: string }> }
    }
    const tenantIds = new Set(body.data.rows.map((r) => r.tenantId))
    expect(tenantIds.has(fx.tenantAId)).toBe(true)
    expect(tenantIds.has(fx.tenantBId)).toBe(true)
  })
})
