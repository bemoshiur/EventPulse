import type { Metadata } from 'next'
import { Suspense } from 'react'

import { VerifyEmailClient } from '@/components/auth/verify-email-client'

export const metadata: Metadata = {
  title: 'Confirm your email',
  robots: { index: false },
}

export default function VerifyEmailPage() {
  return (
    <div className="mkt-card w-full max-w-md rounded-3xl p-8 sm:p-10">
      <Suspense fallback={<p className="text-mkt-slate text-center text-sm">Loading…</p>}>
        <VerifyEmailClient />
      </Suspense>
    </div>
  )
}
