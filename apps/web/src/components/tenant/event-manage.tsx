'use client'

/**
 * Event manage hub — the destination after creating an event (§2.4 Path A).
 * Shows the event, lets the organiser PUBLISH it (draft → published via the
 * transition endpoint), and once live surfaces the public share URL. Links out
 * to the existing Tickets / Attendees / Check-in sub-pages.
 */

import Link from 'next/link'
import { useState } from 'react'

export interface ManagedEvent {
  id: string
  slug: string
  status: string
  title: string
  type: string
  startsAt: string
  endsAt: string
}

interface EventManageProps {
  event: ManagedEvent
  tenantSlug: string
}

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

function publicBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_PUBLIC_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : 'https://eventpulse.com.bd'
}

// Statuses whose public page is reachable (the share link is meaningful).
const LIVE = new Set(['published', 'on_sale', 'sold_out', 'live', 'completed'])

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function EventManage({ event, tenantSlug }: EventManageProps) {
  const [status, setStatus] = useState(event.status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const publicUrl = `${publicBase()}/${tenantSlug}/${event.slug}`
  const publicLabel = publicUrl.replace(/^https?:\/\//, '')
  const isLive = LIVE.has(status)

  async function publish() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase()}/api/v1/tenant/events/${event.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ to: 'published' }),
      })
      if (res.ok) {
        setStatus('published')
        setBusy(false)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? 'Could not publish. Please try again.')
      setBusy(false)
    } catch {
      setError('Network error. Please try again.')
      setBusy(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the link is visible to copy manually */
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 text-white">
      <header className="space-y-2">
        <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium tracking-wide text-white/80 uppercase">
          {status.replace(/_/g, ' ')}
        </span>
        <h1 className="text-3xl font-bold">{event.title}</h1>
        <p className="text-white/70">{formatWhen(event.startsAt)} · Asia/Dhaka</p>
      </header>

      {status === 'draft' && (
        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Ready to go live?</h2>
          <p className="text-sm text-white/70">
            Publishing makes your event page public at the link below. Free events go live
            immediately — no verification needed.
          </p>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy}
            className="bg-ep-violet inline-flex h-11 items-center rounded-md px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Publishing…' : 'Publish event'}
          </button>
          {error && (
            <p role="alert" className="text-ep-rose text-sm">
              {error}
            </p>
          )}
        </section>
      )}

      {isLive && (
        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold">Share your event</h2>
          <p className="text-sm text-white/70">Your public event page is live. Share this link:</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="text-ep-mint min-w-0 flex-1 truncate rounded-md bg-black/30 px-3 py-2 text-sm">
              {publicLabel}
            </code>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/20 px-4 text-sm font-medium text-white transition hover:bg-white/10"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/20 px-4 text-sm font-medium text-white transition hover:bg-white/10"
            >
              View page
            </a>
          </div>
        </section>
      )}

      <nav className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { href: `/events/${event.id}/tickets`, label: 'Ticket tiers' },
          { href: `/events/${event.id}/attendees`, label: 'Attendees' },
          { href: `/events/${event.id}/checkin`, label: 'Check-in' },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="hover:border-ep-violet rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-center text-sm font-medium transition hover:-translate-y-0.5"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
