/**
 * Capacity-lock race test — Sprint 3 Day 29 Phase 2.
 *
 * The canonical oversell-prevention proof: N concurrent buyers race
 * for M < N tickets; exactly M succeed and sold NEVER exceeds capacity.
 *
 * DB-gated (needs `DATABASE_URL`) because the test exercises Postgres
 * row-level lock semantics that cannot be faithfully mocked. The
 * Promise.all kicks N requests against the SAME ticket_tier row;
 * Postgres serialises them at the FOR UPDATE line.
 *
 * Pinned invariants:
 *
 *   1. **No oversell under concurrency.** N buyers, M tickets,
 *      M < N → exactly M succeed, N-M get InsufficientCapacityError;
 *      `sold` at the end equals M (capacity); `sold <= capacity`
 *      throughout.
 *   2. **Quantity > 1 respects remaining capacity atomically.** A
 *      buyer requesting quantity=3 vs remaining=2 is rejected; the
 *      remaining stays 2 (not partially-consumed).
 *   3. **Lock releases on rollback.** A test that triggers a tx
 *      rollback after acquiring the lock leaves the row available
 *      (no permanently-locked rows). Verified indirectly: a buyer
 *      whose order fails INSIDE the tx (after the lock) — sold is
 *      not incremented (Postgres ROLLBACK reverses the UPDATE).
 *   4. **Multi-tier deadlock-free.** Two concurrent orders touching
 *      overlapping tier sets in DIFFERENT user-provided orders.
 *      Without ORDER BY id in the FOR UPDATE, this deadlocks. With
 *      it, they serialise cleanly.
 *
 * Test approach: each scenario seeds a fresh tenant/event/tier set
 * (the standard pattern from settle.test.ts), spawns concurrent
 * createOrder() invocations via Promise.all, and asserts the final
 * sold count + outcome distribution.
 *
 * EPS is NOT touched. The block-guard in initialiseOrder fires at
 * the END of createOrder (after the tx commits); STAGING_PAYMENT_BLOCK
 * is unset for this test (so init runs but block-refuses on the
 * priced order), and the `paymentInitState: 'blocked'` outcome is
 * fine — the capacity check + DB writes are what we're testing.
 */

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import { events, orderItems, orders, tenants, ticketTiers, users } from '../../db/schema/index.js'

import { createOrder, InsufficientCapacityError, type CreateOrderResult } from './index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

const ORIGINAL_BLOCK = process.env['STAGING_PAYMENT_BLOCK']
const ORIGINAL_EPS_MODE = process.env['EPS_MODE']

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
  secondTierId?: string
}

async function seedFreshFixture(opts: {
  capacity: number
  secondTierCapacity?: number
}): Promise<Fixture> {
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return withSuperAdmin(async (db) => {
    const [owner] = await db
      .insert(users)
      .values({
        email: `capacity-test-${seed}@test.local`,
        fullName: 'Capacity Test Owner',
      })
      .returning({ id: users.id })

    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Capacity Test Tenant',
        slug: `capacity-test-${seed}`,
        isPersonal: true,
        ownerUserId: owner!.id,
        type: 'organisation',
      })
      .returning({ id: tenants.id })

    const [evt] = await db
      .insert(events)
      .values({
        tenantId: t!.id,
        slug: `capacity-test-event-${seed}`,
        type: 'concert',
        title: 'Capacity Test Event',
        status: 'on_sale',
        startsAt: future(30 * 24 * 60 * 60 * 1000),
        endsAt: future(30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
        venue: physicalVenue,
        createdBy: owner!.id,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      })
      .returning({ id: events.id })

    const [tier] = await db
      .insert(ticketTiers)
      .values({
        tenantId: t!.id,
        eventId: evt!.id,
        name: 'General',
        pricePaisa: 100_000n,
        capacity: opts.capacity,
        sold: 0,
      })
      .returning({ id: ticketTiers.id })

    let secondTierId: string | undefined
    if (opts.secondTierCapacity != null) {
      const [t2] = await db
        .insert(ticketTiers)
        .values({
          tenantId: t!.id,
          eventId: evt!.id,
          name: 'VIP',
          pricePaisa: 250_000n,
          capacity: opts.secondTierCapacity,
          sold: 0,
        })
        .returning({ id: ticketTiers.id })
      secondTierId = t2!.id
    }

    return {
      ownerId: owner!.id,
      tenantId: t!.id,
      eventId: evt!.id,
      tierId: tier!.id,
      ...(secondTierId ? { secondTierId } : {}),
    }
  })
}

function buyerInput(suffix: string) {
  return {
    name: 'Test Buyer',
    email: `buyer-${suffix}@test.local`,
    phone: '+8801700000000',
  }
}

