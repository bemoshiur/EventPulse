/**
 * Public event read queries — Sprint 3 Day 25.
 *
 * Single fetch function joining events + tenants + ticket_tiers for
 * the public event landing page. Uses withSuperAdmin (BYPASSRLS) per
 * §4.2.1 because the read is public + we filter by visibility/status
 * at the application layer.
 *
 * Visibility rule per §9.3 + §2.7:
 *   - visibility = 'public' → discoverable + linkable
 *   - visibility = 'unlisted' → linkable but not in /discover (Sprint 8+);
 *     still publicly accessible via direct URL because that's the
 *     unlisted-link contract
 *   - visibility = 'private' → NOT publicly accessible; this function
 *     returns null for private events
 *
 * Status rule:
 *   - draft / archived / completed → NOT publicly accessible (this
 *     function returns null)
 *   - published / on_sale / sold_out / live → publicly accessible
 *
 * Why these gates here (not in RLS): RLS filters by tenant scope. The
 * public read crosses tenant boundaries by design (any tenant's
 * public event is fetchable by URL). Visibility + status filters are
 * application-policy, not isolation; they belong in the query.
 */

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { withSuperAdmin } from '../../db/client.js'
import { events, tenants, ticketTiers } from '../../db/schema/index.js'

export interface PublicEventBrand {
  logoUrl: string | null
  primaryColor: string | null
  accentColor: string | null
  tenantName: string
}

export interface PublicEventTier {
  id: string
  name: string
  description: string | null
  pricePaisa: string
  capacity: number
  sold: number
  salesStartAt: string | null
  salesEndAt: string | null
  isComplimentary: boolean
  sortOrder: number
}

export interface PublicEvent {
  id: string
  slug: string
  type: string
  title: string
  titleBn: string | null
  description: string | null
  descriptionBn: string | null
  startsAt: string
  endsAt: string
  timezone: string
  venue: unknown
  capacity: number | null
  bannerImageUrl: string | null
  visibility: 'public' | 'unlisted'
  status: string
  publishedAt: string | null
}

export interface PublicEventPayload {
  event: PublicEvent
  brand: PublicEventBrand
  tiers: PublicEventTier[]
}

const PUBLICLY_VISIBLE_STATUSES = ['published', 'on_sale', 'sold_out', 'live'] as const

/**
 * Fetch the public payload for an event by tenant slug + event slug.
 * Returns null when the tuple doesn't resolve to a publicly-visible
 * event (missing, deleted, private, draft/archived/completed status).
 */
export async function fetchPublicEvent(
  tenantSlug: string,
  eventSlug: string,
): Promise<PublicEventPayload | null> {
  return withSuperAdmin(async (tx) => {
    const rows = await tx
      .select({
        event: events,
        tenant: tenants,
      })
      .from(events)
      .innerJoin(tenants, eq(events.tenantId, tenants.id))
      .where(
        and(
          eq(tenants.slug, tenantSlug),
          eq(events.slug, eventSlug),
          isNull(events.deletedAt),
          isNull(tenants.deletedAt),
          inArray(events.status, PUBLICLY_VISIBLE_STATUSES as unknown as string[]),
          sql`${events.visibility} IN ('public','unlisted')`,
        ),
      )
      .limit(1)

    if (rows.length === 0) return null
    const { event, tenant } = rows[0]!

    const tierRows = await tx
      .select()
      .from(ticketTiers)
      .where(and(eq(ticketTiers.eventId, event.id), isNull(ticketTiers.archivedAt)))
      .orderBy(asc(ticketTiers.sortOrder), asc(ticketTiers.createdAt))

    return {
      event: {
        id: event.id,
        slug: event.slug,
        type: event.type,
        title: event.title,
        titleBn: event.titleBn,
        description: event.description,
        descriptionBn: event.descriptionBn,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        timezone: event.timezone,
        venue: event.venue,
        capacity: event.capacity,
        bannerImageUrl: event.bannerImageUrl,
        visibility: event.visibility as 'public' | 'unlisted',
        status: event.status,
        publishedAt: event.publishedAt?.toISOString() ?? null,
      },
      brand: {
        logoUrl: tenant.brandLogoUrl,
        primaryColor: tenant.brandColorPrimary,
        accentColor: tenant.brandColorAccent,
        tenantName: tenant.name,
      },
      tiers: tierRows.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        pricePaisa: t.pricePaisa.toString(),
        capacity: t.capacity,
        sold: t.sold,
        salesStartAt: t.salesStartAt?.toISOString() ?? null,
        salesEndAt: t.salesEndAt?.toISOString() ?? null,
        isComplimentary: t.isComplimentary,
        sortOrder: t.sortOrder,
      })),
    }
  })
}
