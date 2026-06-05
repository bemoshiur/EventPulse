/**
 * Per-event SEO + OpenGraph + Schema.org builders.
 *
 * Event pages are the platform's most search-valuable surface, so every public
 * event gets: a full Metadata object (title, description, keywords, authors,
 * canonical, OpenGraph, Twitter card, robots) and a Schema.org `Event` JSON-LD
 * block (rich results in Google: date, venue, ticket offers, organiser).
 *
 * Pure functions — no I/O — so they're unit-testable and reused by both
 * `generateMetadata` and the page's JSON-LD <script>.
 */

import type { Metadata } from 'next'

import type { PublicEventPayload } from './public-events'

const SITE = 'https://eventpulse.com.bd'
const SITE_NAME = 'Event Pulse'

interface ParsedVenue {
  isOnline: boolean
  name: string | null
  address: string | null
  district: string | null
  division: string | null
}

/** Defensive parse of the jsonb venue (shape: {type, name, address, division, district}). */
export function parseVenue(venue: unknown): ParsedVenue {
  const v = (venue ?? {}) as Record<string, unknown>
  const str = (x: unknown): string | null =>
    typeof x === 'string' && x.trim() !== '' ? x.trim() : null
  return {
    isOnline: v['type'] === 'online',
    name: str(v['name']),
    address: str(v['address']),
    district: str(v['district']),
    division: str(v['division']),
  }
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  concert: 'concert',
  conference: 'conference',
  workshop: 'workshop',
  standup: 'comedy show',
  alumni: 'alumni reunion',
  community: 'community meetup',
  sports: 'sports event',
  other: 'event',
}

function eventUrl(tenantSlug: string, eventSlug: string): string {
  return `${SITE}/${tenantSlug}/${eventSlug}`
}

function plainText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[#*_`>~]/g, '')
    .trim()
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

/** Build the human-facing description (event copy, or a generated fallback). */
export function buildDescription(payload: PublicEventPayload): string {
  const { event, brand } = payload
  if (event.description && event.description.trim() !== '') {
    return clamp(plainText(event.description), 200)
  }
  const venue = parseVenue(event.venue)
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: event.timezone || 'Asia/Dhaka',
    dateStyle: 'long',
  }).format(new Date(event.startsAt))
  const where = venue.isOnline ? 'online' : [venue.name, venue.district].filter(Boolean).join(', ')
  const typeLabel = EVENT_TYPE_LABEL[event.type] ?? 'event'
  return clamp(
    `${event.title} — a ${typeLabel} by ${brand.tenantName} on ${when}${
      where ? `, ${where}` : ''
    }. Book your tickets on ${SITE_NAME}.`,
    200,
  )
}

/** Keywords from the event type, title, venue, organiser + ticketing terms. */
export function buildKeywords(payload: PublicEventPayload): string[] {
  const { event, brand } = payload
  const venue = parseVenue(event.venue)
  const typeLabel = EVENT_TYPE_LABEL[event.type] ?? 'event'
  const titleWords = event.title
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((w) => w.length > 2)
  const set = new Set<string>(
    [
      event.title,
      ...titleWords,
      typeLabel,
      `${typeLabel} tickets`,
      brand.tenantName,
      venue.name,
      venue.district,
      venue.division,
      venue.isOnline ? 'online event' : 'event in Bangladesh',
      'tickets',
      'event registration',
      'Bangladesh',
      'eventpulse',
    ].filter((x): x is string => Boolean(x)),
  )
  return Array.from(set).slice(0, 24)
}

/** Comprehensive Next.js Metadata for a public event page. */
export function buildEventMetadata(
  payload: PublicEventPayload,
  tenantSlug: string,
  eventSlug: string,
): Metadata {
  const { event, brand } = payload
  const url = eventUrl(tenantSlug, eventSlug)
  const description = buildDescription(payload)
  const title = `${event.title} — ${brand.tenantName}`
  const image = event.bannerImageUrl ?? brand.logoUrl ?? `${SITE}/og-default.png`
  const images = [{ url: image, width: 1200, height: 630, alt: event.title }]
  const indexable = event.visibility === 'public'

  return {
    title,
    description,
    keywords: buildKeywords(payload),
    authors: [{ name: brand.tenantName }],
    creator: brand.tenantName,
    publisher: SITE_NAME,
    alternates: { canonical: url },
    robots: indexable
      ? { index: true, follow: true, googleBot: { index: true, follow: true } }
      : { index: false, follow: false },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      locale: 'en_US',
      alternateLocale: ['bn_BD'],
      title,
      description,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: images.map((i) => i.url),
    },
  }
}

/**
 * Schema.org `Event` JSON-LD — drives Google rich results (event date, venue,
 * ticket offers, organiser). Returned as a plain object for the page to
 * JSON.stringify into a <script type="application/ld+json">.
 */
export function buildEventJsonLd(
  payload: PublicEventPayload,
  tenantSlug: string,
  eventSlug: string,
): Record<string, unknown> {
  const { event, brand, tiers } = payload
  const url = eventUrl(tenantSlug, eventSlug)
  const venue = parseVenue(event.venue)
  const description = buildDescription(payload)

  const location = venue.isOnline
    ? { '@type': 'VirtualLocation', url }
    : {
        '@type': 'Place',
        name: venue.name ?? brand.tenantName,
        address: {
          '@type': 'PostalAddress',
          streetAddress: venue.address ?? undefined,
          addressLocality: venue.district ?? undefined,
          addressRegion: venue.division ?? undefined,
          addressCountry: 'BD',
        },
      }

  const offers = tiers.map((t) => {
    const remaining = t.capacity - t.sold
    return {
      '@type': 'Offer',
      name: t.name,
      price: (BigInt(t.pricePaisa) / 100n).toString(),
      priceCurrency: 'BDT',
      availability: remaining > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      url,
      ...(t.salesStartAt ? { validFrom: t.salesStartAt } : {}),
    }
  })

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description,
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: venue.isOnline
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    location,
    ...(event.bannerImageUrl ? { image: [event.bannerImageUrl] } : {}),
    organizer: {
      '@type': 'Organization',
      name: brand.tenantName,
      url: `${SITE}/${tenantSlug}`,
    },
    ...(offers.length > 0 ? { offers } : {}),
    url,
  }
}
