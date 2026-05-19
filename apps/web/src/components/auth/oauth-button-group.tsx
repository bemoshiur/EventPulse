import { AppleLogo, GoogleLogo } from './provider-icons'

/**
 * The two-button OAuth entry point used on sign-in and sign-up (§19.2).
 * Apple and Google buttons follow each provider's brand guidelines exactly —
 * do not restyle colours, do not relabel.
 *
 * Hrefs are absolute URLs pointing at the API vhost — NOT relative paths
 * to the web vhost. The bug fixed at Day 20 (gotchas.md "OAuth sign-in
 * button hrefs pointed at web vhost instead of API vhost"): relative
 * `/api/auth/google/start` style paths resolved to the Next.js process
 * which 404'd silently. The OAuth start routes live in the Hono API at
 * `/api/v1/auth/oauth/{provider}/start`, so we go there directly.
 *
 * Plain `<a>` rather than `next/link` because next/link is for in-app
 * navigation; OAuth start triggers a full-page redirect to the IdP.
 */

const PROVIDERS = ['apple', 'google'] as const
type Provider = (typeof PROVIDERS)[number]

function startUrl(provider: Provider): string {
  const base = process.env['NEXT_PUBLIC_API_BASE_URL']?.replace(/\/$/, '') ?? ''
  return `${base}/api/v1/auth/oauth/${provider}/start`
}

export function OAuthButtonGroup() {
  return (
    <div className="flex flex-col gap-3">
      <a
        href={startUrl('apple')}
        data-testid="oauth-apple-button"
        className="inline-flex h-12 items-center justify-center gap-3 rounded-md bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <AppleLogo className="h-5 w-5" />
        Continue with Apple
      </a>
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
