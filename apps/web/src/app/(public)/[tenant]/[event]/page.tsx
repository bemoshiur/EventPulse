/**
 * Public event landing page — Sprint 3 Day 25 Phase 2.
 *
 * Path-mode URL: /[tenant]/[event] (e.g. /publicpulse/summer-sounds-2026).
 *
 * Per §7.5 the long-term routing also supports:
 *   - {tenant}.eventpulse.com.bd/{event}  — tenant subdomain mode
 *   - {custom-domain}/{event}             — Cloudflare for SaaS (Sprint 7)
 *
 * MVP ships path-mode only — no middleware required. Subdomain
 * rewriting + custom domains land in subsequent sprints; the same
 * page renders for all three routing modes once middleware lands.
 *
 * Server Component (per Decision K Server Component pattern from
 * Trust Center): direct fetch to the public read endpoint over
 * HTTP, no client hydration of event data.
 *
 * Visibility + status filtering happens server-side per
 * `fetchPublicEvent()`. Missing / private / draft → 404 via
 * Next.js notFound().
 */

import { notFound } from 'next/navigation'

import { EventLanding } from '@/components/public/event-landing'
import { fetchPublicEvent } from '@/lib/public-events'

interface PageProps {
  params: Promise<{ tenant: string; event: string }>
}

export const revalidate = 60

export async function generateMetadata({ params }: PageProps) {
  const { tenant, event } = await params
  const payload = await fetchPublicEvent(tenant, event)
  if (!payload) return { title: 'Event not found' }
  return {
    title: `${payload.event.title} — ${payload.brand.tenantName}`,
    description: payload.event.description ?? undefined,
    openGraph: {
      title: payload.event.title,
      description: payload.event.description ?? undefined,
      images: payload.event.bannerImageUrl ? [payload.event.bannerImageUrl] : undefined,
    },
  }
}

export default async function PublicEventPage({ params }: PageProps) {
  const { tenant, event } = await params
  const payload = await fetchPublicEvent(tenant, event)
  if (!payload) notFound()

  return <EventLanding event={payload.event} brand={payload.brand} tiers={payload.tiers} />
}
