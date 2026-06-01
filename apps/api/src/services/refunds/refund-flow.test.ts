/**
 * Refund-flow service integration tests — Day 41 Sprint 4.
 *
 * DB-gated (skip cleanly when DATABASE_URL is absent). Covers the four
 * service functions + their state-machine, cross-tenant, and refund-
 * status guard rails:
 *
 *   1. requestRefund   — happy path + cross-tenant + invalid-transition
 *                        + already-requested guards
 *   2. approveRefund   — happy path + idempotency (re-approve fails) +
 *                        not-found
 *   3. rejectRefund    — happy path (refund→rejected, order→paid
 *                        rollback) + idempotency + invalid-state
 *   4. markRefundProcessed — happy path (refund→processed, order→
 *                            refunded) + idempotency + invalid-state
 *
 * Each test starts from a freshly-inserted order in `paid` state and
 * exercises a specific transition or guard. Tests are independent: the
 * `seed` suffix is unique per suite run, so parallel CI workers don't
 * collide on the schema-global tables.
 *
 * No EPS network calls — refund flow is entirely platform-side
 * accounting per §11.4 (V5 has no public refund API).
 */

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import {
  auditLogs,
  events,
  orderEvents,
  orders,
  refunds,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'
import { approveRefund, markRefundProcessed, rejectRefund, requestRefund } from './refund-flow.js'

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
  adminUserId: string
  tenantId: string
  /** A second tenant used for cross-tenant tests. */
  otherTenantId: string
  eventId: string
  tierId: string
}