describeIfDb('createOrder — FOR UPDATE capacity lock (oversell prevention)', () => {
  beforeAll(() => {
    // Make sure the block is OFF for tests that need init to actually
    // try (the block is RE-CHECKED via the env at call time). Even
    // with block on, the order persists; we don't care about init
    // here. Set block to '0' explicitly so tests are deterministic.
    process.env['STAGING_PAYMENT_BLOCK'] = '0'
    // EPS env: stub to a mode that won't actually be reached because
    // these tests don't pre-seed the token cache; the init call WILL
    // fail with an EPS error AFTER the tx commits. The createOrder
    // service catches StagingPaymentBlockedError but NOT generic
    // EPS errors — they bubble up. We catch them in the test.
    process.env['EPS_MERCHANT_ID'] = 'merchant-capacity'
    process.env['EPS_STORE_ID'] = 'store-capacity'
    process.env['EPS_USERNAME'] = 'epscap'
    process.env['EPS_PASSWORD'] = 'passcap'
    process.env['EPS_HASH_KEY'] = 'hashcap'
    process.env['EPS_MODE'] = 'production'
    // Re-enable the block so EPS init refuses cleanly per Day 26.
    process.env['STAGING_PAYMENT_BLOCK'] = '1'
  })

  afterAll(async () => {
    if (ORIGINAL_BLOCK === undefined) delete process.env['STAGING_PAYMENT_BLOCK']
    else process.env['STAGING_PAYMENT_BLOCK'] = ORIGINAL_BLOCK
    if (ORIGINAL_EPS_MODE === undefined) delete process.env['EPS_MODE']
    else process.env['EPS_MODE'] = ORIGINAL_EPS_MODE
    await resetPool()
  })

  it('CANONICAL: 10 concurrent buyers race for 3 tickets → exactly 3 succeed, 7 get TIER_SOLD_OUT, sold=3', async () => {
    const fx = await seedFreshFixture({ capacity: 3 })

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createOrder({
          eventId: fx.eventId,
          tierSelections: [{ tierId: fx.tierId, quantity: 1 }],
          buyer: buyerInput(`race-${i}`),
        }).then(
          (ok) => ({ kind: 'ok' as const, result: ok }),
          (err: unknown) => ({ kind: 'err' as const, err }),
        ),
      ),
    )

    const okCount = results.filter((r) => r.kind === 'ok').length
    const soldOutCount = results.filter(
      (r) => r.kind === 'err' && r.err instanceof InsufficientCapacityError,
    ).length
    expect(okCount).toBe(3)
    expect(soldOutCount).toBe(7)

    // Final sold MUST equal capacity (no over-sale, no under-count).
    const [row] = await withSuperAdmin((db) =>
      db.select({ sold: ticketTiers.sold }).from(ticketTiers).where(eq(ticketTiers.id, fx.tierId)),
    )
    expect(row!.sold).toBe(3)

    // Exactly 3 orders were inserted.
    const orderRows = await withSuperAdmin((db) =>
      db.select({ id: orders.id }).from(orders).where(eq(orders.eventId, fx.eventId)),
    )
    expect(orderRows).toHaveLength(3)
  })

  it('quantity > 1: buyer wanting 3 vs remaining 2 is rejected; sold stays at the prior value', async () => {
    const fx = await seedFreshFixture({ capacity: 5 })

    // Pre-consume 3 of 5.
    await createOrder({
      eventId: fx.eventId,
      tierSelections: [{ tierId: fx.tierId, quantity: 3 }],
      buyer: buyerInput('pre-3'),
    })

    // Now request 3 — only 2 remaining. Must reject; sold stays 3.
    let caught: unknown
    try {
      await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.tierId, quantity: 3 }],
        buyer: buyerInput('try-3-over'),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(InsufficientCapacityError)
    if (caught instanceof InsufficientCapacityError) {
      expect(caught.tierId).toBe(fx.tierId)
      expect(caught.requested).toBe(3)
      expect(caught.available).toBe(2)
    }

    const [row] = await withSuperAdmin((db) =>
      db.select({ sold: ticketTiers.sold }).from(ticketTiers).where(eq(ticketTiers.id, fx.tierId)),
    )
    expect(row!.sold).toBe(3)
  })

  it('quantity > 1: buyer requesting exactly remaining succeeds', async () => {
    const fx = await seedFreshFixture({ capacity: 5 })

    await createOrder({
      eventId: fx.eventId,
      tierSelections: [{ tierId: fx.tierId, quantity: 3 }],
      buyer: buyerInput('first-3'),
    })

    // 2 remaining; request exactly 2.
    const result = await createOrder({
      eventId: fx.eventId,
      tierSelections: [{ tierId: fx.tierId, quantity: 2 }],
      buyer: buyerInput('take-last-2'),
    })
    expect(result.status).toBe('awaiting_payment')

    const [row] = await withSuperAdmin((db) =>
      db.select({ sold: ticketTiers.sold }).from(ticketTiers).where(eq(ticketTiers.id, fx.tierId)),
    )
    expect(row!.sold).toBe(5) // 3 + 2
  })

  it('sequential exhaustion: 5 buyers × 1 ticket on capacity 5 → all 5 succeed, sold=5', async () => {
    const fx = await seedFreshFixture({ capacity: 5 })

    for (let i = 0; i < 5; i++) {
      const r = await createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.tierId, quantity: 1 }],
        buyer: buyerInput(`seq-${i}`),
      })
      expect(r.status).toBe('awaiting_payment')
    }

    const [row] = await withSuperAdmin((db) =>
      db.select({ sold: ticketTiers.sold }).from(ticketTiers).where(eq(ticketTiers.id, fx.tierId)),
    )
    expect(row!.sold).toBe(5)

    // 6th attempt MUST fail.
    await expect(
      createOrder({
        eventId: fx.eventId,
        tierSelections: [{ tierId: fx.tierId, quantity: 1 }],
        buyer: buyerInput('seq-6-overflow'),
      }),
    ).rejects.toBeInstanceOf(InsufficientCapacityError)
  })

  it('multi-tier order: tier A + tier B both have capacity → both increment; sold tracked per tier', async () => {
    const fx = await seedFreshFixture({ capacity: 10, secondTierCapacity: 5 })

    const result = await createOrder({
      eventId: fx.eventId,
      tierSelections: [
        { tierId: fx.tierId, quantity: 2 },
        { tierId: fx.secondTierId!, quantity: 1 },
      ],
      buyer: buyerInput('multi'),
    })
    expect(result.status).toBe('awaiting_payment')

    const rows = await withSuperAdmin((db) =>
      db
        .select({ id: ticketTiers.id, sold: ticketTiers.sold })
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, fx.eventId)),
    )
    const byId = new Map(rows.map((r) => [r.id, r.sold]))
    expect(byId.get(fx.tierId)).toBe(2)
    expect(byId.get(fx.secondTierId!)).toBe(1)
  })

  it('multi-tier order: tier A available + tier B sold-out → whole order rejected; tier A sold UNCHANGED (tx rollback)', async () => {
    const fx = await seedFreshFixture({ capacity: 10, secondTierCapacity: 1 })

    // Pre-consume tier B's only seat.
    await createOrder({
      eventId: fx.eventId,
      tierSelections: [{ tierId: fx.secondTierId!, quantity: 1 }],
      buyer: buyerInput('pre-b'),
    })

    // Now try A:2 + B:1 — A available, B sold out. Whole order MUST fail; A's sold MUST stay 0.
    let caught: unknown
    try {
      await createOrder({
        eventId: fx.eventId,
        tierSelections: [
          { tierId: fx.tierId, quantity: 2 },
          { tierId: fx.secondTierId!, quantity: 1 },
        ],
        buyer: buyerInput('try-multi-partial'),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(InsufficientCapacityError)

    const rows = await withSuperAdmin((db) =>
      db
        .select({ id: ticketTiers.id, sold: ticketTiers.sold })
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, fx.eventId)),
    )
    const byId = new Map(rows.map((r) => [r.id, r.sold]))
    expect(byId.get(fx.tierId)).toBe(0) // A's sold rolled back — no partial state
    expect(byId.get(fx.secondTierId!)).toBe(1) // B's prior buyer still counts
  })

  it('multi-tier ORDER BY id deadlock-free: two concurrent orders touching {A,B} and {B,A} both succeed', async () => {
    // Without ORDER BY id in the FOR UPDATE, this scenario can
    // deadlock: order 1 acquires A waiting for B; order 2 acquires B
    // waiting for A. With ORDER BY id, both acquire in the same
    // canonical order (lower-id first) and serialise cleanly.
    const fx = await seedFreshFixture({ capacity: 5, secondTierCapacity: 5 })

    const [r1, r2] = await Promise.all([
      createOrder({
        eventId: fx.eventId,
        tierSelections: [
          { tierId: fx.tierId, quantity: 1 },
          { tierId: fx.secondTierId!, quantity: 1 },
        ],
        buyer: buyerInput('multi-1'),
      }).then(
        (ok) => ({ kind: 'ok' as const, result: ok }),
        (err: unknown) => ({ kind: 'err' as const, err }),
      ),
      createOrder({
        eventId: fx.eventId,
        tierSelections: [
          { tierId: fx.secondTierId!, quantity: 1 },
          { tierId: fx.tierId, quantity: 1 },
        ],
        buyer: buyerInput('multi-2'),
      }).then(
        (ok) => ({ kind: 'ok' as const, result: ok }),
        (err: unknown) => ({ kind: 'err' as const, err }),
      ),
    ])

    expect(r1.kind).toBe('ok')
    expect(r2.kind).toBe('ok')

    const rows = await withSuperAdmin((db) =>
      db
        .select({ id: ticketTiers.id, sold: ticketTiers.sold })
        .from(ticketTiers)
        .where(eq(ticketTiers.eventId, fx.eventId)),
    )
    const byId = new Map(rows.map((r) => [r.id, r.sold]))
    expect(byId.get(fx.tierId)).toBe(2)
    expect(byId.get(fx.secondTierId!)).toBe(2)
  })
})
