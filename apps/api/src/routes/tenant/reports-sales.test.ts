/**
 * Tenant sales reports — DB-gated integration tests.
 * Sprint 4 Day 33 Phase 1.
 *
 * Pinned correctness + security invariants:
 *
 *   1. **Auth gate** — 401 when missing token.
 *   2. **Headline metrics** — gross / net / platform-fee / eps-fee
 *      sums match what was snapshotted on orders.
 *   3. **Status bucket collapse** — paid+completed → revenue;
 *      pending+awaiting_payment → pending; cancelled+failed →
 *      dropped; refund_* → refunded.
 *   4. **Fees come from SNAPSHOT, not recomputation** — change
 *      tenant_fee_config after the order, dashboard still reflects
 *      the snapshotted fee from the order row.
 *   5. **Tickets sold = SUM(quantity) for paid/completed orders.**
 *   6. **Per-event breakdown** — one row per event, sorted by revenue.
 *   7. **Per-tier breakdown** — one row per tier (incl. zero-sales
 *      tiers), counting only paid/completed orders.
 *   8. **Cross-tenant aggregate isolation (THE security property)** —
 *      tenant A's SUM/COUNT must reflect ONLY tenant A's orders,
 *      even when tenant B has rows in the same table. An unscoped
 *      SUM here would leak another tenant's revenue.
 *   9. **eventId filter** — narrows to a specific event.
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../../app.js'
import { signTokens } from '../../auth/jwt.js'
import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  events,
  orderItems,
  orders,
  tenantFeeConfig,
  tenantUsers,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'

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
        email: `sales-owner-${seed}@test.local`,
        fullName: 'Sales Owner',
      })
      .returning({ id: users.id })

    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Sales Tenant',
        slug: `sales-${seed}`,
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
        slug: `sales-event-${seed}`,
        type: 'concert',
        title: 'Sales Event',
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
        pricePaisa: 100000n, // BDT 1,000 face value
        capacity: 100,
      })
      .returning({ id: ticketTiers.id })

    const [tierVIP] = await db
      .insert(ticketTiers)
      .values({
        tenantId: t!.id,
        eventId: evt!.id,
        name: 'VIP',
        pricePaisa: 500000n, // BDT 5,000 face value
        capacity: 50,
      })
      .returning({ id: ticketTiers.id })

    const staffToken = (
      await signTokens({
        sub: owner!.id,
        audience: 'tenant',
        tenantId: t!.id,
        sessionId: `sess_sales_${seed}`,
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

/** Seed a synthetic order with fully-snapshotted fee fields. */
async function seedOrder(
  fx: ScopeFixture,
  spec: {
    suffix: string
    status:
      | 'paid'
      | 'completed'
      | 'pending'
      | 'awaiting_payment'
      | 'cancelled'
      | 'failed'
      | 'refund_requested'
      | 'refunded'
      | 'chargeback'
      | 'reversed'
    tierId: string
    quantity?: number
    /** Unit price for this order's snapshot (default = tier price). */
    unitPricePaisa?: bigint
    /** Override event_id (defaults to fx.eventId; needed for the
     *  eventId-filter test which seeds against a sibling event). */
    eventIdOverride?: string
    /** Snapshotted fee fields (defaults compute from quantity * unitPrice with 25 bps + 250 bps pass-through). */
    paidAt?: Date
  },
): Promise<{ orderId: string }> {
  return withSuperAdmin(async (db) => {
    const tier = await db
      .select({ pricePaisa: ticketTiers.pricePaisa })
      .from(ticketTiers)
      .where(sql`${ticketTiers.id} = ${spec.tierId}`)
      .limit(1)
    const unit = spec.unitPricePaisa ?? tier[0]!.pricePaisa
    const qty = spec.quantity ?? 1
    const subtotal = unit * BigInt(qty)
    // Pass-through fees: buyer paid the fees separately; snapshot
    // them as positive numbers and net = subtotal (organiser keeps face value).
    const platformFee = (subtotal * 25n) / 10000n // 0.25%
    const epsFee = (subtotal * 250n) / 10000n // 2.5% illustrative
    const total = subtotal + platformFee + epsFee
    const net = subtotal // pass-through → organiser keeps face value

    const [order] = await db
      .insert(orders)
      .values({
        tenantId: fx.tenantId,
        eventId: spec.eventIdOverride ?? fx.eventId,
        merchantTransactionId: `TXN-sales-${spec.suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        buyerName: `Buyer ${spec.suffix}`,
        buyerEmail: `buyer-${spec.suffix}@test.local`,
        buyerPhone: '+8801700000000',
        subtotalPaisa: subtotal,
        epsFeePaisa: epsFee,
        platformFeePaisa: platformFee,
        totalPaisa: total,
        netToOrganiserPaisa: net,
        platformFeeBps: 25,
        epsFeeBps: 250,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
        status: spec.status,
        paidAt:
          spec.status === 'paid' || spec.status === 'completed'
            ? (spec.paidAt ?? new Date())
            : null,
      })
      .returning({ id: orders.id })

    await db.insert(orderItems).values({
      tenantId: fx.tenantId,
      orderId: order!.id,
      ticketTierId: spec.tierId,
      quantity: qty,
      unitPricePaisa: unit,
      subtotalPaisa: subtotal,
    })

    return { orderId: order!.id }
  })
}

interface SalesResponse {
  data: {
    headline: {
      grossRevenuePaisa: string
      netToOrganiserPaisa: string
      platformFeePaisa: string
      epsFeePaisa: string
      paidOrderCount: number
      ticketsSold: number
      buckets: { revenue: number; pending: number; dropped: number; refunded: number }
    }
    timeSeries: Array<{ date: string; grossRevenuePaisa: string; paidOrderCount: number }>
    eventBreakdown: Array<{
      eventId: string
      eventTitle: string
      grossRevenuePaisa: string
      netToOrganiserPaisa: string
      paidOrderCount: number
      ticketsSold: number
    }>
    tierBreakdown: Array<{
      tierId: string
      tierName: string
      pricePaisa: string
      ticketsSold: number
      grossRevenuePaisa: string
    }>
  }
}

describeIfDb('GET /api/v1/tenant/reports/sales', () => {
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

  async function getSales(token: string, qs = '') {
    const app = createApp()
    const url = qs ? `/api/v1/tenant/reports/sales?${qs}` : '/api/v1/tenant/reports/sales'
    return app.request(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  // ─── auth ────────────────────────────────────────────────────────

  it('401 missing token', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/reports/sales')
    expect(res.status).toBe(401)
  })

  // ─── headline + buckets ──────────────────────────────────────────

  it('headline aggregates match the snapshotted fee fields', async () => {
    const fx = await seedTenantScope(`${Date.now()}-headline`)
    // 3 paid GA orders qty=2 each → 6 tickets, 6 × 100000 = 600000 paisa subtotal
    await seedOrder(fx, { suffix: 'p1', status: 'paid', tierId: fx.tierGA, quantity: 2 })
    await seedOrder(fx, { suffix: 'p2', status: 'paid', tierId: fx.tierGA, quantity: 2 })
    await seedOrder(fx, { suffix: 'p3', status: 'completed', tierId: fx.tierGA, quantity: 2 })
    // 1 pending
    await seedOrder(fx, { suffix: 'pend', status: 'pending', tierId: fx.tierGA, quantity: 1 })
    // 1 cancelled
    await seedOrder(fx, { suffix: 'cncl', status: 'cancelled', tierId: fx.tierGA, quantity: 1 })

    const res = await getSales(fx.staffToken)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SalesResponse

    // 600000 subtotal × 1.0275 (25 + 250 bps) = 616500 total per group of 200000
    // Per order: subtotal=200000, platformFee=500, epsFee=5000, total=205500
    // 3 paid orders: gross = 3 × 205500 = 616500
    expect(body.data.headline.grossRevenuePaisa).toBe('616500')
    // Net to organiser per order (pass-through) = subtotal = 200000
    // 3 paid orders: 600000
    expect(body.data.headline.netToOrganiserPaisa).toBe('600000')
    // Platform fee per order: 500 → 1500 total
    expect(body.data.headline.platformFeePaisa).toBe('1500')
    // EPS fee per order: 5000 → 15000 total
    expect(body.data.headline.epsFeePaisa).toBe('15000')
    expect(body.data.headline.paidOrderCount).toBe(3)
    expect(body.data.headline.ticketsSold).toBe(6)
    expect(body.data.headline.buckets.revenue).toBe(3)
    expect(body.data.headline.buckets.pending).toBe(1)
    expect(body.data.headline.buckets.dropped).toBe(1)
    expect(body.data.headline.buckets.refunded).toBe(0)
  })

  // ─── fees from snapshot, NOT recomputation ──────────────────────

  it('fees come from order SNAPSHOT, NOT live tenant_fee_config recomputation', async () => {
    const fx = await seedTenantScope(`${Date.now()}-snap`)
    await seedOrder(fx, { suffix: 'snap1', status: 'paid', tierId: fx.tierGA, quantity: 1 })
    // Snapshot at order time: platformFeeBps=25, platformFeePaisa=250

    // Now MUTATE tenant_fee_config to a wildly different bps —
    // a dashboard that recomputes from this would lie.
    await withSuperAdmin(async (db) => {
      await db.insert(tenantFeeConfig).values({
        tenantId: fx.tenantId,
        platformFeeBps: 999, // dramatic change
        defaultFeeMode: 'absorb',
        updatedBy: fx.ownerId,
      })
    })

    const res = await getSales(fx.staffToken)
    const body = (await res.json()) as SalesResponse
    // The order's snapshot stays at 25 bps → 250 paisa platform fee.
    // Dashboard reflects what was actually charged, not the new bps.
    expect(body.data.headline.platformFeePaisa).toBe('250')
  })

  // ─── per-event + per-tier breakdown ─────────────────────────────

  it('per-event breakdown includes only the events with orders + correct totals', async () => {
    const fx = await seedTenantScope(`${Date.now()}-evbreak`)
    await seedOrder(fx, { suffix: 'eb1', status: 'paid', tierId: fx.tierGA, quantity: 2 })

    const res = await getSales(fx.staffToken)
    const body = (await res.json()) as SalesResponse
    expect(body.data.eventBreakdown.length).toBeGreaterThan(0)
    const row = body.data.eventBreakdown.find((r) => r.eventId === fx.eventId)
    expect(row).toBeTruthy()
    expect(row!.paidOrderCount).toBe(1)
    expect(row!.ticketsSold).toBe(2)
  })

  it('per-tier breakdown lists ALL tiers (incl. zero-sales) for paid/completed orders only', async () => {
    const fx = await seedTenantScope(`${Date.now()}-tierbreak`)
    await seedOrder(fx, { suffix: 'tb1', status: 'paid', tierId: fx.tierGA, quantity: 3 })
    // No VIP orders sold, but VIP should still appear with 0
    // because it's the tenant's tier.

    const res = await getSales(fx.staffToken)
    const body = (await res.json()) as SalesResponse
    const ga = body.data.tierBreakdown.find((r) => r.tierId === fx.tierGA)
    const vip = body.data.tierBreakdown.find((r) => r.tierId === fx.tierVIP)
    expect(ga).toBeTruthy()
    expect(vip).toBeTruthy()
    expect(ga!.ticketsSold).toBe(3)
    expect(vip!.ticketsSold).toBe(0)
  })

  // ─── cross-tenant aggregate isolation (THE security one) ─────────

  it('cross-tenant aggregate isolation: tenant A SUM excludes tenant B orders', async () => {
    // Seed BIG orders for tenant B; tenant A's totals must stay small.
    await seedOrder(tenantB, {
      suffix: 'bigB1',
      status: 'paid',
      tierId: tenantB.tierVIP,
      quantity: 10,
    })
    await seedOrder(tenantB, {
      suffix: 'bigB2',
      status: 'paid',
      tierId: tenantB.tierVIP,
      quantity: 10,
    })
    // (20 × 500000 = 10_000_000 paisa of tenant B revenue — must NOT
    // appear in tenant A's numbers.)

    // Seed ONE small order for tenant A.
    await seedOrder(tenantA, {
      suffix: 'smallA',
      status: 'paid',
      tierId: tenantA.tierGA,
      quantity: 1,
    })

    const resA = await getSales(tenantA.staffToken)
    const bodyA = (await resA.json()) as SalesResponse

    // Tenant A's gross must NOT include tenant B's 10M paisa.
    // Tenant A has 1 paid order of subtotal=100000, total=102750.
    // Other tests may have added to tenantA's totals, but the ceiling
    // is "much less than tenant B's 10M" if isolation works.
    const grossA = BigInt(bodyA.data.headline.grossRevenuePaisa)
    expect(grossA < 10_000_000n).toBe(true) // tenant B contributes 0 to tenant A
    // The 1 small order is in there:
    expect(bodyA.data.headline.paidOrderCount).toBeGreaterThanOrEqual(1)

    // And confirm tenant B's view shows B's big orders, not A's small one.
    const resB = await getSales(tenantB.staffToken)
    const bodyB = (await resB.json()) as SalesResponse
    const grossB = BigInt(bodyB.data.headline.grossRevenuePaisa)
    expect(grossB >= 10_000_000n).toBe(true)
  })

  // ─── eventId filter ──────────────────────────────────────────────

  it('eventId filter narrows headline + breakdowns to that event only', async () => {
    const fx = await seedTenantScope(`${Date.now()}-evfilter`)
    // Second event under the same tenant
    const evt2 = await withSuperAdmin(async (db) => {
      const [e] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantId,
          slug: `evfilter-2-${Date.now()}`,
          type: 'concert',
          title: 'Other Event',
          status: 'on_sale',
          startsAt: future(30 * 24 * 60 * 60 * 1000),
          endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
          venue: physicalVenue,
          createdBy: fx.ownerId,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
        })
        .returning({ id: events.id })
      const [tier] = await db
        .insert(ticketTiers)
        .values({
          tenantId: fx.tenantId,
          eventId: e!.id,
          name: 'General',
          pricePaisa: 100000n,
          capacity: 100,
        })
        .returning({ id: ticketTiers.id })
      return { id: e!.id, tierId: tier!.id }
    })
    // Orders for event 1
    await seedOrder(fx, { suffix: 'ev1', status: 'paid', tierId: fx.tierGA, quantity: 1 })
    // Orders for event 2 — must override eventId (the seedOrder helper
    // defaults to fx.eventId; without the override, the order lands on
    // event 1, and the filter test fails because event 2 has 0 orders).
    await seedOrder(fx, {
      suffix: 'ev2',
      status: 'paid',
      tierId: evt2.tierId,
      eventIdOverride: evt2.id,
      quantity: 5,
    })

    // No filter → both events counted
    const resAll = await getSales(fx.staffToken)
    const bodyAll = (await resAll.json()) as SalesResponse
    expect(bodyAll.data.headline.ticketsSold).toBe(6)

    // Filter to event 2 only → 5 tickets
    const resEv2 = await getSales(fx.staffToken, `eventId=${evt2.id}`)
    const bodyEv2 = (await resEv2.json()) as SalesResponse
    expect(bodyEv2.data.headline.ticketsSold).toBe(5)
  })
})
