/**
 * Tenant payouts view — DB-gated integration tests.
 * Sprint 4 Day 33 Phase 3.
 *
 * Pinned invariants:
 *
 *   1. **Auth gate** — 401 missing token.
 *   2. **Net comes from SNAPSHOT** — sum of orders.netToOrganiserPaisa
 *      for paid+completed orders matches what was snapshotted; NOT
 *      recomputed from current tenant_fee_config.
 *   3. **Current fees displayed** — currentFees field reflects
 *      tenant_fee_config (or platform defaults when no override).
 *   4. **Snapshot vs current decoupled** — mutate tenant_fee_config
 *      after orders are placed; the payable total reflects the old
 *      snapshot, while currentFees reflects the new value.
 *   5. **Cross-tenant aggregate isolation (THE security one)** —
 *      tenant A's payable total excludes tenant B's orders, even
 *      when tenant B has BIG paid orders in the same table.
 *   6. **Refund-leak counted separately** — refund_requested/refunded
 *      orders surface as refundLeakOrderCount + refundLeakPaisa
 *      and do NOT contribute to pendingPayoutPaisa.
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
  staffToken: string
}

async function seedTenantScope(seed: string): Promise<ScopeFixture> {
  return withSuperAdmin(async (db) => {
    const [owner] = await db
      .insert(users)
      .values({
        email: `payouts-owner-${seed}@test.local`,
        fullName: 'Payouts Owner',
      })
      .returning({ id: users.id })

    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Payouts Tenant',
        slug: `payouts-${seed}`,
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
        slug: `payouts-event-${seed}`,
        type: 'concert',
        title: 'Payouts Event',
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
        pricePaisa: 100000n, // BDT 1,000
        capacity: 100,
      })
      .returning({ id: ticketTiers.id })

    const staffToken = (
      await signTokens({
        sub: owner!.id,
        audience: 'tenant',
        tenantId: t!.id,
        sessionId: `sess_payouts_${seed}`,
      })
    ).accessToken

    return {
      ownerId: owner!.id,
      tenantId: t!.id,
      eventId: evt!.id,
      tierGA: tierGA!.id,
      staffToken,
    }
  })
}

async function seedOrder(
  fx: ScopeFixture,
  spec: {
    suffix: string
    status: 'paid' | 'completed' | 'refund_requested' | 'refunded' | 'chargeback' | 'reversed'
    quantity?: number
  },
): Promise<void> {
  return withSuperAdmin(async (db) => {
    const tier = await db
      .select({ pricePaisa: ticketTiers.pricePaisa })
      .from(ticketTiers)
      .where(sql`${ticketTiers.id} = ${fx.tierGA}`)
      .limit(1)
    const unit = tier[0]!.pricePaisa
    const qty = spec.quantity ?? 1
    const subtotal = unit * BigInt(qty)
    const platformFee = (subtotal * 25n) / 10000n
    const epsFee = (subtotal * 250n) / 10000n
    const total = subtotal + platformFee + epsFee
    const net = subtotal // pass-through → organiser keeps face value

    const [order] = await db
      .insert(orders)
      .values({
        tenantId: fx.tenantId,
        eventId: fx.eventId,
        merchantTransactionId: `TXN-payouts-${spec.suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
          spec.status === 'paid' ||
          spec.status === 'completed' ||
          // refund states still have a paid_at from when they were originally paid
          spec.status === 'refund_requested' ||
          spec.status === 'refunded' ||
          spec.status === 'chargeback' ||
          spec.status === 'reversed'
            ? new Date()
            : null,
      })
      .returning({ id: orders.id })

    await db.insert(orderItems).values({
      tenantId: fx.tenantId,
      orderId: order!.id,
      ticketTierId: fx.tierGA,
      quantity: qty,
      unitPricePaisa: unit,
      subtotalPaisa: subtotal,
    })
  })
}

interface PayoutsResponse {
  data: {
    pendingPayoutPaisa: string
    grossRevenuePaisa: string
    platformFeePaisa: string
    epsFeePaisa: string
    paidOrderCount: number
    refundLeakOrderCount: number
    refundLeakPaisa: string
    currentFees: {
      platformFeeBps: number
      defaultFeeMode: string
      hasOverride: boolean
    }
  }
}

describeIfDb('GET /api/v1/tenant/reports/payouts', () => {
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

  async function getPayouts(token: string) {
    const app = createApp()
    return app.request('/api/v1/tenant/reports/payouts', {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  it('401 missing token', async () => {
    const app = createApp()
    const res = await app.request('/api/v1/tenant/reports/payouts')
    expect(res.status).toBe(401)
  })

  it('payable total = SUM(netToOrganiserPaisa) for paid+completed, from SNAPSHOT', async () => {
    const fx = await seedTenantScope(`${Date.now()}-snap`)
    await seedOrder(fx, { suffix: 's1', status: 'paid', quantity: 2 })
    await seedOrder(fx, { suffix: 's2', status: 'completed', quantity: 1 })
    // total snapshotted net = (2*100000) + (1*100000) = 300000 (pass-through)

    const res = await getPayouts(fx.staffToken)
    expect(res.status).toBe(200)
    const body = (await res.json()) as PayoutsResponse
    expect(body.data.pendingPayoutPaisa).toBe('300000')
    expect(body.data.paidOrderCount).toBe(2)
  })

  it('mutating tenant_fee_config does NOT change the payable total (snapshot stays)', async () => {
    const fx = await seedTenantScope(`${Date.now()}-mutate`)
    await seedOrder(fx, { suffix: 'm1', status: 'paid', quantity: 1 })
    // Snapshot: net=100000, platform fee snapshot=250, eps fee snapshot=2500

    // Mutate fee config dramatically
    await withSuperAdmin(async (db) => {
      await db.insert(tenantFeeConfig).values({
        tenantId: fx.tenantId,
        platformFeeBps: 999,
        defaultFeeMode: 'absorb',
        updatedBy: fx.ownerId,
      })
    })

    const res = await getPayouts(fx.staffToken)
    const body = (await res.json()) as PayoutsResponse
    // Payable total stays at the snapshot
    expect(body.data.pendingPayoutPaisa).toBe('100000')
    expect(body.data.platformFeePaisa).toBe('250')
    // But currentFees reflects the NEW value
    expect(body.data.currentFees.platformFeeBps).toBe(999)
    expect(body.data.currentFees.hasOverride).toBe(true)
  })

  it('refund-leak counted separately, NOT in pendingPayoutPaisa', async () => {
    const fx = await seedTenantScope(`${Date.now()}-refund`)
    await seedOrder(fx, { suffix: 'p1', status: 'paid', quantity: 1 })
    await seedOrder(fx, { suffix: 'r1', status: 'refund_requested', quantity: 1 })
    await seedOrder(fx, { suffix: 'r2', status: 'refunded', quantity: 1 })

    const res = await getPayouts(fx.staffToken)
    const body = (await res.json()) as PayoutsResponse
    // Only the 1 paid order contributes to payable
    expect(body.data.pendingPayoutPaisa).toBe('100000')
    expect(body.data.paidOrderCount).toBe(1)
    // 2 refund-leak orders
    expect(body.data.refundLeakOrderCount).toBe(2)
    // Refund leak total = 2 * 102750 (each order's total) = 205500
    expect(body.data.refundLeakPaisa).toBe('205500')
  })

  it('currentFees defaults to platform defaults when no tenant override', async () => {
    const fx = await seedTenantScope(`${Date.now()}-defaults`)
    const res = await getPayouts(fx.staffToken)
    const body = (await res.json()) as PayoutsResponse
    expect(body.data.currentFees.hasOverride).toBe(false)
    // Default per playbook §14.4 / Sprint 1: 25 bps
    expect(body.data.currentFees.platformFeeBps).toBe(25)
  })

  it('cross-tenant aggregate isolation: tenant A view excludes tenant B orders', async () => {
    // Big paid orders for tenant B (10 × 100k = 1M paisa net)
    for (let i = 0; i < 10; i++) {
      await seedOrder(tenantB, { suffix: `big${i}`, status: 'paid', quantity: 1 })
    }
    // One small order for tenant A
    await seedOrder(tenantA, { suffix: 'smallA', status: 'paid', quantity: 1 })

    const resA = await getPayouts(tenantA.staffToken)
    const bodyA = (await resA.json()) as PayoutsResponse
    const payableA = BigInt(bodyA.data.pendingPayoutPaisa)
    // Tenant A's payable must NOT include tenant B's 1M paisa.
    expect(payableA < 1_000_000n).toBe(true)
    expect(bodyA.data.paidOrderCount).toBeGreaterThanOrEqual(1)

    const resB = await getPayouts(tenantB.staffToken)
    const bodyB = (await resB.json()) as PayoutsResponse
    const payableB = BigInt(bodyB.data.pendingPayoutPaisa)
    expect(payableB >= 1_000_000n).toBe(true)
  })
})
