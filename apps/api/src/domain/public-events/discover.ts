/**
 * Public event discovery (§2.7 /discover) — a BookMyShow-style directory of
 * publicly-visible, currently-open events, browsable by category + area + search.
 *
 * Gate: `visibility='public'` + status in the publicly-visible set + not yet
 * ended (ends_at > now). Cross-tenant public read via withSuperAdmin (mirrors
 * fetchPublicEvent). Area = `venue->>'district'` (physical venues carry the BD
 * district; online events have none → shown as "Online"). Category =
 * `events.type`. "from ৳X" = MIN tier price.
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { events, tenants, ticketTiers } from '../../db/schema/index.js'

const DISCOVERABLE_STATUSES = ['published', 'on_sale', 'sold_out', 'live'] as const

export interface DiscoverEvent {
  tenantSlug: string
  tenantName: string
  slug: string
  type: string
  title: string
  titleBn: string | null
  startsAt: string
  venueName: string | null
  /** BD district (physical) — the "area" for browsing; null for online events. */
  city: string | null
  isOnline: boolean
  bannerImageUrl: string | null
  /** MIN non-archived tier price in paisa, as a string. null = no tiers (free RSVP). */
  fromPricePaisa: string | null
}

export interface DiscoverFilters {
  category?: string | undefined
  city?: string | undefined
  q?: string | undefined
  limit?: number | undefined
}

export async function fetchDiscoverEvents(filters: DiscoverFilters): Promise<DiscoverEvent[]> {
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 96)
  return withSuperAdmin(async (tx) => {
    const conds = [
      isNull(events.deletedAt),
      isNull(tenants.deletedAt),
      sql`${events.visibility} = 'public'`,
      inArray(events.status, DISCOVERABLE_STATUSES as unknown as string[]),
      sql`${events.endsAt} > now()`,
    ]
    if (filters.category) conds.push(eq(events.type, filters.category))
    if (filters.city) conds.push(sql`lower(${events.venue}->>'district') = lower(${filters.city})`)
    if (filters.q) {
      const like = `%${filters.q}%`
      conds.push(sql`(${events.title} ILIKE ${like} OR ${events.venue}->>'name' ILIKE ${like})`)
    }

    const rows = await tx
      .select({
        eventId: events.id,
        tenantSlug: tenants.slug,
        tenantName: tenants.name,
        slug: events.slug,
        type: events.type,
        title: events.title,
        titleBn: events.titleBn,
        startsAt: events.startsAt,
        venue: events.venue,
        bannerImageUrl: events.bannerImageUrl,
      })
      .from(events)
      .innerJoin(tenants, eq(events.tenantId, tenants.id))
      .where(and(...conds))
      .orderBy(asc(events.startsAt))
      .limit(limit)

    if (rows.length === 0) return []

    const ids = rows.map((r) => r.eventId)
    const priceRows = await tx
      .select({
        eventId: ticketTiers.eventId,
        minPrice: sql<string | null>`min(${ticketTiers.pricePaisa})::text`,
      })
      .from(ticketTiers)
      .where(and(inArray(ticketTiers.eventId, ids), isNull(ticketTiers.archivedAt)))
      .groupBy(ticketTiers.eventId)
    const priceMap = new Map(priceRows.map((p) => [p.eventId, p.minPrice]))

    return rows.map((r) => {
      const venue = (r.venue ?? null) as Record<string, unknown> | null
      return {
        tenantSlug: r.tenantSlug,
        tenantName: r.tenantName,
        slug: r.slug,
        type: r.type,
        title: r.title,
        titleBn: r.titleBn,
        startsAt: r.startsAt.toISOString(),
        venueName:
          typeof venue?.['name'] === 'string'
            ? (venue['name'] as string)
            : typeof venue?.['platform'] === 'string'
              ? (venue['platform'] as string)
              : null,
        city: typeof venue?.['district'] === 'string' ? (venue['district'] as string) : null,
        isOnline: venue?.['type'] === 'online',
        bannerImageUrl: r.bannerImageUrl,
        fromPricePaisa: priceMap.get(r.eventId) ?? null,
      }
    })
  })
}

/** Distinct areas (cities) present across currently-discoverable events. */
export async function fetchDiscoverCities(): Promise<string[]> {
  return withSuperAdmin(async (tx) => {
    const rows = await tx
      .select({ city: sql<string>`${events.venue}->>'district'` })
      .from(events)
      .where(
        and(
          isNull(events.deletedAt),
          sql`${events.visibility} = 'public'`,
          inArray(events.status, DISCOVERABLE_STATUSES as unknown as string[]),
          sql`${events.endsAt} > now()`,
          sql`${events.venue}->>'district' IS NOT NULL AND ${events.venue}->>'district' <> ''`,
        ),
      )
      .groupBy(sql`${events.venue}->>'district'`)
      .orderBy(sql`${events.venue}->>'district'`)
    return rows.map((r) => r.city).filter(Boolean)
  })
}
