'use client'

/**
 * "My tickets" buyer self-service (QA P1-1/P1-4). Two modes:
 *  - no ?token  → email form → POST /public/orders/find (emails a link).
 *  - ?token=…   → POST /public/orders/by-token → list the buyer's orders +
 *                 tickets with a PDF re-download per order.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CalendarDays, Download, Mail, Ticket } from 'lucide-react'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

interface Order {
  orderId: string
  status: string
  event: { title: string; startsAt: string; slug: string; tenantSlug: string; tenantName: string }
  tickets: { attendeeName: string; qrCode: string }[]
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function MyTicketsClient() {
  const token = useSearchParams().get('token')
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [linkState, setLinkState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const fired = useRef(false)

  // Token mode — list tickets once.
  useEffect(() => {
    if (!token || fired.current) return
    fired.current = true
    setLinkState('loading')
    void (async () => {
      try {
        const r = await fetch(`${apiBase()}/api/v1/public/orders/by-token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (r.ok) {
          const b = (await r.json()) as { data: Order[] }
          setOrders(b.data)
          setLinkState('idle')
        } else {
          setLinkState('error')
        }
      } catch {
        setLinkState('error')
      }
    })()
  }, [token])

  async function requestLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await fetch(`${apiBase()}/api/v1/public/orders/find`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
    } catch {
      /* same state regardless */
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  // ── Token mode: results ──
  if (token) {
    if (linkState === 'loading') {
      return <p className="text-mkt-slate text-center text-sm">Loading your tickets…</p>
    }
    if (linkState === 'error') {
      return (
        <div className="text-center">
          <p className="text-mkt-ink font-semibold">This link is invalid or expired</p>
          <p className="text-mkt-slate mt-1 text-sm">Links are single-use and expire quickly.</p>
          <Link
            href="/my-tickets"
            className="bg-mkt-red mt-4 inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold text-white"
          >
            Request a new link
          </Link>
        </div>
      )
    }
    if (orders && orders.length === 0) {
      return <p className="text-mkt-slate text-center text-sm">No tickets found for this email.</p>
    }
    return (
      <div className="space-y-4">
        {(orders ?? []).map((o) => (
          <div key={o.orderId} className="border-mkt-line rounded-2xl border bg-white p-5">
            <p className="text-mkt-slate text-xs font-semibold tracking-wide uppercase">
              {o.event.tenantName}
            </p>
            <Link
              href={`/${o.event.tenantSlug}/${o.event.slug}`}
              className="text-mkt-ink hover:text-mkt-red text-lg font-semibold"
            >
              {o.event.title}
            </Link>
            <p className="text-mkt-slate mt-1 flex items-center gap-1.5 text-sm">
              <CalendarDays className="size-3.5" />
              {formatDate(o.event.startsAt)}
            </p>
            <p className="text-mkt-ink mt-3 text-sm font-medium">
              {o.tickets.length || 1} ticket{(o.tickets.length || 1) === 1 ? '' : 's'}
              {o.tickets.length > 0 && (
                <span className="text-mkt-slate font-normal">
                  {' '}
                  · {o.tickets.map((t) => t.attendeeName).join(', ')}
                </span>
              )}
            </p>
            <a
              href={`${apiBase()}/api/v1/public/orders/${o.orderId}/tickets.pdf`}
              className="bg-mkt-red mt-3 inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow"
            >
              <Download className="size-4" /> Download tickets (PDF)
            </a>
          </div>
        ))}
      </div>
    )
  }

  // ── Email-entry mode ──
  if (sent) {
    return (
      <div className="border-mkt-line rounded-2xl border bg-white/70 p-6 text-center">
        <div className="bg-mkt-red/10 text-mkt-red mx-auto flex size-12 items-center justify-center rounded-full">
          <Mail className="size-6" />
        </div>
        <p className="text-mkt-ink mt-3 font-semibold">Check your email</p>
        <p className="text-mkt-slate mt-1 text-sm">
          If <span className="text-mkt-ink font-medium">{email}</span> has any tickets, we’ve sent a
          link to view them.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={requestLink} className="flex flex-col gap-3">
      <div className="relative">
        <Mail className="text-mkt-slate/60 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="The email you used to buy tickets"
          disabled={submitting}
          className="border-mkt-line text-mkt-ink placeholder:text-mkt-slate/50 focus:border-mkt-red h-12 w-full rounded-md border bg-white pr-3 pl-9 text-sm focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="bg-mkt-red inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
      >
        <Ticket className="size-4" />
        {submitting ? 'Sending…' : 'Email me my tickets'}
      </button>
    </form>
  )
}
