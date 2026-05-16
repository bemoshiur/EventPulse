import Link from 'next/link'
import { AppleLogo, GoogleLogo } from './provider-icons'

/**
 * The three-button OAuth entry point used on sign-in and sign-up (§19.2).
 * Apple and Google buttons follow each provider's brand guidelines exactly —
 * do not restyle colours, do not relabel.
 *
 * Hrefs are placeholders until the OAuth routes land in Sprint 1 Day 7–8.
 */
export function OAuthButtonGroup() {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/api/auth/apple/start"
        className="inline-flex h-12 items-center justify-center gap-3 rounded-md bg-black px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <AppleLogo className="h-5 w-5" />
        Continue with Apple
      </Link>
      <Link
        href="/api/auth/google/start"
        className="inline-flex h-12 items-center justify-center gap-3 rounded-md border border-ep-line bg-white px-4 text-sm font-medium text-ep-ink transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <GoogleLogo className="h-5 w-5" />
        Continue with Google
      </Link>
    </div>
  )
}
