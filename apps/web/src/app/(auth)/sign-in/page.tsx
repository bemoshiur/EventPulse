import type { Metadata } from 'next'
import Link from 'next/link'
import { MagicLinkForm } from '@/components/auth/magic-link-form'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Event Pulse account.',
}

export default function SignInPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="text-mkt-ink text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-mkt-slate mt-2 text-sm">Welcome back to Event Pulse.</p>
      </header>

      <p className="text-mkt-slate mt-8 text-center text-sm">
        Enter your email and we’ll send you a one-time sign-in link.
      </p>

      <div className="mt-4">
        <MagicLinkForm />
      </div>

      <p className="text-mkt-slate mt-8 text-center text-xs">
        By continuing you agree to our{' '}
        <Link href="/terms" className="text-mkt-ink font-medium hover:underline">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="text-mkt-ink font-medium hover:underline">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="text-mkt-slate mt-4 text-center text-sm">
        New to Event Pulse?{' '}
        <Link href="/sign-up" className="text-mkt-red font-semibold hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
