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
 * Returns true during Next.js's build-time prerender phase. Set by
 * Next.js to `phase-production-build` while `next build` runs static
 * pages. At that phase, the api may not be running yet (the deploy.sh
 * order is build → migrate → pm2 reload → healthcheck), and the
 * fail-loud throw below would break the build. Build-time is the one
 * case where a `null` return is safe — Next.js renders the notFound()
 * branch, ISR re-fetches on the next request when the api is back up.
 *
 * At runtime (request-time, ISR revalidate, on-demand revalidate), the
 * fail-loud path runs.
 */
function isBuildPhase(): boolean {
  return process.env['NEXT_PHASE'] === 'phase-production-build'
}

/**
 * Structured error log on fetch failure. apps/web doesn't ship pino yet
 * (Sprint 3+ candidate); console.error with a JSON envelope is Next.js
 * Server-side stderr → PM2 captures it in /home/eventpulse/logs/web.err.log.
 *
 * Fix 7 of the Day 21 verification deploy sequence — was previously a
 * silent `catch {}` that masked api unavailability and made Trust Center
 * pages return 404-with-200-status. The Sprint 2 closing gotchas.md
 * entry consolidates the silent-failure pattern across all 5 layers.
 */
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

/**
 * Thrown when a Trust Center API fetch fails at runtime. Next.js Server
 * Component error boundaries catch this and render a 503.
 */
export class LegalApiUnavailableError extends Error {
  constructor(scope: string, url: string, cause?: unknown) {
    super(
      `Legal API unavailable while ${scope}; url=${url}. ` +
        `This is a fail-loud surface introduced at Fix 7; the previous shape ` +
        `silently returned null and Trust Center pages 404'd with 200 status.`,
    )
    this.name = 'LegalApiUnavailableError'
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

/**
 * Fetch a single legal document by its canonical URL path.
 *
 * Returns `null` on legitimate 404 only — the document genuinely doesn't
 * exist (slug typo, document not yet seeded). Throws
 * `LegalApiUnavailableError` on network failure or 5xx from the api so
 * Next.js's error boundary can render a 503. Distinguishes "no such
 * document" (notFound) from "api can't be reached" (service down).
 *
 * Build-phase short-circuit: if `process.env.NEXT_PHASE` indicates a
 * Next.js production build is in progress, returns `null` instead of
 * throwing — the api isn't expected to be running during `next build`
 * in the deploy.sh pipeline; ISR revalidates on first runtime request.
 */
export async function fetchLegalDocumentByUrlPath(
  urlPath: string,
): Promise<LegalDocumentRender | null> {
  const url = `${apiBaseUrl()}/api/v1/public/legal/by-url-path?path=${encodeURIComponent(urlPath)}`
  try {
    const res = await fetch(url, {
      // Next.js caching: revalidate every hour. The admin publish flow
      // will call `revalidatePath()` to bust this cache on demand.
      next: { revalidate: 3600 },
    })
    if (res.status === 404) return null
    if (!res.ok) {
      if (isBuildPhase()) {
        logFetchFailure('fetchLegalDocumentByUrlPath (build)', url, `HTTP ${res.status}`)
        return null
      }
      const err = new LegalApiUnavailableError('fetchLegalDocumentByUrlPath', url, {
        status: res.status,
      })
      logFetchFailure('fetchLegalDocumentByUrlPath', url, err)
      throw err
    }
    const body = (await res.json()) as { data: LegalDocumentRender }
    return body.data
  } catch (err) {
    if (err instanceof LegalApiUnavailableError) throw err
    if (isBuildPhase()) {
      logFetchFailure('fetchLegalDocumentByUrlPath (build)', url, err)
      return null
    }
    logFetchFailure('fetchLegalDocumentByUrlPath', url, err)
    throw new LegalApiUnavailableError('fetchLegalDocumentByUrlPath', url, err)
  }
}

/**
 * Fetch the document list for the /trust landing page.
 *
 * Returns the canonical list on success. Throws
 * `LegalApiUnavailableError` on network failure or 5xx so Next.js's
 * error boundary renders a 503 instead of an empty landing page.
 *
 * Build-phase short-circuit: returns `[]` during `next build` so static
 * prerender can complete; ISR revalidates on first runtime request.
 */
export async function fetchTrustCenterLanding(): Promise<LegalDocumentLandingRow[]> {
  const url = `${apiBaseUrl()}/api/v1/public/legal/landing`
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) {
      if (isBuildPhase()) {
        logFetchFailure('fetchTrustCenterLanding (build)', url, `HTTP ${res.status}`)
        return []
      }
      const err = new LegalApiUnavailableError('fetchTrustCenterLanding', url, {
        status: res.status,
      })
      logFetchFailure('fetchTrustCenterLanding', url, err)
      throw err
    }
    const body = (await res.json()) as { data: LegalDocumentLandingRow[] }
    return body.data
  } catch (err) {
    if (err instanceof LegalApiUnavailableError) throw err
    if (isBuildPhase()) {
      logFetchFailure('fetchTrustCenterLanding (build)', url, err)
      return []
    }
    logFetchFailure('fetchTrustCenterLanding', url, err)
    throw new LegalApiUnavailableError('fetchTrustCenterLanding', url, err)
  }
}
