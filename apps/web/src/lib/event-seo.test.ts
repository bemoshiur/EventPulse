import { describe, expect, it } from 'vitest'

import { buildDescription, buildEventJsonLd, buildEventMetadata, buildKeywords } from './event-seo'
import type { PublicEventPayload } from './public-events'

const payload: PublicEventPayload = {
  event: {
    id: 'e1',
    slug: 'cosmic-expo-2026',
    type: 'concert',
    title: 'Cosmic Expo 2026',
    titleBn: null,
    description: 'The ultimate pop-culture night.',
    descriptionBn: null,
    startsAt: '2026-06-06T12:00:00.000Z',
    endsAt: '2026-06-06T16:00:00.000Z',
    timezone: 'Asia/Dhaka',
    venue: {
      type: 'physical',
      name: 'BGB Banquet Hall',
      address: 'Shimanto Square',
      district: 'Dhaka',
      division: 'dhaka',
    },
    capacity: 500,
    bannerImageUrl: 'https://cdn.example.com/cover.jpg',
    visibility: 'public',
    status: 'on_sale',
    publishedAt: '2026-06-01T00:00:00.000Z',
  },
  brand: {
    logoUrl: 'https://cdn.example.com/logo.png',
    primaryColor: '#d32f2f',
    accentColor: '#ff6f61',
    tenantName: 'Moshiur Rahman',
  },
  tiers: [
    {
      id: 't1',
      name: 'Early Bird',
      description: null,
      pricePaisa: '35000',
      capacity: 100,
      sold: 10,
      salesStartAt: '2026-06-01T00:00:00.000Z',
      salesEndAt: null,
      isComplimentary: false,
      sortOrder: 0,
    },
  ],
}

describe('buildEventMetadata', () => {
  const meta = buildEventMetadata(payload, 'moshiur', 'cosmic-expo-2026')

  it('sets a descriptive title + canonical + keywords + author', () => {
    expect(meta.title).toBe('Cosmic Expo 2026 — Moshiur Rahman')
    expect(meta.alternates?.canonical).toBe('https://eventpulse.com.bd/moshiur/cosmic-expo-2026')
    expect((meta.authors as { name: string }[])[0]!.name).toBe('Moshiur Rahman')
    expect(Array.isArray(meta.keywords) ? meta.keywords : []).toContain('tickets')
  })

  it('builds OpenGraph with url, image dimensions, and bilingual locale', () => {
    const og = meta.openGraph as Record<string, unknown>
    expect(og['url']).toBe('https://eventpulse.com.bd/moshiur/cosmic-expo-2026')
    expect(og['siteName']).toBe('Event Pulse')
    expect(og['alternateLocale']).toContain('bn_BD')
    const img = (og['images'] as { url: string; width: number }[])[0]!
    expect(img.url).toBe('https://cdn.example.com/cover.jpg')
    expect(img.width).toBe(1200)
  })

  it('uses a summary_large_image Twitter card', () => {
    expect((meta.twitter as Record<string, unknown>)['card']).toBe('summary_large_image')
  })

  it('indexes public events but not unlisted ones', () => {
    expect((meta.robots as { index: boolean }).index).toBe(true)
    const unlisted = buildEventMetadata(
      { ...payload, event: { ...payload.event, visibility: 'unlisted' } },
      'moshiur',
      'cosmic-expo-2026',
    )
    expect((unlisted.robots as { index: boolean }).index).toBe(false)
  })
})

describe('buildEventJsonLd', () => {
  const ld = buildEventJsonLd(payload, 'moshiur', 'cosmic-expo-2026')

  it('is a Schema.org Event with dates, place, organiser, and ticket offers', () => {
    expect(ld['@type']).toBe('Event')
    expect(ld['startDate']).toBe('2026-06-06T12:00:00.000Z')
    expect((ld['location'] as Record<string, unknown>)['@type']).toBe('Place')
    expect((ld['organizer'] as Record<string, unknown>)['name']).toBe('Moshiur Rahman')
    const offers = ld['offers'] as { price: string; priceCurrency: string; availability: string }[]
    expect(offers[0]!.price).toBe('350')
    expect(offers[0]!.priceCurrency).toBe('BDT')
    expect(offers[0]!.availability).toContain('InStock')
  })

  it('marks a sold-out tier as SoldOut', () => {
    const soldOut = buildEventJsonLd(
      { ...payload, tiers: [{ ...payload.tiers[0]!, sold: 100 }] },
      'moshiur',
      'cosmic-expo-2026',
    )
    const offers = soldOut['offers'] as { availability: string }[]
    expect(offers[0]!.availability).toContain('SoldOut')
  })

  it('uses VirtualLocation for online events', () => {
    const online = buildEventJsonLd(
      { ...payload, event: { ...payload.event, venue: { type: 'online' } } },
      'moshiur',
      'cosmic-expo-2026',
    )
    expect((online['location'] as Record<string, unknown>)['@type']).toBe('VirtualLocation')
  })
})

describe('buildDescription + buildKeywords', () => {
  it('falls back to a generated description when none is set', () => {
    const d = buildDescription({ ...payload, event: { ...payload.event, description: null } })
    expect(d).toContain('Cosmic Expo 2026')
    expect(d).toContain('Book your tickets')
  })

  it('derives keywords from type, venue and organiser', () => {
    const kws = buildKeywords(payload)
    expect(kws).toContain('Dhaka')
    expect(kws).toContain('Moshiur Rahman')
    expect(kws.length).toBeLessThanOrEqual(24)
  })
})
