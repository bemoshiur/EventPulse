/**
 * Changelog client helpers — Day 42 §26.1 Day 9 part 3.
 *
 * Server-Component-only helpers that fetch the public changelog from
 * the api workspace. Mirrors the pattern in `lib/legal.ts` for the
 * Trust Center — cross-app direct imports are forbidden per §3.2, so
 * we hop over HTTP and let the api edge-cache do the work.
 *
 * Build-time fetch failures are tolerated (return []) so `next build`
 * doesn't fail when the api is unreachable (CI, prod build pre-service-
 * start). At request time the page revalidates every 5 minutes.
 */

const DEFAULT_BASE_URL = 'http://localhost:4000'

function apiBaseUrl(): string {
  const raw = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? DEFAULT_BASE_URL
  return raw.replace(/\/$/, '')
}

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
      timestamp: new Date().toISOString(),
    }),
  )
}

export interface ChangelogItem {
  slug: string
  version: string
  title: string
  category: string
  bodyHtml: string
  publishedAt: string
}

export async function fetchChangelogIndex(): Promise<ChangelogItem[]> {
  const url = `${apiBaseUrl()}/api/v1/public/changelog`
  try {
    const r = await fetch(url, { next: { revalidate: 300 } })
    if (!r.ok) {
      logFetchFailure(
        isBuildPhase() ? 'fetchChangelogIndex (build)' : 'fetchChangelogIndex',
        url,
        `HTTP ${r.status}`,
      )
      return []
    }
    const body = (await r.json()) as { data?: ChangelogItem[] }
    return body.data ?? []
  } catch (err) {
    logFetchFailure(
      isBuildPhase() ? 'fetchChangelogIndex (build)' : 'fetchChangelogIndex',
      url,
      err,
    )
    return []
  }
}

export async function fetchChangelogByVersion(version: string): Promise<ChangelogItem[]> {
  const url = `${apiBaseUrl()}/api/v1/public/changelog/by-version/${encodeURIComponent(version)}`
  try {
    const r = await fetch(url, { next: { revalidate: 300 } })
    if (!r.ok) {
      logFetchFailure(
        isBuildPhase() ? 'fetchChangelogByVersion (build)' : 'fetchChangelogByVersion',
        url,
        `HTTP ${r.status}`,
      )
      return []
    }
    const body = (await r.json()) as { data?: ChangelogItem[] }
    return body.data ?? []
  } catch (err) {
    logFetchFailure(
      isBuildPhase() ? 'fetchChangelogByVersion (build)' : 'fetchChangelogByVersion',
      url,
      err,
    )
    return []
  }
}
