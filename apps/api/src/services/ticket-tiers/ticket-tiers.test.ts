/**
 * Ticket-tier service integration tests — Sprint 3 Day 25.
 *
 * Covers the five service-layer functions plus RLS cross-tenant
 * isolation per §24.3 + §4.4. Runs against the real Postgres test DB
 * (HAS_DB gate); skips cleanly in CI environments without one.
 *
 * Test surfaces:
 *
 *   1. createTier
 *      - happy path → row + audit
 *      - event not in tenant scope → TierEventNotFoundError
 *      - cross-tenant event id → TierEventNotFoundError (RLS hides it)
 *      - default values (sold=0, min=1, max=10, sort=0)
 *      - DB CHECKs enforced (complimentary + price>0 → fails)
 *
 *   2. getTier
 *      - returns row in same tenant
 *      - missing → TierNotFoundError
 *      - cross-tenant → TierNotFoundError (RLS hides it)
 *
 *   3. listTiersByEvent
 *      - active only by default
 *      - includeArchived=true returns all
 *      - ordering: sort_order asc, then created_at asc
 *      - other event's tiers not in result
 *
 *   4. updateTier
 *      - patch updates fields + audit
 *      - empty patch → no-op (no audit)
 *      - archived tier → TierArchivedError
 *      - missing → TierNotFoundError
 *
 *   5. archiveTier
 *      - sets archived_at + audit
 *      - already archived → TierArchivedError
 *      - missing → TierNotFoundError
 *
 *   6. RLS cross-tenant isolation
 *      - tenantA's tier not visible to tenantB
 *      - tenantA cannot UPDATE tenantB's tier
 *      - tenantA cannot DELETE tenantB's tier (zero rows affected)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin, withTenant } from '../../db/client.js'
import {
  auditLogs,
  events,
  tenantFeeConfig,
  tenants,
  ticketTiers,
  users,
} from '../../db/schema/index.js'
import {
  TierArchivedError,
  TierEventNotFoundError,
  TierNotFoundError,
  archiveTier,
  createTier,
  getTier,
  listTiersByEvent,
  updateTier,
} from './index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

interface Fixture {
  ownerId: string
  tenantAId: string
  tenantBId: string
  eventAId: string
  eventA2Id: string
  eventBId: string
}

const physicalVenue = {
  type: 'physical' as const,
  name: 'Test Venue',
  address: '12 Test Road',
  division: 'dhaka' as const,
  district: 'Dhaka',
}

const futureStart = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const futureEnd = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)

describeIfDb('ticket-tiers service — CRUD + RLS', () => {
  const fx: Fixture = {} as Fixture

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `tiers-test-owner-${Date.now()}@test.local`,
          fullName: 'Tiers Test Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const slugA = `tiers-test-tenant-a-${Date.now()}`
      const [a] = await db
        .insert(tenants)
        .values({
          name: 'Tiers Test Tenant A',
          slug: slugA,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantAId = a!.id

      const slugB = `tiers-test-tenant-b-${Date.now()}`
      const [b] = await db
        .insert(tenants)
        .values({
          name: 'Tiers Test Tenant B',
          slug: slugB,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantBId = b!.id

      // Three events: A1 + A2 in tenant A, B in tenant B.
      const [eventA] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantAId,
          slug: `tier-event-a-${Date.now()}`,
          type: 'concert',
          title: 'A1',
          startsAt: futureStart(),
          endsAt: futureEnd(),
          venue: physicalVenue,
          createdBy: fx.ownerId,
        })
        .returning({ id: events.id })
      fx.eventAId = eventA!.id

      const [eventA2] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantAId,
          slug: `tier-event-a2-${Date.now()}`,
          type: 'workshop',
          title: 'A2',
          startsAt: futureStart(),
          endsAt: futureEnd(),
          venue: physicalVenue,
          createdBy: fx.ownerId,
        })
        .returning({ id: events.id })
      fx.eventA2Id = eventA2!.id

      const [eventB] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantBId,
          slug: `tier-event-b-${Date.now()}`,
          type: 'concert',
          title: 'B',
          startsAt: futureStart(),
          endsAt: futureEnd(),
          venue: physicalVenue,
          createdBy: fx.ownerId,
        })
        .returning({ id: events.id })
      fx.eventBId = eventB!.id
    })
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      for (const tid of [fx.tenantAId, fx.tenantBId]) {
        if (!tid) continue
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tid))
        await db.delete(ticketTiers).where(eq(ticketTiers.tenantId, tid))
        await db.delete(events).where(eq(events.tenantId, tid))
        await db.delete(tenantFeeConfig).where(eq(tenantFeeConfig.tenantId, tid))
        await db.delete(tenants).where(eq(tenants.id, tid))
      }
      if (fx.ownerId) await db.delete(users).where(eq(users.id, fx.ownerId))
    })
    await resetPool()
  })

  beforeEach(async () => {
    // Fresh state per test: clear tiers + audit rows for both tenants.
    await withSuperAdmin(async (db) => {
      for (const tid of [fx.tenantAId, fx.tenantBId]) {
        if (!tid) continue
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tid))
        await db.delete(ticketTiers).where(eq(ticketTiers.tenantId, tid))
      }
    })
  })

  // ─── createTier ────────────────────────────────────────────────────

  describe('createTier', () => {
    it('inserts a tier + writes audit row in same tx', async () => {
      const tier = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'General Admission',
        pricePaisa: 50_000n,
        capacity: 100,
      })
      expect(tier.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(tier.pricePaisa).toBe(50_000n)
      expect(tier.capacity).toBe(100)
      expect(tier.sold).toBe(0)
      expect(tier.minPerOrder).toBe(1)
      expect(tier.maxPerOrder).toBe(10)
      expect(tier.isComplimentary).toBe(false)
      expect(tier.sortOrder).toBe(0)
      expect(tier.archivedAt).toBeNull()

      await withSuperAdmin(async (db) => {
        const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, tier.id))
        expect(audit).toHaveLength(1)
        expect(audit[0]!.action).toBe('ticket_tier.created')
        const diff = audit[0]!.diff as Record<string, unknown>
        expect(diff['price_paisa']).toBe('50000')
        expect(diff['capacity']).toBe(100)
      })
    })

    it('throws TierEventNotFoundError when event id does not belong to tenant', async () => {
      await expect(
        createTier({
          tenantId: fx.tenantAId,
          eventId: fx.eventBId, // tenant B's event
          actorUserId: fx.ownerId,
          name: 'General',
          pricePaisa: 50_000n,
          capacity: 100,
        }),
      ).rejects.toBeInstanceOf(TierEventNotFoundError)
    })

    it('rejects complimentary tier with price > 0 (DB CHECK)', async () => {
      await expect(
        createTier({
          tenantId: fx.tenantAId,
          eventId: fx.eventAId,
          actorUserId: fx.ownerId,
          name: 'Bad Comp',
          pricePaisa: 100n,
          capacity: 50,
          isComplimentary: true,
        }),
      ).rejects.toThrow()
    })

    it('allows complimentary tier with price = 0', async () => {
      const tier = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'Sponsor Comp',
        pricePaisa: 0n,
        capacity: 10,
        isComplimentary: true,
      })
      expect(tier.isComplimentary).toBe(true)
      expect(tier.pricePaisa).toBe(0n)
    })

    it('rejects max_per_order < min_per_order (DB CHECK)', async () => {
      await expect(
        createTier({
          tenantId: fx.tenantAId,
          eventId: fx.eventAId,
          actorUserId: fx.ownerId,
          name: 'Bad Limits',
          pricePaisa: 100n,
          capacity: 50,
          minPerOrder: 5,
          maxPerOrder: 3,
        }),
      ).rejects.toThrow()
    })

    it('rejects sales_end_at <= sales_start_at (DB CHECK)', async () => {
      const start = futureStart()
      await expect(
        createTier({
          tenantId: fx.tenantAId,
          eventId: fx.eventAId,
          actorUserId: fx.ownerId,
          name: 'Bad Window',
          pricePaisa: 100n,
          capacity: 50,
          salesStartAt: start,
          salesEndAt: start,
        }),
      ).rejects.toThrow()
    })
  })

  // ─── getTier ───────────────────────────────────────────────────────

  describe('getTier', () => {
    it('returns the tier in same tenant', async () => {
      const created = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A Tier',
        pricePaisa: 100n,
        capacity: 50,
      })
      const fetched = await getTier(fx.tenantAId, created.id)
      expect(fetched.id).toBe(created.id)
    })

    it('throws TierNotFoundError for missing tier id', async () => {
      await expect(
        getTier(fx.tenantAId, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toBeInstanceOf(TierNotFoundError)
    })

    it('throws TierNotFoundError when querying cross-tenant (RLS hides it)', async () => {
      const created = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A Tier',
        pricePaisa: 100n,
        capacity: 50,
      })
      // Tenant B asks for tenant A's tier — RLS filters it out.
      await expect(getTier(fx.tenantBId, created.id)).rejects.toBeInstanceOf(TierNotFoundError)
    })
  })

  // ─── listTiersByEvent ──────────────────────────────────────────────

  describe('listTiersByEvent', () => {
    it('returns only active tiers by default + sorts by sort_order then created_at', async () => {
      const t2 = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'VIP',
        pricePaisa: 200n,
        capacity: 20,
        sortOrder: 2,
      })
      const t1 = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'GA',
        pricePaisa: 100n,
        capacity: 100,
        sortOrder: 1,
      })
      const tArchived = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'Old',
        pricePaisa: 50n,
        capacity: 5,
        sortOrder: 0,
      })
      await archiveTier({
        tenantId: fx.tenantAId,
        tierId: tArchived.id,
        actorUserId: fx.ownerId,
      })

      const tiers = await listTiersByEvent(fx.tenantAId, fx.eventAId)
      expect(tiers.map((t) => t.id)).toEqual([t1.id, t2.id])
    })

    it('returns archived when includeArchived=true', async () => {
      const tArch = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'Archived',
        pricePaisa: 10n,
        capacity: 5,
      })
      await archiveTier({
        tenantId: fx.tenantAId,
        tierId: tArch.id,
        actorUserId: fx.ownerId,
      })

      const tiers = await listTiersByEvent(fx.tenantAId, fx.eventAId, { includeArchived: true })
      expect(tiers).toHaveLength(1)
      expect(tiers[0]!.archivedAt).not.toBeNull()
    })

    it("does not return another event's tiers", async () => {
      await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A1 tier',
        pricePaisa: 100n,
        capacity: 10,
      })
      const tiers = await listTiersByEvent(fx.tenantAId, fx.eventA2Id)
      expect(tiers).toHaveLength(0)
    })
  })

  // ─── updateTier ────────────────────────────────────────────────────

  describe('updateTier', () => {
    it('updates listed fields + writes audit with changed_fields', async () => {
      const created = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'GA',
        pricePaisa: 100n,
        capacity: 100,
      })
      const updated = await updateTier({
        tenantId: fx.tenantAId,
        tierId: created.id,
        actorUserId: fx.ownerId,
        patch: { name: 'GA — Updated', pricePaisa: 150n, capacity: 200 },
      })
      expect(updated.name).toBe('GA — Updated')
      expect(updated.pricePaisa).toBe(150n)
      expect(updated.capacity).toBe(200)

      await withSuperAdmin(async (db) => {
        const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id))
        // 2 rows: created + updated
        expect(audit).toHaveLength(2)
        const upd = audit.find((r) => r.action === 'ticket_tier.updated')
        expect(upd).toBeDefined()
        const diff = upd!.diff as Record<string, unknown>
        expect(diff['changed_fields']).toEqual(['name', 'price_paisa', 'capacity'])
      })
    })

    it('empty patch is a no-op (no audit row)', async () => {
      const created = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A',
        pricePaisa: 100n,
        capacity: 10,
      })
      await updateTier({
        tenantId: fx.tenantAId,
        tierId: created.id,
        actorUserId: fx.ownerId,
        patch: {},
      })
      await withSuperAdmin(async (db) => {
        const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id))
        expect(audit).toHaveLength(1) // just the created row, no update
      })
    })

    it('rejects update on archived tier', async () => {
      const created = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A',
        pricePaisa: 100n,
        capacity: 10,
      })
      await archiveTier({
        tenantId: fx.tenantAId,
        tierId: created.id,
        actorUserId: fx.ownerId,
      })
      await expect(
        updateTier({
          tenantId: fx.tenantAId,
          tierId: created.id,
          actorUserId: fx.ownerId,
          patch: { name: 'Cannot' },
        }),
      ).rejects.toBeInstanceOf(TierArchivedError)
    })

    it('throws TierNotFoundError for missing tier', async () => {
      await expect(
        updateTier({
          tenantId: fx.tenantAId,
          tierId: '00000000-0000-0000-0000-000000000000',
          actorUserId: fx.ownerId,
          patch: { name: 'X' },
        }),
      ).rejects.toBeInstanceOf(TierNotFoundError)
    })
  })

  // ─── archiveTier ───────────────────────────────────────────────────

  describe('archiveTier', () => {
    it('sets archived_at + audit', async () => {
      const created = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A',
        pricePaisa: 100n,
        capacity: 10,
      })
      const archived = await archiveTier({
        tenantId: fx.tenantAId,
        tierId: created.id,
        actorUserId: fx.ownerId,
        reason: 'replaced by GA-v2',
      })
      expect(archived.archivedAt).not.toBeNull()

      await withSuperAdmin(async (db) => {
        const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, created.id))
        const arch = audit.find((r) => r.action === 'ticket_tier.archived')
        expect(arch).toBeDefined()
        const diff = arch!.diff as Record<string, unknown>
        expect(diff['reason']).toBe('replaced by GA-v2')
      })
    })

    it('throws TierArchivedError when already archived', async () => {
      const created = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A',
        pricePaisa: 100n,
        capacity: 10,
      })
      await archiveTier({
        tenantId: fx.tenantAId,
        tierId: created.id,
        actorUserId: fx.ownerId,
      })
      await expect(
        archiveTier({
          tenantId: fx.tenantAId,
          tierId: created.id,
          actorUserId: fx.ownerId,
        }),
      ).rejects.toBeInstanceOf(TierArchivedError)
    })
  })

  // ─── RLS cross-tenant isolation ────────────────────────────────────

  describe('RLS cross-tenant isolation', () => {
    it("tenant A's tier is not visible to tenant B", async () => {
      const aTier = await createTier({
        tenantId: fx.tenantAId,
        eventId: fx.eventAId,
        actorUserId: fx.ownerId,
        name: 'A only',
        pricePaisa: 100n,
        capacity: 10,
      })
      await withTenant(fx.tenantBId, async (tx) => {
        const rows = await tx.select().from(ticketTiers).where(eq(ticketTiers.id, aTier.id))
        expect(rows).toHaveLength(0)
      })
    })

    it('tenant A cannot UPDATE tenant B-owned tier (RLS-zero-rows)', async () => {
      const bTier = await withSuperAdmin(async (tx) => {
        const [row] = await tx
          .insert(ticketTiers)
          .values({
            tenantId: fx.tenantBId,
            eventId: fx.eventBId,
            name: 'B only',
            pricePaisa: 100n,
            capacity: 10,
          })
          .returning({ id: ticketTiers.id })
        return row!.id
      })

      const updated = await withTenant(fx.tenantAId, async (tx) => {
        return tx
          .update(ticketTiers)
          .set({ name: 'hacked' })
          .where(eq(ticketTiers.id, bTier))
          .returning()
      })
      expect(updated).toHaveLength(0)

      // Confirm B's tier name unchanged when viewed via super-admin.
      await withSuperAdmin(async (db) => {
        const rows = await db.select().from(ticketTiers).where(eq(ticketTiers.id, bTier))
        expect(rows[0]!.name).toBe('B only')
      })
    })

    it('tenant A cannot DELETE tenant B-owned tier (RLS-zero-rows)', async () => {
      const bTier = await withSuperAdmin(async (tx) => {
        const [row] = await tx
          .insert(ticketTiers)
          .values({
            tenantId: fx.tenantBId,
            eventId: fx.eventBId,
            name: 'B undeletable',
            pricePaisa: 100n,
            capacity: 10,
          })
          .returning({ id: ticketTiers.id })
        return row!.id
      })

      const deleted = await withTenant(fx.tenantAId, async (tx) => {
        return tx.delete(ticketTiers).where(eq(ticketTiers.id, bTier)).returning()
      })
      expect(deleted).toHaveLength(0)

      // Confirm B's tier still exists.
      await withSuperAdmin(async (db) => {
        const rows = await db.select().from(ticketTiers).where(eq(ticketTiers.id, bTier))
        expect(rows).toHaveLength(1)
      })
    })
  })
})
