import type { Metadata } from 'next'
import Link from 'next/link'

import { MagicLinkForm } from '@/components/auth/magic-link-form'

/**
 * Super-admin sign-in (browser-auth Day 46). Distinct from `/sign-in` only in
 * that it requests a `super-admin` magic link — the server's #267 grant check
 * still gates it (non-super-admins get 403 at consume). No OAuth (internal
 * staff use the email link); noindex.
 */
export const metadata: Metadata = {
  title: 'Super Admin sign in',
  robots: { index: false, follow: false },
}

export default function AdminSignInPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="text-mkt-ink text-3xl font-semibold tracking-tight">
          Event Pulse
        </h1>
        <p className="text-mkt-slate mt-2 text-sm">Super Admin sign in</p>
      </header>

      <div className="mt-8">
        <MagicLinkForm audience="super-admin" />
      </div>

      <p className="text-mkt-slate mt-8 text-center text-xs">
        Internal staff only. We email you a one-time sign-in link.
      </p>

      <p className="text-mkt-slate mt-4 text-center text-sm">
        Not an admin?{' '}
        <Link href="/sign-in" className="text-mkt-red font-semibold hover:underline">
          Regular sign in
        </Link>
      </p>
    </div>
  )
}
