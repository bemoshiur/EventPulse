import type { Metadata } from 'next'
import Link from 'next/link'

import { SignUpForm } from '@/components/auth/sign-up-form'

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Create your Event Pulse account with email and a password.',
}

export default function SignUpPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="text-mkt-ink text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-mkt-slate mt-2 text-sm">Run your events. Get paid in 5 days.</p>
      </header>

      <div className="mt-8">
        <SignUpForm />
      </div>

      <p className="text-mkt-slate mt-6 text-center text-xs">
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
