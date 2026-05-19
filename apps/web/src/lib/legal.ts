/**
 * Trust Center service-layer fetch wrapper — Sprint 2 Day 19 Item 14
 * (Decision K 2026-05-19).
 *
 * Wraps the public read endpoints landed in PR #101:
 *   GET /api/v1/public/legal/landing
 *   GET /api/v1/public/legal/by-url-path?path=...
 *
 * Called from Server Components only (no client hydration of legal
 * content per Decision K). Returns the canonical shape from
 * apps/api/src/domain/legal/queries.ts.
 *
 * Cross-app boundary: §3.2 forbids direct imports from apps/web to
 * apps/api, so we re-declare the response shape here. The HTTP layer
 * gives us a clean transactional seam — if Sprint 3+ needs a shared
 * type, lift it into packages/shared-types in a follow-up.
 */

const DEFAULT_BASE_URL = 'http://localhost:4000'

function apiBaseUrl(): string {
  // NEXT_PUBLIC_API_BASE_URL is the canonical env var used across the
  // codebase. For SSR fetches from the apps/web process it doubles as
  // the internal URL — in staging both server and client resolve to
  // the same api.staging.eventpulse.com.bd hostname.
  const raw = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? DEFAULT_BASE_URL
  return raw.replace(/\/$/, '')
}

// ─── shape mirrored from apps/api/src/domain/legal/queries.ts ─────

export interface LegalDocumentRender {
  slug: string
  category: 'legal_contract' | 'trust_artefact'
  title: string
  oneLiner: string
  canonicalUrlPath: string
  requiresSignature: boolean
  currentVersion: {
    version: string
    effectiveAt: string
    bodyHtml: string
    materialChange: boolean
    isDraft: boolean
  }
}

export interface LegalDocumentLandingRow {
  slug: string
  category: 'legal_contract' | 'trust_artefact'
  title: string
  oneLiner: string
  canonicalUrlPath: string
  currentVersion: { version: string; isDraft: boolean }
}

// ─── fetch helpers ────────────────────────────────────────────────

/**
 * Fetch a single legal document by its canonical URL path. Returns
 * `null` on 404 OR on network failure (ECONNREFUSED at build time, etc.)
 * so the calling Server Component can `notFound()` cleanly. At runtime
 * the next revalidate cycle will see the API back up and re-fetch.
 */
export async function fetchLegalDocumentByUrlPath(
  urlPath: string,
): Promise<LegalDocumentRender | null> {
  try {
    const res = await fetch(
      `${apiBaseUrl()}/api/v1/public/legal/by-url-path?path=${encodeURIComponent(urlPath)}`,
      {
        // Next.js caching: revalidate every hour. The admin publish flow
        // will call `revalidatePath()` to bust this cache on demand.
        next: { revalidate: 3600 },
      },
    )
    if (res.status === 404) return null
    if (!res.ok) return null
    const body = (await res.json()) as { data: LegalDocumentRender }
    return body.data
  } catch {
    // Network failure (apps/api not running at build time, transient
    // outage at request time, etc.). Build-time: page 404s; ISR retries
    // on the next request. Runtime transient: cache served fall-through.
    return null
  }
}

/**
 * Fetch the document list for the /trust landing page. Returns empty
 * array on fetch failure for the same reasons as
 * fetchLegalDocumentByUrlPath above — keeps the landing page rendering
 * cleanly even if the API is unreachable.
 */
export async function fetchTrustCenterLanding(): Promise<LegalDocumentLandingRow[]> {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/v1/public/legal/landing`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const body = (await res.json()) as { data: LegalDocumentLandingRow[] }
    return body.data
  } catch {
    return []
  }
}
