/**
 * Dynamic OpenGraph image for a public event — a branded 1200×630 social card
 * (title + date + venue + organiser on the tenant's brand gradient). Generated
 * per event so even cover-less events get a rich, readable share card instead of
 * a missing/placeholder image. Rendered with `next/og` (satori) — inline styles
 * + flexbox only, no remote images, no custom fonts, so it's reliable on the
 * self-hosted Node server.
 */

import { ImageResponse } from 'next/og'

import { parseVenue } from '@/lib/event-seo'
import { fetchPublicEvent } from '@/lib/public-events'

export const alt = 'Event on Event Pulse'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({
  params,
}: {
  params: Promise<{ tenant: string; event: string }>
}) {
  const { tenant, event } = await params
  const payload = await fetchPublicEvent(tenant, event).catch(() => null)

  const title = payload?.event.title ?? 'Event Pulse'
  const org = payload?.brand.tenantName ?? 'Event Pulse'
  const primary = payload?.brand.primaryColor ?? '#d32f2f'
  const accent = payload?.brand.accentColor ?? '#ff6f61'

  const when = payload
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: payload.event.timezone || 'Asia/Dhaka',
        dateStyle: 'long',
      }).format(new Date(payload.event.startsAt))
    : ''
  const venue = payload ? parseVenue(payload.event.venue) : null
  const where = venue
    ? venue.isOnline
      ? 'Online event'
      : [venue.name, venue.district].filter(Boolean).join(', ')
    : ''
  const metaLine = [when, where].filter(Boolean).join('  ·  ')

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px',
        background: `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`,
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ width: 16, height: 16, borderRadius: 999, background: '#ffffff' }} />
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 2 }}>EVENT PULSE</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, maxWidth: 1000 }}>
          {title.length > 90 ? `${title.slice(0, 89)}…` : title}
        </div>
        {metaLine ? (
          <div style={{ marginTop: 24, fontSize: 30, opacity: 0.95 }}>{metaLine}</div>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 26,
        }}
      >
        <div style={{ display: 'flex', opacity: 0.95 }}>Hosted by {org}</div>
        <div style={{ display: 'flex', opacity: 0.85 }}>eventpulse.com.bd</div>
      </div>
    </div>,
    { ...size },
  )
}
