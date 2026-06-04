import type { Metadata } from 'next'
import Link from 'next/link'
import { MagicLinkForm } from '@/components/auth/magic-link-form'

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Create your Event Pulse account — no password, just your email.',
}

/**
 * Passwordless sign-up. Same email-link flow as sign-in, with `purpose=signup`
 * so the magic-link consume CREATES the account if the email is new (an
 * existing email just signs in — the endpoint never reveals which). No password
 * or name step: the account is created from the email; the display name is
 * derived and editable later in settings. Fixes the Day-47 `/sign-up` 404 that
 * every marketing "Start free" CTA pointed at.
 */
export default function SignUpPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="text-mkt-ink text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-mkt-slate mt-2 text-sm">Run your events. Get paid in 5 days.</p>
      </header>

      <p className="text-mkt-slate mt-8 text-center text-sm">
        Enter your email — we’ll send you a link to get started. No password needed.
      </p>

      <div className="mt-4">
        <MagicLinkForm purpose="signup" />
      </div>

      <p className="text-mkt-slate mt-8 text-center text-xs">
        By creating an account you agree to our{' '}
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
        Already have an account?{' '}
        <Link href="/sign-in" className="text-mkt-red font-semibold hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
