import type { Metadata } from 'next'
import { Suspense } from 'react'

import { ResetPasswordForm } from '@/components/auth/reset-password-form'

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false },
}

export default function ResetPasswordPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <header className="text-center">
        <h1 className="text-mkt-ink text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-mkt-slate mt-2 text-sm">Choose a new password for your account.</p>
      </header>

      <div className="mt-8">
        <Suspense fallback={<p className="text-mkt-slate text-center text-sm">Loading…</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
