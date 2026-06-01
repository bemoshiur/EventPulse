/**
 * Public event landing template — Sprint 3 Day 25 Phase 2.
 *
 * ONE hardcoded React template with brand-customisation slots per
 * §26.1 Day 4. No builder — that's Sprint 6+.
 *
 * Brand slots driven by per-tenant config (logo, primary color,
 * accent color from `tenants` table) + per-event copy (banner image,
 * title, description, venue from `events` table).
 *
 * Display only — no purchase flow (Day 26+ for order pipeline). Tier
 * cards show price + remaining seats + sales window for transparency
 * but the CTA is a placeholder. When the order pipeline lands, the
 * CTA becomes the buy button.
 *
 * Accessibility per §19.6: semantic landmarks (header/main/footer),
 * color-contrast respects the user's brand choice (we don't enforce
 * a contrast threshold — that's the tenant's call), motion respects
 * prefers-reduced-motion via the GradientMesh component.
 *
 * Bilingual per §1.3 R12: if titleBn / descriptionBn are present,
 * they render alongside the English copy.
 */

import { BuyerForm } from '@/components/public/buyer-form'
import type {
  PublicEventBrandWire,
  PublicEventTierWire,
  PublicEventWire,
} from '@/lib/public-events'

export interface EventLandingProps {
  event: PublicEventWire
  brand: PublicEventBrandWire
  tiers: PublicEventTierWire[]
  /**
   * Pre-rendered, sanitized HTML for the current Buyer Terms (v1.0).
   * Server-fetched upstream of this component and passed straight through
   * to BuyerForm. `null` (or absent) if the legal API is transiently
   * unreachable — see BuyerForm prop docs for the failure-mode handling.
   *
   * Optional purely for test-fixture ergonomics; production callsite
   * always passes the fetched value.
   */
  buyerTermsBodyHtml?: string | null
  /** Version string ("v1.0", "v1.1", …) of the Buyer Terms above. */
  buyerTermsVersion?: string | null
}

function formatDateTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatVenue(venue: unknown): string {
  if (typeof venue !== 'object' || venue === null) return ''
  const v = venue as Record<string, unknown>
  if (v['type'] === 'online') {
    const platform = typeof v['platform'] === 'string' ? v['platform'] : 'Online'
    return `Online · ${platform}`
  }
  if (v['type'] === 'physical') {
    const parts = [v['name'], v['address'], v['district']].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    )
    return parts.join(' · ')
  }
  return ''
}

export function EventLanding({
  event,
  brand,
  tiers,
  buyerTermsBodyHtml,
  buyerTermsVersion,
}: EventLandingProps) {
  // Brand-color CSS variables — tenant primary + accent override the
  // platform defaults inside this template only. Fallback to the
  // §1.5 platform palette so events without brand customisation
  // still render coherently.
  const brandStyle = {
    '--brand-primary': brand.primaryColor ?? '#6C4FE0',
    '--brand-accent': brand.accentColor ?? '#FF6F61',
  } as React.CSSProperties

  return (
    <main
      className="bg-ep-mist text-ep-ink relative min-h-screen"
      style={brandStyle}
      data-testid="event-landing"
    >
      {/* ─── header / brand bar ──────────────────────────────────────── */}
      <header className="border-ep-line bg-ep-paper/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt={`${brand.tenantName} logo`} className="h-10 w-auto" />
            ) : (
              <span className="text-ep-ink font-display text-lg font-semibold">
                {brand.tenantName}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ─── hero ─────────────────────────────────────────────────────── */}
      <section className="relative">
        {event.bannerImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.bannerImageUrl} alt="" className="h-72 w-full object-cover md:h-96" />
        )}
        <div
          className="mx-auto max-w-5xl px-6 py-12"
          style={{
            background: `linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent) 100%)`,
            color: 'white',
          }}
          data-testid="event-hero"
        >
          <p className="text-xs tracking-widest uppercase opacity-80">{event.type}</p>
          <h1 className="font-display mt-2 text-4xl font-semibold md:text-5xl">{event.title}</h1>
          {event.titleBn && (
            <p className="mt-2 text-2xl opacity-90" lang="bn">
              {event.titleBn}
            </p>
          )}
          <dl className="mt-6 grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
            <div>
              <dt className="text-xs uppercase opacity-80">Starts</dt>
              <dd className="mt-1">{formatDateTime(event.startsAt, event.timezone)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-80">Ends</dt>
              <dd className="mt-1">{formatDateTime(event.endsAt, event.timezone)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-80">Venue</dt>
              <dd className="mt-1">{formatVenue(event.venue)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ─── about / description ─────────────────────────────────────── */}
      {(event.description || event.descriptionBn) && (
        <section className="mx-auto max-w-3xl px-6 py-10" data-testid="event-about">
          {event.description && (
            <p className="text-ep-graphite text-base whitespace-pre-line">{event.description}</p>
          )}
          {event.descriptionBn && (
            <p className="text-ep-graphite mt-4 text-base whitespace-pre-line" lang="bn">
              {event.descriptionBn}
            </p>
          )}
        </section>
      )}

      {/* ─── tickets + buyer form (Sprint 4 Day 34; Day 39 Phase 2 consent wire-in) ─────────────────── */}
      <BuyerForm
        event={event}
        tiers={tiers}
        buyerTermsBodyHtml={buyerTermsBodyHtml}
        buyerTermsVersion={buyerTermsVersion}
      />
      {/* End buyer form */}

      {/* ─── footer ──────────────────────────────────────────────────── */}
      <footer className="border-ep-line border-t py-8">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <p className="text-ep-graphite/70 text-xs">
            Hosted by <strong className="text-ep-ink">{brand.tenantName}</strong> · Powered by Event
            Pulse
          </p>
        </div>
      </footer>
    </main>
  )
}
