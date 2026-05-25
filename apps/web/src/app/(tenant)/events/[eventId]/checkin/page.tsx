/**
 * Tenant check-in page — Sprint 4 Day 31 Phase 2.
 *
 * Hosts the `<CheckInScanner>` client component for the given event.
 * Server-component shell mirrors the rest of the tenant portal pages.
 *
 * Auth: the tenant portal layout wraps everything; the API endpoint
 * the scanner hits is `requireTenantAuth`-gated.
 */

import { CheckInScanner } from '@/components/tenant/checkin-scanner'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ eventId: string }>
  searchParams: Promise<{ gate?: string }>
}

export default async function CheckInPage({ params, searchParams }: PageProps) {
  const { eventId } = await params
  const { gate } = await searchParams
  return (
    <div className="space-y-8 text-white">
      <header>
        <h1 className="text-3xl font-bold">Check-in</h1>
        <p className="mt-2 text-base text-white/70">
          Scan attendee QR codes. {gate ? <span>Gate: {gate}</span> : null}
        </p>
      </header>
      <CheckInScanner eventId={eventId} {...(gate ? { gate } : {})} />
    </div>
  )
}
