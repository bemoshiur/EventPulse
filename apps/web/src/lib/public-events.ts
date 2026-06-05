/**
 * Public event service-layer fetch wrapper — Sprint 3 Day 25 Phase 2.
 *
 * Mirrors the Trust Center fetch pattern at apps/web/src/lib/legal.ts.
 * Called from Server Components rendering the public event landing
 * page at /(public)/[tenant]/[event].
 *
 * Cross-app boundary: §3.2 forbids direct imports from apps/web to
 * apps/api; the wire shape is mirrored here. The HTTP seam gives a
 * clean caching point + a future-proofing layer if the response
 * shape diverges between server-storage and wire format.
 *
 * Caching: `next: { revalidate: 60 }` matches the api Cache-Control
 * (60s browser, 300s edge). Event data changes more often than legal
 * documents; one-minute SSG cache keeps the page snappy without
 * letting tier capacity / sales-window edits go stale for long.
 */

const DEFAULT_BASE_URL = 'http://localhost:4000'

function apiBaseUrl(): string {
  const raw = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? DEFAULT_BASE_URL
  return raw.replace(/\/$/, '')
}

/**
 * Resolve a possibly-renamed tenant slug to its current value (handle_history,
 * §9.14). Returns the new slug to redirect to, or null. Called by the public
 * event page when an event 404s, so old `{handle}/{event}` URLs 301 to the new
 * handle for the 30-day window. `no-store` so a fresh rename redirects at once.
 */
export async function fetchHandleRedirect(slug: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/public/handles/resolve?slug=${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { newSlug?: string | null } }
    return body.data?.newSlug ?? null
  } catch {
    return null
  }
}

// ─── wire shape (mirrors apps/api domain/public-events/queries.ts) ─

export interface PublicEventBrandWire {
  logoUrl: string | null
  primaryColor: string | null
  accentColor: string | null
  tenantName: string
}

export interface PublicEventTierWire {
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

export interface PublicEventWire {
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
  event: PublicEventWire
  brand: PublicEventBrandWire
  tiers: PublicEventTierWire[]
}

// ─── build-phase + error helpers (mirror legal.ts) ─────────────────

function isBuildPhase(): boolean {
  return process.env['NEXT_PHASE'] === 'phase-production-build'
}

function logFetchFailure(scope: string, url: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      level: 'error',
      service: '@eventpulse/web',
      scope,
      url,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      timestamp: new Date().toISOString(),
    }),
  )
}

export class PublicEventsApiUnavailableError extends Error {
  constructor(scope: string, url: string, cause?: unknown) {
    super(`Public events API unavailable while ${scope}; url=${url}.`)
    this.name = 'PublicEventsApiUnavailableError'
    if (cause !== undefined) this.cause = cause
  }
}

// ─── fetch ─────────────────────────────────────────────────────────

/**
 * Fetch a public event by tenant slug + event slug.
 *
 * Returns `null` on 404 (event missing OR not publicly accessible —
 * draft, archived, completed, or private). Throws
 * `PublicEventsApiUnavailableError` on network failure or 5xx so
 * Next.js error boundaries can render a 503.
 *
 * Build-phase short-circuit: returns `null` during `next build` to
 * keep static prerender unblocked when the api isn't yet running;
 * ISR revalidates on first runtime request.
 */
export async function fetchPublicEvent(
  tenantSlug: string,
  eventSlug: string,
): Promise<PublicEventPayload | null> {
  const url = `${apiBaseUrl()}/api/v1/public/events/${encodeURIComponent(
    tenantSlug,
  )}/${encodeURIComponent(eventSlug)}`
  try {
    const res = await fetch(url, { next: { revalidate: 60 } })
    if (res.status === 404) return null
    if (!res.ok) {
      if (isBuildPhase()) {
        logFetchFailure('fetchPublicEvent (build)', url, `HTTP ${res.status}`)
        return null
      }
      const err = new PublicEventsApiUnavailableError('fetchPublicEvent', url, {
        status: res.status,
      })
      logFetchFailure('fetchPublicEvent', url, err)
      throw err
    }
    const body = (await res.json()) as { data: PublicEventPayload }
    return body.data
  } catch (err) {
    if (err instanceof PublicEventsApiUnavailableError) throw err
    if (isBuildPhase()) {
      logFetchFailure('fetchPublicEvent (build)', url, err)
      return null
    }
    logFetchFailure('fetchPublicEvent', url, err)
    throw new PublicEventsApiUnavailableError('fetchPublicEvent', url, err)
  }
}
