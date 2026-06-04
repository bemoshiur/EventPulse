'use client'

/**
 * Event manage hub page — `/events/[eventId]`. Fetches the event + the tenant
 * slug (for the public share URL), then renders the EventManage component
 * (publish + share + links to Tickets / Attendees / Check-in). This is where
 * the create flow lands after an event is created.
 */

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { EventManage, type ManagedEvent } from '@/components/tenant/event-manage'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; event: ManagedEvent; tenantSlug: string }

export default function EventManagePage() {
  const params = useParams<{ eventId: string }>()
  const eventId = params.eventId
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    void (async () => {
      try {
        const [evRes, meRes] = await Promise.all([
          fetch(`${apiBase()}/api/v1/tenant/events/${eventId}`, { credentials: 'include' }),
          fetch(`${apiBase()}/api/v1/tenant/me`, { credentials: 'include' }),
        ])
        if (evRes.status === 401 || meRes.status === 401) {
          window.location.assign('/sign-in')
          return
        }
        if (!evRes.ok) {
          setState({ kind: 'error', message: 'Could not load this event.' })
          return
        }
        const evBody = (await evRes.json()) as { data: ManagedEvent }
        const meBody = (await meRes.json().catch(() => ({}))) as {
          data?: { tenant?: { slug?: string } }
        }
        setState({
          kind: 'ready',
          event: evBody.data,
          tenantSlug: meBody.data?.tenant?.slug ?? '',
        })
      } catch {
        setState({ kind: 'error', message: 'Network error. Please try again.' })
      }
    })()
  }, [eventId])

  if (state.kind === 'loading') {
    return (
      <p role="status" className="text-white/70">
        Loading…
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <p role="alert" className="text-ep-rose">
        {state.message}
      </p>
    )
  }
  return <EventManage event={state.event} tenantSlug={state.tenantSlug} />
}
