import type { Metadata } from 'next'
import { Suspense } from 'react'

import { MarketingFooter } from '@/components/marketing/marketing-footer'
import { MarketingNavbar } from '@/components/marketing/marketing-navbar'
import { MyTicketsClient } from '@/components/public/my-tickets-client'

export const metadata: Metadata = {
  title: 'My tickets',
  description: 'View and re-download your Event Pulse tickets.',
  robots: { index: false },
}

export default function MyTicketsPage() {
  return (
    <>
      <MarketingNavbar />
      <main className="mkt-hero min-h-[70vh]">
        <div className="mx-auto max-w-xl px-4 py-16">
          <header className="text-center">
            <h1 className="text-mkt-ink text-3xl font-bold tracking-tight">Your tickets</h1>
            <p className="text-mkt-slate mt-2 text-sm">
              Lost your ticket email? Enter the email you bought with and we’ll send you a link to
              view + re-download your tickets.
            </p>
          </header>
          <div className="mt-8">
            <Suspense fallback={<p className="text-mkt-slate text-center text-sm">Loading…</p>}>
              <MyTicketsClient />
            </Suspense>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </>
  )
}
