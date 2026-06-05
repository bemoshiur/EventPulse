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
  slug: string
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
  const [slug, setSlug] = useState('')
  const [originalSlug, setOriginalSlug] = useState('')

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
        setSlug(body.data.slug)
        setOriginalSlug(body.data.slug)
      } catch {
        setState({ kind: 'error', message: 'Network error. Please try again.' })
      }
    })()
  }, [eventId])

  async function save(values: EventCreateInput) {
    setSaveError(null)
    try {
      // Send only EventUpdateSchema fields (it's .strict() — `type` and other
      // create-only keys would be rejected). Dates serialise to ISO; the schema
      // coerces them back. Include the slug only when it actually changed.
      const patch: Record<string, unknown> = {
        title: values.title,
        titleBn: values.titleBn,
        description: values.description,
        descriptionBn: values.descriptionBn,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        timezone: values.timezone,
        venue: values.venue,
        capacity: values.capacity,
        visibility: values.visibility,
        bannerImageUrl: values.bannerImageUrl ?? null,
      }
      const trimmedSlug = slug.trim().toLowerCase()
      if (trimmedSlug && trimmedSlug !== originalSlug) patch['slug'] = trimmedSlug

      const res = await fetch(`${apiBase()}/api/v1/tenant/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
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

      <div className="border-mkt-line rounded-2xl border bg-white p-5">
        <label htmlFor="event-slug" className="text-mkt-ink block text-sm font-medium">
          Event link <span className="opacity-70">· ইভেন্ট লিংক</span>
        </label>
        <div className="mt-1 flex items-center gap-1">
          <span className="text-mkt-slate text-sm">…/{`{handle}`}/</span>
          <input
            id="event-slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            autoCapitalize="none"
            spellCheck={false}
            className="border-mkt-line focus:border-mkt-red min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--color-mkt-red)]/30 focus:outline-none"
          />
        </div>
        <p className="text-mkt-slate mt-1 text-xs">
          The last part of your event’s URL. Lowercase letters, numbers and hyphens. Note: renaming
          this changes the link — anything you’ve already shared won’t redirect.
        </p>
      </div>

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
