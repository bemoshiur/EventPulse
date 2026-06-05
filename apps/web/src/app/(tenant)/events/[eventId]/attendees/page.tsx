'use client'

/**
 * Tenant attendee list page — Sprint 4 Day 32 Phase 2.
 *
 * URL: /events/[eventId]/attendees (under the tenant route group).
 *
 * The route group's tenant layout handles auth; the API auth gate
 * runs on each fetch (same pattern as the tickets page).
 *
 * Surface today:
 *   - Search by name/email
 *   - Filter by tier / check-in status / order status
 *   - Cursor-paginated list with "Next page" + "Back to top"
 *   - Live check-in status column (Day-31 loop closure)
 */

import { useParams } from 'next/navigation'

import { AttendeeList } from '@/components/tenant/attendee-list'
import { useTenantTiers } from '@/hooks/use-tenant-tiers'

export default function TenantAttendeesPage() {
  const params = useParams<{ eventId: string }>()
  const eventId = params.eventId

  // Active tiers only (operational pattern matches the tickets page).
  // The tier filter excludes archived tiers — if an organiser sold
  // tickets under an archived tier, those attendees still appear in
  // the "All tiers" view; the dropdown is just a quick-pick UX
  // affordance, not a data scope.
  const { data: tierRows } = useTenantTiers(eventId, false)
  const tiers = (tierRows ?? []).map((t) => ({ id: t.id, name: t.name }))

  return (
    <div className="text-mkt-ink space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Attendees</h1>
        <p className="text-mkt-slate mt-2 text-base">
          Everyone registered for this event. Filter, search, and see live check-in status pulled
          straight from the door scanner.
        </p>
      </header>
      <AttendeeList eventId={eventId} tiers={tiers} />
    </div>
  )
}
