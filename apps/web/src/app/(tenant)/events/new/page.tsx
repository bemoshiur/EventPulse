'use client'

/**
 * Create-event page — the self-service "create your first event" destination
 * (§2.4 Path A). Renders the existing per-type EventForm and POSTs the validated
 * payload to the tenant Events API. The (tenant) layout's AuthGate guarantees a
 * tenant session here; a user arrives via /choose-tenant → POST /my/hosting/start
 * (which provisions their personal tenant + enters its context).
 */

import { useState } from 'react'

import { EventForm } from '@/components/tenant/event-form-templates'
import type { EventCreateInput, EventType } from '@eventpulse/shared-types'

const TYPES: { value: EventType; label: string }[] = [
  { value: 'concert', label: 'Concert' },
  { value: 'community', label: 'Community meetup' },
  { value: 'conference', label: 'Conference' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'standup', label: 'Comedy / stand-up' },
  { value: 'alumni', label: 'Alumni gathering' },
  { value: 'sports', label: 'Sports' },
  { value: 'other', label: 'Other' },
]

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

export function CreateEvent() {
  const [type, setType] = useState<EventType>('community')
  const [error, setError] = useState<string | null>(null)

  async function createEvent(values: EventCreateInput) {
    setError(null)
    try {
      const res = await fetch(`${apiBase()}/api/v1/tenant/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      })
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { data?: { id?: string } }
        const id = body.data?.id
        window.location.assign(id ? `/events/${id}` : '/dashboard')
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? 'Could not create the event. Please try again.')
    } catch {
      setError('Network error. Please try again.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 text-mkt-ink">
      <header>
        <h1 className="text-3xl font-bold">Create your event</h1>
        <p className="mt-2 text-mkt-slate">
          Fill in the basics — you can add ticket tiers and publish next. Free events go live
          without verification.
        </p>
      </header>

      <div>
        <label htmlFor="event-type" className="mb-1 block text-sm font-medium text-mkt-slate">
          What kind of event?
        </label>
        <select
          id="event-type"
          value={type}
          onChange={(e) => setType(e.target.value as EventType)}
          className="border-mkt-line text-mkt-ink h-11 w-full rounded-md border bg-white px-3 text-sm"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* `key` remounts the form when the type changes so its per-type defaults apply. */}
      <EventForm key={type} type={type} onValidSubmit={createEvent} />

      {error && (
        <p role="alert" className="text-mkt-red text-sm">
          {error}
        </p>
      )}
    </div>
  )
}

export default function NewEventPage() {
  return <CreateEvent />
}