describeIfDb('refund-flow service — Day 41 Sprint 4', () => {
  const fx: Fixture = {} as Fixture
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({ email: `refund-svc-owner-${seed}@test.local`, fullName: 'Refund Svc Owner' })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const [admin] = await db
        .insert(users)
        .values({ email: `refund-svc-admin-${seed}@test.local`, fullName: 'Refund Svc Admin' })
        .returning({ id: users.id })
      fx.adminUserId = admin!.id

      const [tenantA] = await db
        .insert(tenants)
        .values({
          name: 'Refund Svc Tenant A',
          slug: `refund-svc-tenant-a-${seed}`,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantId = tenantA!.id

      const [tenantB] = await db
        .insert(tenants)
        .values({
          name: 'Refund Svc Tenant B (cross-tenant test)',
          slug: `refund-svc-tenant-b-${seed}`,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.otherTenantId = tenantB!.id

      const [evt] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantId,
          slug: `refund-svc-event-${seed}`,
          type: 'concert',
          title: 'Refund Svc Event',
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

  /**
   * Insert a fresh `paid` order owned by the fixture tenant + return
   * its id + totalPaisa. Each test calls this to get an isolated order
   * to mutate; parallel orders don't collide because each gets a
   * unique merchantTransactionId.
   */
  async function seedPaidOrder(suffix: string): Promise<{ orderId: string; totalPaisa: bigint }> {
    return withSuperAdmin(async (db) => {
      const [o] = await db
        .insert(orders)
        .values({
          tenantId: fx.tenantId,
          eventId: fx.eventId,
          merchantTransactionId: `TXN-${seed}-${suffix}`,
          buyerName: 'Test Buyer',
          buyerEmail: `buyer-${suffix}@test.local`,
          buyerPhone: '+8801700000000',
          subtotalPaisa: 100_000n,
          epsFeePaisa: 1754n,
          platformFeePaisa: 250n,
          totalPaisa: 102_004n,
          netToOrganiserPaisa: 100_000n,
          platformFeeBps: 25,
          epsFeeBps: 175,
          platformFeeHandling: 'pass_through',
          epsFeeHandling: 'pass_through',
          status: 'paid',
          epsTransactionId: `EPS-${suffix}`,
          epsPaymentMethod: 'bKash',
          epsVerifiedAt: new Date(),
        })
        .returning({ id: orders.id, totalPaisa: orders.totalPaisa })
      return { orderId: o!.id, totalPaisa: o!.totalPaisa }
    })
  }

  describe('requestRefund (tenant-initiated)', () => {
    it('happy path — paid → refund_requested + refunds row + audit + order_events', async () => {
      const { orderId, totalPaisa } = await seedPaidOrder('rr-happy')

      const result = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Buyer no longer attending the event due to schedule conflict',
        reasonCode: 'tenant_requested',
        ip: '203.0.113.10',
        userAgent: 'refund-flow-test/1.0',
      })

      expect(result.kind).toBe('requested')
      if (result.kind !== 'requested') return
      expect(result.amountPaisa).toBe(totalPaisa)

      const [orderRow] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)),
      )
      expect(orderRow!.status).toBe('refund_requested')

      const [refundRow] = await withSuperAdmin((db) =>
        db
          .select({
            status: refunds.status,
            amountPaisa: refunds.amountPaisa,
            reasonCode: refunds.reasonCode,
            initiatedBy: refunds.initiatedBy,
          })
          .from(refunds)
          .where(eq(refunds.id, result.refundId)),
      )
      expect(refundRow!.status).toBe('pending')
      expect(refundRow!.amountPaisa).toBe(totalPaisa)
      expect(refundRow!.reasonCode).toBe('tenant_requested')
      expect(refundRow!.initiatedBy).toBe(fx.ownerId)

      const events_ = await withSuperAdmin((db) =>
        db
          .select({ eventType: orderEvents.eventType })
          .from(orderEvents)
          .where(eq(orderEvents.orderId, orderId)),
      )
      expect(events_.some((e) => e.eventType === 'order.refund_requested')).toBe(true)

      const audits = await withSuperAdmin((db) =>
        db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, orderId)),
      )
      expect(audits.some((a) => a.action === 'order.refund_requested')).toBe(true)
    })

    it('cross-tenant — other tenant cannot request refund on our order', async () => {
      const { orderId } = await seedPaidOrder('rr-xt')

      const result = await requestRefund({
        orderId,
        tenantId: fx.otherTenantId, // wrong tenant
        initiatedBy: fx.ownerId,
        reason: 'Cross-tenant attempt — should be denied',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })

      expect(result.kind).toBe('cross_tenant')

      const [orderRow] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)),
      )
      expect(orderRow!.status).toBe('paid') // order untouched
    })

    it('invalid_transition — cannot request refund on already-refunded order', async () => {
      const { orderId } = await seedPaidOrder('rr-already')
      // Force the order to refunded (skip the full flow for this test).
      await withSuperAdmin((db) =>
        db.update(orders).set({ status: 'refunded' }).where(eq(orders.id, orderId)),
      )

      const result = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Should fail — already refunded',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })

      expect(result.kind).toBe('invalid_transition')
    })

    it('already_requested — duplicate pending request rejected with existing refundId', async () => {
      const { orderId } = await seedPaidOrder('rr-dup')

      const first = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'First request',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      expect(first.kind).toBe('requested')

      // Reset orders.status to 'paid' to bypass the state-machine guard
      // and exercise the already-requested defensive check.
      await withSuperAdmin((db) =>
        db.update(orders).set({ status: 'paid' }).where(eq(orders.id, orderId)),
      )

      const second = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Second request',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })

      expect(second.kind).toBe('already_requested')
      if (second.kind === 'already_requested' && first.kind === 'requested') {
        expect(second.existingRefundId).toBe(first.refundId)
      }
    })
  })

  describe('approveRefund (super-admin)', () => {
    it('happy path — refunds.status pending → approved; orders unchanged', async () => {
      const { orderId } = await seedPaidOrder('app-happy')
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Buyer requested refund',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      if (req.kind !== 'requested') throw new Error('seed failed')

      const result = await approveRefund({
        refundId: req.refundId,
        approvedBy: fx.adminUserId,
        superAdminNotes: 'Looks legitimate; approved.',
      })

      expect(result.kind).toBe('approved')

      const [refundRow] = await withSuperAdmin((db) =>
        db
          .select({
            status: refunds.status,
            approvedBy: refunds.approvedBy,
            approvedAt: refunds.approvedAt,
            superAdminNotes: refunds.superAdminNotes,
          })
          .from(refunds)
          .where(eq(refunds.id, req.refundId)),
      )
      expect(refundRow!.status).toBe('approved')
      expect(refundRow!.approvedBy).toBe(fx.adminUserId)
      expect(refundRow!.approvedAt).not.toBeNull()
      expect(refundRow!.superAdminNotes).toBe('Looks legitimate; approved.')

      // Order stays at refund_requested until mark-processed fires.
      const [orderRow] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)),
      )
      expect(orderRow!.status).toBe('refund_requested')
    })

    it('idempotency — second approve on same refund returns invalid_refund_state', async () => {
      const { orderId } = await seedPaidOrder('app-idem')
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Idempotency test',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      if (req.kind !== 'requested') throw new Error('seed failed')

      const first = await approveRefund({
        refundId: req.refundId,
        approvedBy: fx.adminUserId,
        superAdminNotes: null,
      })
      expect(first.kind).toBe('approved')

      const second = await approveRefund({
        refundId: req.refundId,
        approvedBy: fx.adminUserId,
        superAdminNotes: null,
      })
      expect(second.kind).toBe('invalid_refund_state')
      if (second.kind === 'invalid_refund_state') {
        expect(second.currentStatus).toBe('approved')
      }
    })

    it('not_found — bogus refundId returns kind=not_found', async () => {
      const result = await approveRefund({
        refundId: '00000000-0000-0000-0000-000000000000',
        approvedBy: fx.adminUserId,
        superAdminNotes: null,
      })
      expect(result.kind).toBe('not_found')
    })
  })

  describe('rejectRefund (super-admin)', () => {
    it('happy path — refunds.status pending → rejected; orders.status refund_requested → paid', async () => {
      const { orderId } = await seedPaidOrder('rj-happy')
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Buyer requested refund',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      if (req.kind !== 'requested') throw new Error('seed failed')

      const result = await rejectRefund({
        refundId: req.refundId,
        rejectedBy: fx.adminUserId,
        superAdminNotes: 'Buyer attended the event per check-in log; refund not justified.',
      })

      expect(result.kind).toBe('rejected')
      if (result.kind !== 'rejected') return
      expect(result.orderRolledBackTo).toBe('paid')

      const [refundRow] = await withSuperAdmin((db) =>
        db
          .select({
            status: refunds.status,
            rejectedBy: refunds.rejectedBy,
            superAdminNotes: refunds.superAdminNotes,
          })
          .from(refunds)
          .where(eq(refunds.id, req.refundId)),
      )
      expect(refundRow!.status).toBe('rejected')
      expect(refundRow!.rejectedBy).toBe(fx.adminUserId)
      expect(refundRow!.superAdminNotes).toMatch(/check-in log/)

      const [orderRow] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)),
      )
      expect(orderRow!.status).toBe('paid') // rolled back from refund_requested
    })

    it('idempotency — cannot reject already-approved refund', async () => {
      const { orderId } = await seedPaidOrder('rj-idem')
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Approve-then-reject test',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      if (req.kind !== 'requested') throw new Error('seed failed')

      await approveRefund({
        refundId: req.refundId,
        approvedBy: fx.adminUserId,
        superAdminNotes: null,
      })

      const result = await rejectRefund({
        refundId: req.refundId,
        rejectedBy: fx.adminUserId,
        superAdminNotes: 'Trying to reject after approve — should be blocked.',
      })

      expect(result.kind).toBe('invalid_refund_state')
      if (result.kind === 'invalid_refund_state') {
        expect(result.currentStatus).toBe('approved')
      }
    })
  })

  describe('markRefundProcessed (super-admin)', () => {
    it('happy path — refunds approved → processed; orders refund_requested → refunded', async () => {
      const { orderId } = await seedPaidOrder('mp-happy')
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Buyer requested refund',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      if (req.kind !== 'requested') throw new Error('seed failed')

      await approveRefund({
        refundId: req.refundId,
        approvedBy: fx.adminUserId,
        superAdminNotes: 'Approved.',
      })

      const result = await markRefundProcessed({
        refundId: req.refundId,
        processedBy: fx.adminUserId,
      })

      expect(result.kind).toBe('processed')

      const [refundRow] = await withSuperAdmin((db) =>
        db
          .select({
            status: refunds.status,
            processedBy: refunds.processedBy,
            processedAt: refunds.processedAt,
          })
          .from(refunds)
          .where(eq(refunds.id, req.refundId)),
      )
      expect(refundRow!.status).toBe('processed')
      expect(refundRow!.processedBy).toBe(fx.adminUserId)
      expect(refundRow!.processedAt).not.toBeNull()

      const [orderRow] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)),
      )
      expect(orderRow!.status).toBe('refunded')

      // order.refunded audit row exists.
      const audits = await withSuperAdmin((db) =>
        db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, orderId)),
      )
      expect(audits.some((a) => a.action === 'order.refunded')).toBe(true)
    })

    it('invalid_refund_state — cannot mark-processed without prior approve', async () => {
      const { orderId } = await seedPaidOrder('mp-not-approved')
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'No approve yet',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      if (req.kind !== 'requested') throw new Error('seed failed')

      const result = await markRefundProcessed({
        refundId: req.refundId,
        processedBy: fx.adminUserId,
      })

      expect(result.kind).toBe('invalid_refund_state')
      if (result.kind === 'invalid_refund_state') {
        expect(result.currentStatus).toBe('pending')
      }
    })

    it('idempotency — cannot mark-processed twice (status becomes processed terminal)', async () => {
      const { orderId } = await seedPaidOrder('mp-idem')
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Idempotency test',
        reasonCode: 'tenant_requested',
        ip: null,
        userAgent: null,
      })
      if (req.kind !== 'requested') throw new Error('seed failed')

      await approveRefund({
        refundId: req.refundId,
        approvedBy: fx.adminUserId,
        superAdminNotes: null,
      })
      await markRefundProcessed({
        refundId: req.refundId,
        processedBy: fx.adminUserId,
      })

      const second = await markRefundProcessed({
        refundId: req.refundId,
        processedBy: fx.adminUserId,
      })
      expect(second.kind).toBe('invalid_refund_state')
      if (second.kind === 'invalid_refund_state') {
        expect(second.currentStatus).toBe('processed')
      }
    })
  })

  describe('full lifecycle', () => {
    it('paid → request → approve → mark-processed yields full audit + state trail', async () => {
      const { orderId } = await seedPaidOrder('lc-full')

      // 1. tenant requests
      const req = await requestRefund({
        orderId,
        tenantId: fx.tenantId,
        initiatedBy: fx.ownerId,
        reason: 'Buyer cannot attend',
        reasonCode: 'tenant_requested',
        ip: '198.51.100.1',
        userAgent: 'tenant-portal/1.0',
      })
      if (req.kind !== 'requested') throw new Error('request failed')

      // 2. super-admin approves
      const app = await approveRefund({
        refundId: req.refundId,
        approvedBy: fx.adminUserId,
        superAdminNotes: 'Approved.',
      })
      expect(app.kind).toBe('approved')

      // 3. (EPS dashboard refund happens out-of-band)
      // 4. super-admin marks processed
      const proc = await markRefundProcessed({
        refundId: req.refundId,
        processedBy: fx.adminUserId,
      })
      expect(proc.kind).toBe('processed')

      // Verify the audit log captured all 3 state-changing actions.
      const audits = await withSuperAdmin((db) =>
        db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, orderId)),
      )
      const refundAudits = await withSuperAdmin((db) =>
        db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, req.refundId)),
      )
      const actions = new Set([...audits, ...refundAudits].map((a) => a.action))
      expect(actions.has('order.refund_requested')).toBe(true)
      expect(actions.has('refund.approved')).toBe(true)
      expect(actions.has('order.refunded')).toBe(true)

      // Final order state.
      const [finalOrder] = await withSuperAdmin((db) =>
        db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)),
      )
      expect(finalOrder!.status).toBe('refunded')

      // Final refund state.
      const [finalRefund] = await withSuperAdmin((db) =>
        db
          .select({
            status: refunds.status,
            approvedBy: refunds.approvedBy,
            processedBy: refunds.processedBy,
          })
          .from(refunds)
          .where(eq(refunds.id, req.refundId)),
      )
      expect(finalRefund!.status).toBe('processed')
      expect(finalRefund!.approvedBy).toBe(fx.adminUserId)
      expect(finalRefund!.processedBy).toBe(fx.adminUserId)
    })
  })

  // Cleanup at the very end — TRUNCATE everything we created so
  // re-runs don't accumulate state. The CI's transactional Postgres
  // doesn't auto-clean these schema-global tables.
  it('cleanup', async () => {
    await withSuperAdmin(async (db) => {
      await db.execute(
        sql`DELETE FROM audit_logs WHERE tenant_id IN (${sql.raw(`'${fx.tenantId}'`)}, ${sql.raw(`'${fx.otherTenantId}'`)})`,
      )
      await db.delete(orderEvents).where(eq(orderEvents.tenantId, fx.tenantId))
      await db.delete(refunds).where(eq(refunds.tenantId, fx.tenantId))
      await db.delete(orders).where(eq(orders.tenantId, fx.tenantId))
      await db.delete(ticketTiers).where(eq(ticketTiers.tenantId, fx.tenantId))
      await db.delete(events).where(eq(events.tenantId, fx.tenantId))
      await db.delete(tenants).where(eq(tenants.id, fx.tenantId))
      await db.delete(tenants).where(eq(tenants.id, fx.otherTenantId))
      await db.delete(users).where(eq(users.id, fx.ownerId))
      await db.delete(users).where(eq(users.id, fx.adminUserId))
    })
  })
})
