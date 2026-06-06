import type { Metadata } from 'next'
import Link from 'next/link'

import { SignInForm } from '@/components/auth/sign-in-form'

/**
 * Super-admin sign-in. Distinct from `/sign-in` only in that it requests a
 * `super-admin` session — the server's grant check still gates it
 * (non-super-admins get 403 at login). Password auth; noindex.
 */
export const metadata: Metadata = {
  title: 'Super Admin sign in',
  robots: { index: false, follow: false },
}

export default function AdminSignInPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="text-mkt-ink text-3xl font-semibold tracking-tight">Event Pulse</h1>
        <p className="text-mkt-slate mt-2 text-sm">Super Admin sign in</p>
      </header>

      <div className="mt-8">
        <SignInForm audience="super-admin" />
      </div>

      <p className="text-mkt-slate mt-8 text-center text-xs">Internal staff only.</p>

      <p className="text-mkt-slate mt-4 text-center text-sm">
        Not an admin?{' '}
        <Link href="/sign-in" className="text-mkt-red font-semibold hover:underline">
          Regular sign in
        </Link>
      </p>
    </div>
  )
}
