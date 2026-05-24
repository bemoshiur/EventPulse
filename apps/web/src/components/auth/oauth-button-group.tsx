import { GoogleLogo } from './provider-icons'

/**
 * The OAuth entry point used on sign-in and sign-up (§19.2).
 *
 * Apple Sign-In was DROPPED from MVP scope Sprint 3 Day 23 — see
 * decisions.md "Apple Sign-In dropped from MVP scope". This component
 * ships Google only; re-introducing Apple is a deliberate Phase 2+
 * decision via dedicated PR (restore from git history of this file).
 *
 * The Google button follows the provider's brand guidelines exactly —
 * do not restyle colours, do not relabel.
 *
 * Href is an absolute URL pointing at the API vhost — NOT a relative
 * path to the web vhost. The bug fixed at Day 20 (gotchas.md "OAuth
 * sign-in button hrefs pointed at web vhost instead of API vhost"):
 * relative `/api/auth/google/start` style paths resolved to the
 * Next.js process which 404'd silently. The OAuth start route lives in
 * the Hono API at `/api/v1/auth/oauth/google/start`, so we go there
 * directly via NEXT_PUBLIC_API_BASE_URL. THAT ENV VAR MUST BE SET AT
 * BUILD TIME on staging/prod — otherwise base falls back to '' and
 * the href becomes the relative path, reproducing the Day 20 bug. See
 * gotchas.md "NEXT_PUBLIC_API_BASE_URL missing at Next.js build time
 * silently renders relative OAuth href" (Sprint 3 Day 23).
 *
 * Plain `<a>` rather than `next/link` because next/link is for in-app
 * navigation; OAuth start triggers a full-page redirect to the IdP.
 */

const PROVIDERS = ['google'] as const
type Provider = (typeof PROVIDERS)[number]

function startUrl(provider: Provider): string {
  const base = process.env['NEXT_PUBLIC_API_BASE_URL']?.replace(/\/$/, '') ?? ''
  return `${base}/api/v1/auth/oauth/${provider}/start`
}

export function OAuthButtonGroup() {
  return (
    <div className="flex flex-col gap-3">
      <a
        href={startUrl('google')}
        data-testid="oauth-google-button"
        className="border-ep-line text-ep-ink inline-flex h-12 items-center justify-center gap-3 rounded-md border bg-white px-4 text-sm font-medium transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <GoogleLogo className="h-5 w-5" />
        Continue with Google
      </a>
    </div>
  )
}
