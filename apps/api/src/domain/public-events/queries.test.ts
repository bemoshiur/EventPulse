/**
 * fetchPublicEvent integration tests — Sprint 3 Day 25 Phase 2.
 *
 * Covers the visibility + status + soft-delete gating rules that
 * fetchPublicEvent enforces at the application layer. RLS-side
 * isolation is irrelevant here (the read crosses tenants by design;
 * the gate is application policy, not isolation).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'

import { resetPool, withSuperAdmin } from '../../db/client.js'
import { events, tenants, ticketTiers, users } from '../../db/schema/index.js'
import { fetchPublicEvent } from './queries.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

interface Fixture {
  ownerId: string
  tenantId: string
  tenantSlug: string
  publicEventId: string
  publicEventSlug: string
  draftEventSlug: string
  privateEventSlug: string
  archivedEventSlug: string
  unlistedEventSlug: string
  deletedTenantSlug: string
  deletedTenantEventSlug: string
}

const physicalVenue = {
  type: 'physical' as const,
  name: 'Test Venue',
  address: '12 Test Rd',
  division: 'dhaka',
  district: 'Dhaka',
}

const futureStart = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const futureEnd = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000)

describeIfDb('fetchPublicEvent — visibility + status gating', () => {
  const fx: Fixture = {} as Fixture

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `public-events-${Date.now()}@test.local`,
          fullName: 'Public Events Owner',
        })
        .returning({ id: users.id })
      fx.ownerId = owner!.id

      fx.tenantSlug = `public-events-tenant-${Date.now()}`
      const [tenant] = await db
        .insert(tenants)
        .values({
          name: 'Public Events Tenant',
          slug: fx.tenantSlug,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
          brandColorPrimary: '#6C4FE0',
          brandColorAccent: '#FF6F61',
        })
        .returning({ id: tenants.id })
      fx.tenantId = tenant!.id

      fx.publicEventSlug = `public-evt-${Date.now()}`
      const [publicEvt] = await db
        .insert(events)
        .values({
          tenantId: fx.tenantId,
          slug: fx.publicEventSlug,
          type: 'concert',
          title: 'Public Visible',
          status: 'on_sale',
          visibility: 'public',
          startsAt: futureStart(),
          endsAt: futureEnd(),
          venue: physicalVenue,
          createdBy: fx.ownerId,
        })
        .returning({ id: events.id })
      fx.publicEventId = publicEvt!.id

      fx.draftEventSlug = `draft-evt-${Date.now()}`
      await db.insert(events).values({
        tenantId: fx.tenantId,
        slug: fx.draftEventSlug,
        type: 'concert',
        title: 'Draft',
        status: 'draft',
        visibility: 'public',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
        createdBy: fx.ownerId,
      })

      fx.privateEventSlug = `private-evt-${Date.now()}`
      await db.insert(events).values({
        tenantId: fx.tenantId,
        slug: fx.privateEventSlug,
        type: 'concert',
        title: 'Private',
        status: 'on_sale',
        visibility: 'private',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
        createdBy: fx.ownerId,
      })

      fx.archivedEventSlug = `archived-evt-${Date.now()}`
      await db.insert(events).values({
        tenantId: fx.tenantId,
        slug: fx.archivedEventSlug,
        type: 'concert',
        title: 'Archived',
        status: 'archived',
        visibility: 'public',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
        createdBy: fx.ownerId,
      })

      fx.unlistedEventSlug = `unlisted-evt-${Date.now()}`
      await db.insert(events).values({
        tenantId: fx.tenantId,
        slug: fx.unlistedEventSlug,
        type: 'concert',
        title: 'Unlisted Visible',
        status: 'on_sale',
        visibility: 'unlisted',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
        createdBy: fx.ownerId,
      })

      // Soft-deleted tenant with a public event — the event must
      // also NOT resolve because the tenant join filters on tenant
      // deleted_at.
      fx.deletedTenantSlug = `deleted-tenant-${Date.now()}`
      const [deletedTenant] = await db
        .insert(tenants)
        .values({
          name: 'Deleted',
          slug: fx.deletedTenantSlug,
          isPersonal: true,
          ownerUserId: owner!.id,
          type: 'organisation',
        })
        .returning({ id: tenants.id })
      await db
        .update(tenants)
        .set({ deletedAt: sql`now()` })
        .where(eq(tenants.id, deletedTenant!.id))
      fx.deletedTenantEventSlug = `del-tenant-evt-${Date.now()}`
      await db.insert(events).values({
        tenantId: deletedTenant!.id,
        slug: fx.deletedTenantEventSlug,
        type: 'concert',
        title: 'Orphan',
        status: 'on_sale',
        visibility: 'public',
        startsAt: futureStart(),
        endsAt: futureEnd(),
        venue: physicalVenue,
        createdBy: fx.ownerId,
      })

      // Add a tier to the public event so the tiers branch of
      // fetchPublicEvent is exercised.
      await db.insert(ticketTiers).values({
        tenantId: fx.tenantId,
        eventId: fx.publicEventId,
        name: 'GA',
        pricePaisa: 50_000n,
        capacity: 100,
      })
      // Add an archived tier to verify it's filtered out.
      await db.insert(ticketTiers).values({
        tenantId: fx.tenantId,
        eventId: fx.publicEventId,
        name: 'Archived Tier',
        pricePaisa: 100_000n,
        capacity: 10,
        archivedAt: sql`now()`,
      })
    })
  })

  afterAll(async () => {
    await withSuperAdmin(async (db) => {
      // Resolve tenant ids by slug to clean up safely.
      const slugsToClean = [fx.tenantSlug, fx.deletedTenantSlug].filter(Boolean)
      for (const slug of slugsToClean) {
        const t = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
        if (t.length > 0) {
          await db.delete(ticketTiers).where(eq(ticketTiers.tenantId, t[0]!.id))
          await db.delete(events).where(eq(events.tenantId, t[0]!.id))
          await db.delete(tenants).where(eq(tenants.id, t[0]!.id))
        }
      }
      if (fx.ownerId) await db.delete(users).where(eq(users.id, fx.ownerId))
    })
    await resetPool()
  })

  beforeEach(() => {
    // No mutation between tests — all reads. Skip the per-test reset.
  })

  it('returns event + brand + tiers for a public on_sale event', async () => {
    const payload = await fetchPublicEvent(fx.tenantSlug, fx.publicEventSlug)
    expect(payload).not.toBeNull()
    expect(payload!.event.title).toBe('Public Visible')
    expect(payload!.event.visibility).toBe('public')
    expect(payload!.brand.tenantName).toBe('Public Events Tenant')
    expect(payload!.brand.primaryColor).toBe('#6C4FE0')
    expect(payload!.tiers).toHaveLength(1) // archived tier filtered out
    expect(payload!.tiers[0]!.name).toBe('GA')
  })

  it('returns null for a draft event', async () => {
    const payload = await fetchPublicEvent(fx.tenantSlug, fx.draftEventSlug)
    expect(payload).toBeNull()
  })

  it('returns null for a private event', async () => {
    const payload = await fetchPublicEvent(fx.tenantSlug, fx.privateEventSlug)
    expect(payload).toBeNull()
  })

  it('returns null for an archived event', async () => {
    const payload = await fetchPublicEvent(fx.tenantSlug, fx.archivedEventSlug)
    expect(payload).toBeNull()
  })

  it('returns the event for an unlisted on_sale event (linkable, not /discover)', async () => {
    const payload = await fetchPublicEvent(fx.tenantSlug, fx.unlistedEventSlug)
    expect(payload).not.toBeNull()
    expect(payload!.event.visibility).toBe('unlisted')
  })

  it('returns null when tenant is soft-deleted', async () => {
    const payload = await fetchPublicEvent(fx.deletedTenantSlug, fx.deletedTenantEventSlug)
    expect(payload).toBeNull()
  })

  it('returns null when tenant slug does not exist', async () => {
    const payload = await fetchPublicEvent('nonexistent-tenant-xyz', fx.publicEventSlug)
    expect(payload).toBeNull()
  })

  it('returns null when event slug does not exist', async () => {
    const payload = await fetchPublicEvent(fx.tenantSlug, 'nonexistent-event-xyz')
    expect(payload).toBeNull()
  })
})
