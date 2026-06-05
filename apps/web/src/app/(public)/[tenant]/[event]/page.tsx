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

import { notFound, permanentRedirect } from 'next/navigation'

import { EventLanding } from '@/components/public/event-landing'
import { buildEventJsonLd, buildEventMetadata } from '@/lib/event-seo'
import { fetchLegalDocumentByUrlPath } from '@/lib/legal'
import { fetchHandleRedirect, fetchPublicEvent } from '@/lib/public-events'

interface PageProps {
  params: Promise<{ tenant: string; event: string }>
}

export const revalidate = 60

export async function generateMetadata({ params }: PageProps) {
  const { tenant, event } = await params
  const payload = await fetchPublicEvent(tenant, event)
  if (!payload) return { title: 'Event not found', robots: { index: false, follow: false } }
  return buildEventMetadata(payload, tenant, event)
}

export default async function PublicEventPage({ params }: PageProps) {
  const { tenant, event } = await params

  // Day 39 Phase 2 consent wire-in: fetch Buyer Terms v1.0 body in
  // parallel with the event payload. The legal fetcher returns null on
  // legitimate 404 (document missing); on api failure it throws
  // LegalApiUnavailableError which Next.js's error boundary surfaces
  // as 503 — fail-loud is correct here because the server-side
  // consent_records INSERT (createOrder service) also fails if the
  // doc is missing, so a 503 at page-load is the buyer-facing surface
  // of the same root cause.
  const [payload, buyerTerms] = await Promise.all([
    fetchPublicEvent(tenant, event),
    fetchLegalDocumentByUrlPath('/buyer-terms'),
  ])
  if (!payload) {
    // The tenant slug may have been renamed — 301 old URLs to the current
    // handle for the 30-day redirect window (§9.14) before falling to 404.
    const newSlug = await fetchHandleRedirect(tenant)
    if (newSlug && newSlug !== tenant) permanentRedirect(`/${newSlug}/${event}`)
    notFound()
  }

  const jsonLd = buildEventJsonLd(payload, tenant, event)
  // Escape `<` so a malicious `</script>` in event-supplied title/description
  // cannot break out of the JSON-LD <script> tag (standard JSON-LD XSS guard).
  const jsonLdSafe = JSON.stringify(jsonLd).replace(/</g, '\\u003c')

  return (
    <>
      {/* Schema.org Event — rich results (date, venue, ticket offers, organiser). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdSafe }} />
      <EventLanding
        event={payload.event}
        brand={payload.brand}
        tiers={payload.tiers}
        buyerTermsBodyHtml={buyerTerms?.currentVersion.bodyHtml ?? null}
        buyerTermsVersion={buyerTerms?.currentVersion.version ?? null}
      />
    </>
  )
}
