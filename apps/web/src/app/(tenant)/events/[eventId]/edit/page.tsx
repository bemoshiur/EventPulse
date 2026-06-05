'use client'

/**
 * Edit-event page — the "change anything after creation" surface (§2.4).
 * Loads the event via GET /tenant/events/:id, pre-fills the same per-type
 * EventForm used by create, and on submit PATCHes /tenant/events/:id. The
 * (tenant) layout's AuthGate guarantees a tenant session; the API re-checks
 * ownership. Status edits are NOT here (use the publish/transition controls on
 * the manage hub) — this edits the event's details only.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

import { EventForm } from '@/components/tenant/event-form-templates'
import type { EventCreateInput, EventType } from '@eventpulse/shared-types'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface EventDetail {
  id: string
  type: EventType
  title: string
  titleBn: string | null
  description: string | null
  descriptionBn: string | null
  startsAt: string
  endsAt: string
  timezone: string
  visibility: 'public' | 'unlisted' | 'private'
  capacity: number | null
  venue: EventCreateInput['venue']
  bannerImageUrl: string | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; event: EventDetail }

export function EditEvent() {
  const params = useParams<{ eventId: string }>()
  const eventId = params.eventId
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/tenant/events/${eventId}`, {
          credentials: 'include',
        })
        if (!res.ok) {
          setState({ kind: 'error', message: 'Could not load this event. Please try again.' })
          return
        }
        const body = (await res.json()) as { data: EventDetail }
        setState({ kind: 'ready', event: body.data })
      } catch {
        setState({ kind: 'error', message: 'Network error. Please try again.' })
      }
    })()
  }, [eventId])

  async function save(values: EventCreateInput) {
    setSaveError(null)
    try {
      // EventUpdateSchema accepts the same field shape (all optional). Dates
      // serialise to ISO via JSON.stringify; the schema coerces them back.
      const res = await fetch(`${apiBase()}/api/v1/tenant/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      })
      if (res.ok) {
        window.location.assign(`/events/${eventId}`)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setSaveError(body.error?.message ?? 'Could not save your changes. Please try again.')
    } catch {
      setSaveError('Network error. Please try again.')
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="text-mkt-slate mx-auto max-w-2xl py-12 text-sm" role="status">
        Loading event…
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="text-mkt-red mx-auto max-w-2xl py-12 text-sm" role="alert">
        {state.message}
      </div>
    )
  }

  const { event } = state
  const initialValues: Partial<EventCreateInput> = {
    title: event.title,
    titleBn: event.titleBn ?? '',
    description: event.description ?? '',
    descriptionBn: event.descriptionBn ?? '',
    startsAt: new Date(event.startsAt),
    endsAt: new Date(event.endsAt),
    timezone: event.timezone,
    visibility: event.visibility,
    capacity: event.capacity,
    venue: event.venue,
    bannerImageUrl: event.bannerImageUrl ?? '',
  }

  return (
    <div className="text-mkt-ink mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Edit your event</h1>
        <p className="text-mkt-slate mt-2">
          Update the details below. Changes go live immediately on your event page.
        </p>
      </header>

      <EventForm type={event.type} initialValues={initialValues} onValidSubmit={save} />

      {saveError && (
        <p role="alert" className="text-mkt-red text-sm">
          {saveError}
        </p>
      )}
    </div>
  )
}

export default function EditEventPage() {
  return <EditEvent />
}
