import type { Metadata } from 'next'
import Link from 'next/link'

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Reset your Event Pulse password.',
}

export default function ForgotPasswordPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="text-mkt-ink text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-mkt-slate mt-2 text-sm">
          Enter your email and we’ll send you a link to set a new password.
        </p>
      </header>

      <div className="mt-8">
        <ForgotPasswordForm />
      </div>

      <p className="text-mkt-slate mt-6 text-center text-sm">
        Remembered it?{' '}
        <Link href="/sign-in" className="text-mkt-red font-semibold hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
