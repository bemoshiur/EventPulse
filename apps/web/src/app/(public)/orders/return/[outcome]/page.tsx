'use client'

/**
 * Post-payment return page — where EPS sends the buyer back after checkout.
 * The API's eps-return handler Verifies + settles, then 302s the browser here
 * as /orders/return/{outcome}?orderId=…. We fetch the order status to show a
 * receipt + the issued tickets. `pending` polls (the webhook may settle a moment
 * later). The buyer's QR ticket PDF is delivered by email; this page confirms.
 */

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

function formatBdt(paisa: string): string {
  const big = BigInt(paisa)
  const grouped = (big / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `৳${grouped}.${(big % 100n).toString().padStart(2, '0')}`
}

interface OrderStatus {
  orderId: string
  status: string
  buyerName: string
  buyerEmail: string
  subtotalPaisa: string
  platformFeePaisa: string
  epsFeePaisa: string
  totalPaisa: string
  paidAt: string | null
  event: { title: string; startsAt: string; slug: string; tenantSlug: string; tenantName: string }
  tickets: { attendeeName: string; qrCode: string }[]
}

const PAID = new Set(['paid', 'completed'])

export default function OrderReturnPage({ params }: { params: Promise<{ outcome: string }> }) {
  const { outcome } = use(params)
  const search = useSearchParams()
  const orderId = search.get('orderId')
  const [order, setOrder] = useState<OrderStatus | null>(null)
  const [loading, setLoading] = useState(Boolean(orderId))

  useEffect(() => {
    if (!orderId) return
    let stop = false
    const load = async () => {
      try {
        const res = await fetch(`${apiBase()}/api/v1/public/orders/${orderId}/status`, {
          cache: 'no-store',
        })
        if (res.ok && !stop) {
          const body = (await res.json()) as { data: OrderStatus }
          setOrder(body.data)
        }
      } catch {
        /* keep last state */
      } finally {
        if (!stop) setLoading(false)
      }
    }
    void load()
    // pending: poll up to ~40s for the webhook to settle.
    if (outcome === 'pending') {
      let n = 0
      const iv = setInterval(() => {
        n += 1
        if (n > 10) clearInterval(iv)
        void load()
      }, 4000)
      return () => {
        stop = true
        clearInterval(iv)
      }
    }
    return () => {
      stop = true
    }
  }, [orderId, outcome])

  const isPaid = order ? PAID.has(order.status) : outcome === 'success'
  const eventUrl = order ? `/${order.event.tenantSlug}/${order.event.slug}` : null

  // ─── header by state ───
  let badge: { icon: string; tone: string; title: string; sub: string }
  if (isPaid) {
    badge = {
      icon: '✓',
      tone: 'bg-emerald-600',
      title: 'Payment successful',
      sub: 'Your tickets are confirmed.',
    }
  } else if (outcome === 'pending' || (order && order.status === 'awaiting_payment')) {
    badge = {
      icon: '…',
      tone: 'bg-amber-500',
      title: 'Confirming your payment',
      sub: 'This usually takes a few seconds. This page updates automatically.',
    }
  } else if (outcome === 'cancel') {
    badge = {
      icon: '×',
      tone: 'bg-mkt-slate',
      title: 'Payment cancelled',
      sub: 'You cancelled the payment. No charge was made.',
    }
  } else {
    badge = {
      icon: '!',
      tone: 'bg-mkt-red',
      title: 'Payment not completed',
      sub: 'Your payment could not be confirmed. If you were charged, it will be auto-refunded.',
    }
  }

  return (
    <main className="mkt-hero text-mkt-ink min-h-screen font-[family-name:var(--font-bangla)]">
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="mkt-card rounded-3xl p-8 text-center">
          <div
            className={`mx-auto flex size-14 items-center justify-center rounded-full text-2xl font-bold text-white ${badge.tone}`}
          >
            {badge.icon}
          </div>
          <h1 className="text-mkt-ink mt-4 text-2xl font-bold">{badge.title}</h1>
          <p className="text-mkt-slate mt-2 text-sm">{badge.sub}</p>

          {loading && <p className="text-mkt-slate mt-6 text-sm">Loading your order…</p>}

          {order && (
            <div className="border-mkt-line mt-6 rounded-2xl border bg-white p-5 text-left">
              <p className="text-mkt-slate text-xs font-semibold tracking-wide uppercase">
                {order.event.tenantName}
              </p>
              <h2 className="text-mkt-ink mt-1 text-lg font-semibold">{order.event.title}</h2>
              <p className="text-mkt-slate mt-1 text-sm">
                {new Intl.DateTimeFormat('en-GB', {
                  timeZone: 'Asia/Dhaka',
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(order.event.startsAt))}
              </p>

              {/* Receipt / invoice */}
              <dl className="text-mkt-slate mt-4 space-y-1 border-t border-dashed border-[var(--color-mkt-line)] pt-4 text-sm">
                <div className="flex justify-between">
                  <dt>Subtotal</dt>
                  <dd className="text-mkt-ink font-mono">{formatBdt(order.subtotalPaisa)}</dd>
                </div>
                {order.platformFeePaisa !== '0' && (
                  <div className="flex justify-between">
                    <dt>Platform fee</dt>
                    <dd className="text-mkt-ink font-mono">{formatBdt(order.platformFeePaisa)}</dd>
                  </div>
                )}
                {order.epsFeePaisa !== '0' && (
                  <div className="flex justify-between">
                    <dt>Payment fee</dt>
                    <dd className="text-mkt-ink font-mono">{formatBdt(order.epsFeePaisa)}</dd>
                  </div>
                )}
                <div className="text-mkt-ink flex justify-between border-t border-[var(--color-mkt-line)] pt-1 font-semibold">
                  <dt>Total paid</dt>
                  <dd className="font-mono">{formatBdt(order.totalPaisa)}</dd>
                </div>
              </dl>

              {isPaid && (
                <div className="mt-4 border-t border-dashed border-[var(--color-mkt-line)] pt-4">
                  <p className="text-mkt-ink text-sm font-semibold">
                    {order.tickets.length || 1} ticket
                    {(order.tickets.length || 1) === 1 ? '' : 's'} confirmed
                  </p>
                  <p className="text-mkt-slate mt-1 text-sm">
                    Your QR ticket{order.tickets.length === 1 ? '' : 's'}{' '}
                    {order.tickets.length === 1 ? 'has' : 'have'} been emailed to{' '}
                    <span className="text-mkt-ink font-medium">{order.buyerEmail}</span>. Show the
                    QR at the gate.
                  </p>
                  {order.tickets.length > 0 && (
                    <ul className="text-mkt-slate mt-2 space-y-1 text-xs">
                      {order.tickets.map((t) => (
                        <li key={t.qrCode} className="flex justify-between">
                          <span className="text-mkt-ink">{t.attendeeName}</span>
                          <span className="font-mono">{t.qrCode.slice(0, 10)}…</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
            {!isPaid && eventUrl && (
              <Link
                href={eventUrl}
                className="bg-mkt-red inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                Try again
              </Link>
            )}
            <Link
              href={eventUrl ?? '/'}
              className="border-mkt-line text-mkt-ink inline-flex h-11 items-center justify-center rounded-md border px-6 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              {isPaid && eventUrl ? 'Back to event' : 'Back to Event Pulse'}
            </Link>
          </div>
        </div>

        <p className="text-mkt-slate mt-4 text-center text-xs">
          Questions about your order?{' '}
          <Link href="/contact" className="text-mkt-red hover:underline">
            Contact us
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
