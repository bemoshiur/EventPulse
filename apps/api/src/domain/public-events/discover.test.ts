/**
 * Discover query — gate + filter behaviour (§2.7). DB-gated: CI only.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { events, tenants, ticketTiers, users } from '../../db/schema/index.js'
import { fetchDiscoverCities, fetchDiscoverEvents } from './discover.js'

const HAS_DB = Boolean(process.env['DATABASE_URL'])
const describeIfDb = HAS_DB ? describe : describe.skip

describeIfDb('fetchDiscoverEvents — gate + filters', () => {
  const fx: { tenant?: string; user?: string; eventIds: string[] } = { eventIds: [] }
  const stamp = Date.now()
  const FUTURE = new Date(Date.now() + 30 * 86400_000)
  const FUTURE_END = new Date(Date.now() + 30 * 86400_000 + 7200_000)
  const PAST = new Date(Date.now() - 30 * 86400_000)
  const venue = (district: string) => ({
    type: 'physical',
    name: `Venue ${district}`,
    address: 'X',
    division: 'Dhaka',
    district,
  })

  beforeAll(async () => {
    await withSuperAdmin(async (db) => {
      const [u] = await db
        .insert(users)
        .values({ email: `disc-${stamp}@test.local`, fullName: 'Disc' })
        .returning({ id: users.id })
      fx.user = u!.id
      const [t] = await db
        .insert(tenants)
        .values({
          type: 'individual',
          name: 'Disc Tenant',
          slug: `disc-${stamp}`,
          kycStatus: 'approved',
        })
        .returning({ id: tenants.id })
      fx.tenant = t!.id

      const mk = async (over: Record<string, unknown>) => {
        const [e] = await db
          .insert(events)
          .values({
            tenantId: t!.id,
            slug: `e-${Math.random().toString(36).slice(2, 9)}`,
            type: 'concert',
            title: 'Concert',
            startsAt: FUTURE,
            endsAt: FUTURE_END,
            venue: venue('Dhaka'),
            createdBy: u!.id,
            status: 'published',
            visibility: 'public',
            ...over,
          })
          .returning({ id: events.id })
        fx.eventIds.push(e!.id)
        return e!.id
      }
      // visible
      const visibleId = await mk({ title: 'Visible Concert', venue: venue('Chattogram') })
      await db.insert(ticketTiers).values({
        tenantId: t!.id,
        eventId: visibleId,
        name: 'GA',
        pricePaisa: 50000n,
        capacity: 100,
      })
      // hidden: private, past, draft, workshop
      await mk({ visibility: 'private', title: 'Private' })
      await mk({ startsAt: PAST, endsAt: new Date(Date.now() - 86400_000), title: 'Past' })
      await mk({ status: 'draft', title: 'Draft' })
      await mk({ type: 'workshop', title: 'A Workshop', venue: venue('Sylhet') })
    })
  })

  afterAll(async () => {
    if (!fx.tenant) return
    await withSuperAdmin(async (db) => {
      await db.delete(ticketTiers).where(inArray(ticketTiers.eventId, fx.eventIds))
      await db.delete(events).where(inArray(events.id, fx.eventIds))
      await db.delete(tenants).where(eq(tenants.id, fx.tenant!))
      await db.delete(users).where(eq(users.id, fx.user!))
    })
  })

  it('returns only public + published + future events (excludes private/past/draft)', async () => {
    const all = await fetchDiscoverEvents({})
    const titles = all.filter((e) => e.tenantSlug === `disc-${stamp}`).map((e) => e.title)
    expect(titles).toContain('Visible Concert')
    expect(titles).toContain('A Workshop')
    expect(titles).not.toContain('Private')
    expect(titles).not.toContain('Past')
    expect(titles).not.toContain('Draft')
  })

  it('filters by category, surfaces from-price + district (area)', async () => {
    const concerts = await fetchDiscoverEvents({ category: 'concert' })
    const mine = concerts.find((e) => e.title === 'Visible Concert')
    expect(mine).toBeDefined()
    expect(mine!.fromPricePaisa).toBe('50000')
    expect(mine!.city).toBe('Chattogram')
    expect(concerts.find((e) => e.title === 'A Workshop')).toBeUndefined()
  })

  it('filters by city (district)', async () => {
    const sylhet = await fetchDiscoverEvents({ city: 'Sylhet' })
    expect(sylhet.find((e) => e.title === 'A Workshop')).toBeDefined()
    expect(sylhet.find((e) => e.title === 'Visible Concert')).toBeUndefined()
  })

  it('lists distinct cities', async () => {
    const cities = await fetchDiscoverCities()
    expect(cities).toEqual(expect.arrayContaining(['Chattogram', 'Sylhet']))
  })
})
