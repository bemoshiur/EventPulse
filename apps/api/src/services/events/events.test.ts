/**
 * Event service integration tests — Sprint 3 Day 23 Workstream 1.
 *
 * Covers the six service-layer functions plus the RLS cross-tenant
 * isolation invariant per §24.3 + §4.4. Runs against the real Postgres
 * test DB (HAS_DB gate); skips cleanly in CI environments without one.
 *
 * Test surfaces:
 *
 *   1. createEvent
 *      - happy path → draft + slug + fee-mode snapshot from tenant_fee_config
 *      - explicit fee-mode override (caller-supplied wins over config)
 *      - missing tenant_fee_config row → falls back to 'pass_through'
 *      - title collision → -2 suffix
 *
 *   2. listEvents
 *      - returns all non-deleted, ordered by starts_at asc
 *      - status filter
 *      - cursor pagination
 *
 *   3. getEvent
 *      - returns full detail
 *      - deleted event → EventNotFoundError
 *
 *   4. updateEvent
 *      - patch draft → fields updated + audit row
 *      - patch sold_out → EventInvalidStatusForEditError
 *      - empty patch → no-op
 *
 *   5. transitionEvent
 *      - draft → published → sets published_at + audit
 *      - draft → live (skip) → EventInvalidTransitionError
 *      - archived → anything → EventInvalidTransitionError
 *
 *   6. softDeleteEvent
 *      - sets deleted_at + audit
 *      - deleted event not in list
 *      - deleted event not in get
 *
 *   7. RLS cross-tenant isolation
 *      - tenantA's event not visible to tenantB
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

import { resetPool, withSuperAdmin, withTenant } from '../../db/client.js'
import { auditLogs, events, tenantFeeConfig, tenants, users } from '../../db/schema/index.js'
import {
  EventInvalidStatusForEditError,
  EventInvalidTransitionError,
  EventNotFoundError,
  createEvent,
  getEvent,
  listEvents,
  softDeleteEvent,
  transitionEvent,
  updateEvent,
} from './index.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

interface Fixture {
  ownerId: string
  tenantAId: string
  tenantASlug: string
  tenantBId: string
  tenantBSlug: string
}

const physicalVenue = {
  type: 'physical' as const,
  name: 'Dhaka Auditorium',
  address: '12 Mirpur Road',
  division: 'dhaka' as const,
  district: 'Dhaka',
}

const futureStart = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const futureEnd = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)

describeIfDb('events service — CRUD + state machine + RLS', () => {
  const fx: Fixture = {} as Fixture

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `events-test-owner-${Date.now()}@test.local`,
          fullName: 'Events Test Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      const slugA = `events-test-tenant-a-${Date.now()}`
      const [a] = await db
        .insert(tenants)
        .values({
          name: 'Events Test Tenant A',
          slug: slugA,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantAId = a!.id
      fx.tenantASlug = slugA

      const slugB = `events-test-tenant-b-${Date.now()}`
      const [b] = await db
        .insert(tenants)
        .values({
          name: 'Events Test Tenant B',
          slug: slugB,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      fx.tenantBId = b!.id
      fx.tenantBSlug = slugB

      // tenant_fee_config row for tenantA only — tenantB intentionally
      // missing to exercise the "no config row → fallback to pass_through"
      // path in createEvent.
      await db.insert(tenantFeeConfig).values({
        tenantId: fx.tenantAId,
        defaultFeeMode: 'absorb',
      })
    })
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      // Clean audit rows + events for both tenants, then tenants, then user.
      for (const tid of [fx.tenantAId, fx.tenantBId]) {
        if (!tid) continue
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tid))
        await db.delete(events).where(eq(events.tenantId, tid))
        await db.delete(tenantFeeConfig).where(eq(tenantFeeConfig.tenantId, tid))
        await db.delete(tenants).where(eq(tenants.id, tid))
      }
      if (fx.ownerId) await db.delete(users).where(eq(users.id, fx.ownerId))
    })
    await resetPool()
  })

  beforeEach(async () => {
    // Fresh state per test: nuke events + audit rows for both tenants.
    await withSuperAdmin(async (db) => {
      for (const tid of [fx.tenantAId, fx.tenantBId]) {
        if (!tid) continue
        await db.delete(auditLogs).where(eq(auditLogs.tenantId, tid))
        await db.delete(events).where(eq(events.tenantId, tid))
      }
    })
  })

  // ─── createEvent ────────────────────────────────────────────────────

  describe('createEvent', () => {
    it('creates a draft event with slug from title + audit row', async () => {
      const result = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Summer Sounds 2026',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      expect(result.status).toBe('draft')
      expect(result.slug).toBe('summer-sounds-2026')
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/)

      await withSuperAdmin(async (db) => {
        const audit = await db
          .select({ action: auditLogs.action, diff: auditLogs.diff })
          .from(auditLogs)
          .where(
            and(eq(auditLogs.tenantId, fx.tenantAId), eq(auditLogs.entityId, result.id)),
          )
        expect(audit).toHaveLength(1)
        expect(audit[0]?.action).toBe('event.created')
        const diff = audit[0]?.diff as { event_type: string; initial_status: string }
        expect(diff.event_type).toBe('concert')
        expect(diff.initial_status).toBe('draft')
      })
    })

    it('snapshots fee mode from tenant_fee_config when caller omits', async () => {
      const result = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Fee Snapshot From Config',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      const detail = await getEvent({ tenantId: fx.tenantAId, eventId: result.id })
      // tenant_fee_config.default_fee_mode = 'absorb' for tenantA.
      expect(detail.platformFeeHandling).toBe('absorb')
      expect(detail.epsFeeHandling).toBe('absorb')
    })

    it('caller-supplied fee mode overrides tenant_fee_config snapshot', async () => {
      const result = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Fee Snapshot Caller Override',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
        platformFeeHandling: 'pass_through',
        epsFeeHandling: 'pass_through',
      })
      const detail = await getEvent({ tenantId: fx.tenantAId, eventId: result.id })
      expect(detail.platformFeeHandling).toBe('pass_through')
      expect(detail.epsFeeHandling).toBe('pass_through')
    })

    it("falls back to 'pass_through' when tenant has no fee config row", async () => {
      const result = await createEvent({
        tenantId: fx.tenantBId,
        actorUserId: fx.ownerId,
        type: 'workshop',
        title: 'No Fee Config Fallback',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      const detail = await getEvent({ tenantId: fx.tenantBId, eventId: result.id })
      expect(detail.platformFeeHandling).toBe('pass_through')
      expect(detail.epsFeeHandling).toBe('pass_through')
    })

    it('adds a numeric suffix on slug collision', async () => {
      await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'conference',
        title: 'Same Title',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      const second = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'conference',
        title: 'Same Title',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      expect(second.slug).toBe('same-title-2')
    })
  })

  // ─── listEvents ─────────────────────────────────────────────────────

  describe('listEvents', () => {
    it('returns non-deleted events ordered by starts_at asc', async () => {
      const later = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Later Event',
        startsAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
        venue: physicalVenue,
      })
      const sooner = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Sooner Event',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      const result = await listEvents({ tenantId: fx.tenantAId })
      expect(result.items.map((i) => i.id)).toEqual([sooner.id, later.id])
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('filters by status', async () => {
      const draft = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Draft Filter',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      const published = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Will Be Published',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      await transitionEvent({
        tenantId: fx.tenantAId,
        eventId: published.id,
        actorUserId: fx.ownerId,
        toState: 'published',
      })
      const draftsOnly = await listEvents({ tenantId: fx.tenantAId, status: 'draft' })
      expect(draftsOnly.items.map((i) => i.id)).toEqual([draft.id])
      const pubOnly = await listEvents({ tenantId: fx.tenantAId, status: 'published' })
      expect(pubOnly.items.map((i) => i.id)).toEqual([published.id])
    })

    it('paginates via cursor', async () => {
      // 3 events with strictly increasing starts_at
      for (let i = 0; i < 3; i++) {
        await createEvent({
          tenantId: fx.tenantAId,
          actorUserId: fx.ownerId,
          type: 'workshop',
          title: `Pagination ${i}`,
          startsAt: new Date(Date.now() + (10 + i) * 24 * 60 * 60 * 1000),
          endsAt: new Date(Date.now() + (10 + i) * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
          venue: physicalVenue,
        })
      }
      const page1 = await listEvents({ tenantId: fx.tenantAId, limit: 2 })
      expect(page1.items).toHaveLength(2)
      expect(page1.hasMore).toBe(true)
      expect(page1.nextCursor).not.toBeNull()
      const page2 = await listEvents({
        tenantId: fx.tenantAId,
        limit: 2,
        cursor: page1.nextCursor!,
      })
      expect(page2.items).toHaveLength(1)
      expect(page2.hasMore).toBe(false)
      // No overlap between pages.
      const page1Ids = new Set(page1.items.map((i) => i.id))
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false)
      }
    })
  })

  // ─── getEvent ──────────────────────────────────────────────────────

  describe('getEvent', () => {
    it('returns full detail', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'standup',
        title: 'Detail Fetch',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
        capacity: 150,
      })
      const detail = await getEvent({ tenantId: fx.tenantAId, eventId: created.id })
      expect(detail.id).toBe(created.id)
      expect(detail.type).toBe('standup')
      expect(detail.capacity).toBe(150)
      expect(detail.timezone).toBe('Asia/Dhaka')
      expect(detail.venue).toMatchObject({ type: 'physical', name: 'Dhaka Auditorium' })
    })

    it('throws EventNotFoundError for missing id', async () => {
      await expect(
        getEvent({ tenantId: fx.tenantAId, eventId: '00000000-0000-0000-0000-000000000099' }),
      ).rejects.toBeInstanceOf(EventNotFoundError)
    })
  })

  // ─── updateEvent ───────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('patches draft event + writes changed_fields audit', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Original Title',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      await updateEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
        patch: { title: 'Renamed', capacity: 250 },
      })
      const after = await getEvent({ tenantId: fx.tenantAId, eventId: created.id })
      expect(after.title).toBe('Renamed')
      expect(after.capacity).toBe(250)

      await withSuperAdmin(async (db) => {
        const audit = await db
          .select({ action: auditLogs.action, diff: auditLogs.diff })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, fx.tenantAId),
              eq(auditLogs.entityId, created.id),
              eq(auditLogs.action, 'event.updated'),
            ),
          )
        expect(audit).toHaveLength(1)
        const diff = audit[0]?.diff as { changed_fields: string[] }
        expect(diff.changed_fields.sort()).toEqual(['capacity', 'title'])
      })
    })

    it('empty patch is a no-op (no audit row)', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'No-op Patch',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      await updateEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
        patch: {},
      })
      await withSuperAdmin(async (db) => {
        const audit = await db
          .select({ action: auditLogs.action })
          .from(auditLogs)
          .where(
            and(eq(auditLogs.tenantId, fx.tenantAId), eq(auditLogs.entityId, created.id)),
          )
        // Only the create audit; no updated row.
        expect(audit.map((a) => a.action)).toEqual(['event.created'])
      })
    })

    it('rejects PATCH on non-editable status with EventInvalidStatusForEditError', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Not Editable',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      // Drive to sold_out via the legal chain.
      await transitionEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
        toState: 'published',
      })
      await transitionEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
        toState: 'on_sale',
      })
      await transitionEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
        toState: 'sold_out',
      })

      await expect(
        updateEvent({
          tenantId: fx.tenantAId,
          eventId: created.id,
          actorUserId: fx.ownerId,
          patch: { title: 'Should Be Rejected' },
        }),
      ).rejects.toBeInstanceOf(EventInvalidStatusForEditError)
    })
  })

  // ─── transitionEvent ───────────────────────────────────────────────

  describe('transitionEvent', () => {
    it('draft → published sets published_at + writes audit', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Publish Me',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      const result = await transitionEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
        toState: 'published',
      })
      expect(result.fromStatus).toBe('draft')
      expect(result.toStatus).toBe('published')
      expect(result.publishedAt).toBeInstanceOf(Date)

      const detail = await getEvent({ tenantId: fx.tenantAId, eventId: created.id })
      expect(detail.status).toBe('published')
      expect(detail.publishedAt).not.toBeNull()

      await withSuperAdmin(async (db) => {
        const audit = await db
          .select({ action: auditLogs.action, diff: auditLogs.diff })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, fx.tenantAId),
              eq(auditLogs.entityId, created.id),
              eq(auditLogs.action, 'event.transition'),
            ),
          )
        expect(audit).toHaveLength(1)
        const diff = audit[0]?.diff as { from: string; to: string }
        expect(diff.from).toBe('draft')
        expect(diff.to).toBe('published')
      })
    })

    it('rejects skip transition (draft → live)', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Skip Reject',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      await expect(
        transitionEvent({
          tenantId: fx.tenantAId,
          eventId: created.id,
          actorUserId: fx.ownerId,
          toState: 'live',
        }),
      ).rejects.toBeInstanceOf(EventInvalidTransitionError)
    })

    it('rejects transition out of terminal archived', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'Archive Then Try',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      await transitionEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
        toState: 'archived',
      })
      await expect(
        transitionEvent({
          tenantId: fx.tenantAId,
          eventId: created.id,
          actorUserId: fx.ownerId,
          toState: 'draft',
        }),
      ).rejects.toBeInstanceOf(EventInvalidTransitionError)
    })
  })

  // ─── softDeleteEvent ───────────────────────────────────────────────

  describe('softDeleteEvent', () => {
    it('sets deleted_at + writes audit; subsequent get/list ignore it', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'To Be Deleted',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      await softDeleteEvent({
        tenantId: fx.tenantAId,
        eventId: created.id,
        actorUserId: fx.ownerId,
      })
      await expect(
        getEvent({ tenantId: fx.tenantAId, eventId: created.id }),
      ).rejects.toBeInstanceOf(EventNotFoundError)
      const list = await listEvents({ tenantId: fx.tenantAId })
      expect(list.items.find((i) => i.id === created.id)).toBeUndefined()

      await withSuperAdmin(async (db) => {
        const audit = await db
          .select({ action: auditLogs.action, diff: auditLogs.diff })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, fx.tenantAId),
              eq(auditLogs.entityId, created.id),
              eq(auditLogs.action, 'event.soft_deleted'),
            ),
          )
        expect(audit).toHaveLength(1)
        const diff = audit[0]?.diff as { status_at_delete: string }
        expect(diff.status_at_delete).toBe('draft')
      })
    })
  })

  // ─── RLS cross-tenant isolation ────────────────────────────────────

  describe('RLS cross-tenant isolation (§4.4)', () => {
    it("tenant A's event is invisible to tenant B's withTenant context", async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'A Only',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })

      // From tenant B's context: listing must not return A's event.
      const listAsB = await listEvents({ tenantId: fx.tenantBId })
      expect(listAsB.items.find((i) => i.id === created.id)).toBeUndefined()

      // From tenant B's context: getEvent must throw NotFound (RLS filters
      // the row out, the service maps zero-rows to NotFoundError).
      await expect(
        getEvent({ tenantId: fx.tenantBId, eventId: created.id }),
      ).rejects.toBeInstanceOf(EventNotFoundError)

      // Direct SELECT under withTenant(B): zero rows.
      const directQuery = await withTenant(fx.tenantBId, async (tx) => {
        return tx.select().from(events).where(eq(events.id, created.id))
      })
      expect(directQuery).toHaveLength(0)
    })

    it('tenant B cannot transition tenant A\'s event', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'A Transition Only',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      // transitionEvent under tenantB's context: row not visible →
      // EventNotFoundError. (Defence-in-depth: even if the application
      // mis-routed, RLS still enforces isolation at the DB layer.)
      await expect(
        transitionEvent({
          tenantId: fx.tenantBId,
          eventId: created.id,
          actorUserId: fx.ownerId,
          toState: 'published',
        }),
      ).rejects.toBeInstanceOf(EventNotFoundError)
      // Confirm A's event status unchanged.
      const stillDraft = await getEvent({ tenantId: fx.tenantAId, eventId: created.id })
      expect(stillDraft.status).toBe('draft')
    })

    it('tenant B cannot soft-delete tenant A\'s event', async () => {
      const created = await createEvent({
        tenantId: fx.tenantAId,
        actorUserId: fx.ownerId,
        type: 'concert',
        title: 'A Delete Only',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
      })
      await expect(
        softDeleteEvent({
          tenantId: fx.tenantBId,
          eventId: created.id,
          actorUserId: fx.ownerId,
        }),
      ).rejects.toBeInstanceOf(EventNotFoundError)
      // A's event still alive.
      const detail = await getEvent({ tenantId: fx.tenantAId, eventId: created.id })
      expect(detail.id).toBe(created.id)
    })
  })
})
