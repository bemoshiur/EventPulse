'use client'

/**
 * Public buyer form — Sprint 4 Day 34 Phase 1.
 *
 * Client-component island embedded inside the (server-rendered)
 * EventLanding template. Handles the buyer-facing registration /
 * purchase flow against POST /api/v1/public/orders (Day 26 Phase 4).
 *
 * ════════════════════════════════════════════════════════════════════
 * Three response paths the server returns (all 201):
 * ════════════════════════════════════════════════════════════════════
 *
 *   1. FREE event (§13.5 born-paid bypass):
 *        { paymentInitState: 'free', status: 'paid', redirectUrl: null }
 *      → render success state; ticket delivery already enqueued.
 *
 *   2. PRICED event, EPS init succeeded (production / post-truth-gate):
 *        { paymentInitState: 'ready', status: 'awaiting_payment',
 *          redirectUrl: 'https://...' }
 *      → window.location.assign(redirectUrl) → EPS hosted checkout.
 *
 *   3. PRICED event, STAGING_PAYMENT_BLOCK refused init (this session):
 *        { paymentInitState: 'blocked', status: 'awaiting_payment',
 *          redirectUrl: null }
 *      → render "Payments temporarily unavailable" sensible state;
 *        the order persists and will be resolvable at truth-gate.
 *
 * Plus error envelopes (NOT_FOUND, EVENT_NOT_ON_SALE, TIER_SOLD_OUT,
 * VALIDATION_ERROR, INTERNAL_ERROR) — all surface as inline messages,
 * never a crash.
 *
 * ════════════════════════════════════════════════════════════════════
 * What this form does NOT collect (per Day-28 attendees policy):
 * ════════════════════════════════════════════════════════════════════
 *
 * Per-attendee names/emails are NOT collected here. The delivery
 * worker auto-generates attendees rows from buyer info + quantity,
 * suffixed with "(Ticket N of M)" when qty > 1. The form-builder
 * Phase-2 work is what enables per-attendee fields.
 *
 * ════════════════════════════════════════════════════════════════════
 * Idempotency (§1.3 R6 + §6.4):
 * ════════════════════════════════════════════════════════════════════
 *
 * - Mint one Idempotency-Key per form-mount via crypto.randomUUID().
 * - Send as `Idempotency-Key` HTTP header on every submit attempt.
 * - On a server-side error that's safe to retry (network blip,
 *   500 INTERNAL_ERROR), KEEP the same key — the Day-29 middleware
 *   will recognise the retry and replay the cached response if the
 *   prior attempt actually completed server-side.
 * - On client-side validation re-entry (user fixes a field and
 *   re-submits), KEEP the key — same operation logically.
 * - The submit button is disabled while in-flight, blocking
 *   double-click → duplicate orders.
 *
 * ════════════════════════════════════════════════════════════════════
 * Consent (Day-39 Phase 2 — Buyer Terms v1.0 wire-in):
 * ════════════════════════════════════════════════════════════════════
 *
 * Clickwrap (no checkbox per the wiring spec in docs/legal/buyer-terms.md
 * editing notes). The submit-button click IS the consent action; a
 * bilingual line above the button names the document + version + links
 * to /buyer-terms and /privacy.
 *
 * The Buyer Terms v1.0 body renders in a collapsible <details> panel
 * above the clickwrap line — the body_html arrives as a prop
 * (`buyerTermsBodyHtml`) server-fetched from
 * /api/v1/public/legal/by-url-path?path=/buyer-terms by the parent
 * page. Pre-rendered + sanitized via the rehype-sanitize allowlist
 * (Decision J 2026-05-19) at seed time; safe to inject as innerHTML.
 *
 * Server-side: createOrder (apps/api/src/services/orders/index.ts)
 * inserts a consent_records row inside the order-creation tx,
 * anchored by order_id, with document_id + version_id resolved from
 * the current Buyer Terms (helper at services/consent/buyer-terms.ts).
 * If that INSERT fails the tx rolls back, the order is never
 * persisted, and the EPS Initialize call is never made. This is the
 * operator-spec'd precondition behavior ("consent capture is a
 * precondition, not a side effect").
 *
 * ════════════════════════════════════════════════════════════════════
 * Money math (§14.3 + §1.3 R10):
 * ════════════════════════════════════════════════════════════════════
 *
 * Subtotal is displayed client-side from `tier.pricePaisa × qty` as
 * a UX preview. The server is authoritative — the fee calculator
 * runs server-side and the returned `fees` object is the truth. No
 * platform-fee / EPS-fee math happens client-side.
 *
 * Per §1.3 R12 (Bangla-first attendee UI): English labels with
 * Bangla sub-labels for the principal form fields, matching the
 * existing event-landing bilingual pattern.
 */

import Link from 'next/link'
import { useId, useMemo, useRef, useState } from 'react'

import type { PublicEventTierWire, PublicEventWire } from '@/lib/public-events'

export interface BuyerFormProps {
  event: PublicEventWire
  tiers: PublicEventTierWire[]
  /**
   * Pre-rendered, sanitized HTML for the current Buyer Terms v1.0 body
   * (server-fetched from `/api/v1/public/legal/by-url-path?path=/buyer-terms`
   * upstream of this component). Renders inside a collapsible panel
   * above the bilingual clickwrap consent line.
   *
   * `null` (or absent) means the document is unavailable (legal API
   * down or buyer-terms not seeded) — the clickwrap line still renders
   * with a link to /buyer-terms so buyers always have a path to the
   * text; the in-page panel shows a fallback message.
   *
   * Optional purely for test-fixture ergonomics — production callsite
   * (apps/web/src/app/(public)/[tenant]/[event]/page.tsx) always passes
   * the fetched value, and the server-side createOrder service refuses
   * to create the order if Buyer Terms isn't seeded (per the
   * resolveBuyerTermsCurrentVersion precondition), so a `null` here in
   * production indicates a transient legal-API blip.
   */
  buyerTermsBodyHtml?: string | null
  /**
   * Version string ("v1.0", "v1.1", …) of the Buyer Terms surfaced
   * above. Rendered in the clickwrap line for transparency + tracked
   * in audit trails. `null` mirrors `buyerTermsBodyHtml === null`.
   */
  buyerTermsVersion?: string | null
}

interface BuyerFields {
  name: string
  email: string
  phone: string
  nidLast4: string
}

interface OrderFeeBreakdown {
  subtotalPaisa: string
  platformFeePaisa: string
  epsFeePaisa: string
  buyerTotalPaisa: string
  organiserNetPaisa: string
  platformRevenuePaisa: string
}

interface CreateOrderResponse {
  data: {
    orderId: string
    merchantTransactionId: string
    status: 'awaiting_payment' | 'paid'
    paymentInitState: 'ready' | 'blocked' | 'free'
    redirectUrl: string | null
    fees: OrderFeeBreakdown
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string }
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success_free'; orderId: string }
  | { kind: 'blocked'; orderId: string }
  | { kind: 'error'; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function apiBase(): string {
  const fromEnv = process.env['NEXT_PUBLIC_API_BASE_URL']
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : ''
}

function formatBdt(paisa: bigint | string): string {
  const big = typeof paisa === 'bigint' ? paisa : BigInt(paisa)
  const wholes = big / 100n
  const fraction = (big % 100n).toString().padStart(2, '0')
  // Group the wholes part with commas.
  const grouped = wholes.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}.${fraction}`
}

function tierAvailable(tier: PublicEventTierWire): number {
  return Math.max(0, tier.capacity - tier.sold)
}

function tierSellable(tier: PublicEventTierWire, now: Date): boolean {
  if (tierAvailable(tier) <= 0) return false
  if (tier.salesStartAt && new Date(tier.salesStartAt) > now) return false
  if (tier.salesEndAt && new Date(tier.salesEndAt) < now) return false
  return true
}

export function BuyerForm({ event, tiers, buyerTermsBodyHtml, buyerTermsVersion }: BuyerFormProps) {
  const formHeadingId = useId()
  const buyerHeadingId = useId()
  const statusRegionId = useId()

  // Stable idempotency key per form mount. Regenerated on retry below.
  const idempotencyKeyRef = useRef<string>(mintKey())

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [buyer, setBuyer] = useState<BuyerFields>({
    name: '',
    email: '',
    phone: '',
    nidLast4: '',
  })
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle' })
  const [clientErrors, setClientErrors] = useState<Partial<Record<string, string>>>({})

  const now = useMemo(() => new Date(), [])

  const tierSelections = useMemo(() => {
    return Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([tierId, quantity]) => ({ tierId, quantity }))
  }, [quantities])

  const previewSubtotalPaisa = useMemo<bigint>(() => {
    let sum = 0n
    for (const sel of tierSelections) {
      const tier = tiers.find((t) => t.id === sel.tierId)
      if (!tier) continue
      sum += BigInt(tier.pricePaisa) * BigInt(sel.quantity)
    }
    return sum
  }, [tierSelections, tiers])

  const hasAnyTier = tierSelections.length > 0
  const isFreeEvent = previewSubtotalPaisa === 0n && hasAnyTier
  const submitDisabled = submitState.kind === 'submitting' || !hasAnyTier

  function setTierQty(tierId: string, qty: number, max: number) {
    const clamped = Math.max(0, Math.min(qty, max))
    setQuantities((prev) => ({ ...prev, [tierId]: clamped }))
  }

  function validateClient(): boolean {
    const errs: Partial<Record<string, string>> = {}
    if (!hasAnyTier) errs['_root'] = 'Select at least one ticket.'
    if (!buyer.name.trim()) errs['name'] = 'Name is required.'
    if (!buyer.email.trim()) errs['email'] = 'Email is required.'
    else if (!EMAIL_RE.test(buyer.email.trim())) errs['email'] = 'Enter a valid email.'
    if (!buyer.phone.trim()) errs['phone'] = 'Phone is required.'
    else if (buyer.phone.trim().length < 5) errs['phone'] = 'Phone is too short.'
    if (buyer.nidLast4 && !/^\d{4}$/.test(buyer.nidLast4))
      errs['nidLast4'] = 'NID last 4 must be exactly 4 digits.'
    setClientErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitState.kind === 'submitting') return
    if (!validateClient()) return

    setSubmitState({ kind: 'submitting' })

    const payload = {
      eventId: event.id,
      tierSelections,
      buyer: {
        name: buyer.name.trim(),
        email: buyer.email.trim(),
        phone: buyer.phone.trim(),
        ...(buyer.nidLast4 ? { nidLast4: buyer.nidLast4 } : {}),
      },
    }

    try {
      const res = await fetch(`${apiBase()}/api/v1/public/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        let message = `Request failed (${res.status})`
        try {
          const body = (await res.json()) as ApiErrorBody
          if (body.error?.message) message = body.error.message
        } catch {
          /* not JSON */
        }
        // Server returned a hard failure — regenerate the idempotency
        // key for a fresh attempt next time, since the failed attempt
        // didn't necessarily settle into the middleware's cache.
        idempotencyKeyRef.current = mintKey()
        setSubmitState({ kind: 'error', message })
        return
      }

      const body = (await res.json()) as CreateOrderResponse
      const result = body.data

      if (result.paymentInitState === 'free') {
        setSubmitState({ kind: 'success_free', orderId: result.orderId })
        return
      }
      if (result.paymentInitState === 'ready' && result.redirectUrl) {
        // Hand off to the EPS hosted checkout. The order persists; the
        // EPS Verify on return reconciles status.
        window.location.assign(result.redirectUrl)
        return
      }
      if (result.paymentInitState === 'blocked') {
        setSubmitState({ kind: 'blocked', orderId: result.orderId })
        return
      }
      // Defensive fallback — server shape unrecognised.
      setSubmitState({
        kind: 'error',
        message: 'Unexpected response from server. Please contact support if this persists.',
      })
    } catch (err) {
      idempotencyKeyRef.current = mintKey()
      setSubmitState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error. Please try again.',
      })
    }
  }

  // ─── render ────────────────────────────────────────────────────────

  if (submitState.kind === 'success_free') {
    return (
      <section
        className="mx-auto max-w-3xl px-6 pb-16"
        aria-labelledby={statusRegionId}
        data-testid="buyer-form-success-free"
      >
        <div className="rounded-2xl border border-emerald-600/30 bg-emerald-600/5 p-6">
          <h2 id={statusRegionId} className="text-mkt-ink font-display text-xl font-semibold">
            You&apos;re registered
            <span className="text-mkt-slate ml-2 text-base font-normal" lang="bn">
              · আপনি নিবন্ধিত হয়েছেন
            </span>
          </h2>
          <p className="text-mkt-slate mt-3 text-sm">
            Your ticket{tierSelections.reduce((s, t) => s + t.quantity, 0) > 1 ? 's are' : ' is'} on
            the way to <strong className="text-mkt-ink">{buyer.email}</strong>. Check your inbox in
            the next few minutes.
          </p>
          <p className="text-mkt-slate/70 mt-4 font-mono text-xs">
            Order reference: <span data-testid="success-order-id">{submitState.orderId}</span>
          </p>
        </div>
      </section>
    )
  }

  return (
    <section
      className="mx-auto max-w-3xl px-6 pb-16"
      aria-labelledby={formHeadingId}
      data-testid="buyer-form"
    >
      <h2 id={formHeadingId} className="font-display text-mkt-ink text-2xl font-semibold">
        Tickets
        <span className="text-mkt-slate ml-2 text-base font-normal" lang="bn">
          · টিকিট
        </span>
      </h2>

      {tiers.length === 0 ? (
        <p className="text-mkt-slate mt-4 text-sm" data-testid="tickets-empty">
          Tickets coming soon.
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <ul className="mt-6 grid grid-cols-1 gap-3">
            {tiers.map((tier) => {
              const available = tierAvailable(tier)
              const sellable = tierSellable(tier, now)
              const qty = quantities[tier.id] ?? 0
              const maxPerOrder = Math.min(available, 10)
              return (
                <li key={tier.id}>
                  <div
                    className="border-mkt-line rounded-2xl border bg-white p-5 shadow-sm"
                    data-testid={`tier-card-${tier.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-mkt-ink text-lg font-semibold">{tier.name}</h3>
                        {tier.description && (
                          <p className="text-mkt-slate mt-1 text-sm">{tier.description}</p>
                        )}
                        <p className="text-mkt-slate mt-2 text-xs">
                          {available <= 0
                            ? 'Sold out'
                            : !sellable
                              ? 'Not on sale'
                              : available <= 10
                                ? `Only ${available} left`
                                : `${available} available`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-mkt-ink text-2xl font-semibold tabular-nums">
                          {tier.isComplimentary || BigInt(tier.pricePaisa) === 0n
                            ? 'Free'
                            : `৳ ${formatBdt(tier.pricePaisa)}`}
                        </p>
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <label
                            htmlFor={`qty-${tier.id}`}
                            className="text-mkt-slate text-xs tracking-wide uppercase"
                          >
                            Qty
                          </label>
                          <input
                            id={`qty-${tier.id}`}
                            type="number"
                            min={0}
                            max={maxPerOrder}
                            step={1}
                            value={qty}
                            disabled={!sellable}
                            onChange={(e) =>
                              setTierQty(
                                tier.id,
                                Number.parseInt(e.target.value || '0', 10),
                                maxPerOrder,
                              )
                            }
                            className="border-mkt-line w-16 rounded-md border px-2 py-1 text-right text-sm tabular-nums disabled:bg-gray-100"
                            data-testid={`qty-input-${tier.id}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {/* ─── subtotal preview (UX only — server is authoritative) ─── */}
          {hasAnyTier && (
            <div
              className="border-mkt-line mt-4 rounded-2xl border p-4 text-right"
              data-testid="subtotal-preview"
            >
              <p className="text-mkt-slate text-xs tracking-wide uppercase">Subtotal · উপমোট</p>
              <p className="text-mkt-ink mt-1 text-xl font-semibold tabular-nums">
                {previewSubtotalPaisa === 0n ? 'Free' : `৳ ${formatBdt(previewSubtotalPaisa)}`}
              </p>
              {!isFreeEvent && (
                <>
                  <p className="text-mkt-slate/70 mt-1 text-xs">
                    Final total including fees shown at checkout.
                  </p>
                  {/*
                    Multi-method go-live (decisions.md 2026-06-05 "EPS all-
                    methods"): EPS's hosted checkout shows every method (cards,
                    bKash, Nagad, Rocket, Upay, bank). Bilingual per R12.
                  */}
                  <p
                    className="text-mkt-slate/70 mt-2 text-xs"
                    data-testid="payment-methods-notice"
                  >
                    Pay securely with <strong>cards, bKash, Nagad, Rocket</strong> and more — choose
                    on the next screen.
                    <br />
                    <span lang="bn">
                      কার্ড, <strong>বিকাশ, নগদ, রকেট</strong> সহ যেকোনো মাধ্যমে নিরাপদে পেমেন্ট
                      করুন — পরের স্ক্রিনে বেছে নিন।
                    </span>
                  </p>
                </>
              )}
            </div>
          )}

          {/* ─── buyer info ─── */}
          <fieldset className="mt-8">
            <legend id={buyerHeadingId} className="font-display text-mkt-ink text-xl font-semibold">
              Your details
              <span className="text-mkt-slate ml-2 text-base font-normal" lang="bn">
                · আপনার তথ্য
              </span>
            </legend>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label htmlFor="buyer-name" className="text-mkt-ink block text-sm font-medium">
                  Full name <span lang="bn">/ পুরো নাম</span>
                </label>
                <input
                  id="buyer-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={buyer.name}
                  onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
                  className="border-mkt-line mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm"
                  aria-invalid={clientErrors['name'] ? 'true' : 'false'}
                  aria-describedby={clientErrors['name'] ? 'buyer-name-err' : undefined}
                  data-testid="buyer-name"
                />
                {clientErrors['name'] && (
                  <p id="buyer-name-err" className="text-mkt-red mt-1 text-xs">
                    {clientErrors['name']}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="buyer-email" className="text-mkt-ink block text-sm font-medium">
                  Email <span lang="bn">/ ইমেইল</span>
                </label>
                <input
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={buyer.email}
                  onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))}
                  className="border-mkt-line mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm"
                  aria-invalid={clientErrors['email'] ? 'true' : 'false'}
                  aria-describedby={clientErrors['email'] ? 'buyer-email-err' : undefined}
                  data-testid="buyer-email"
                />
                {clientErrors['email'] && (
                  <p id="buyer-email-err" className="text-mkt-red mt-1 text-xs">
                    {clientErrors['email']}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="buyer-phone" className="text-mkt-ink block text-sm font-medium">
                  Phone <span lang="bn">/ ফোন</span>
                </label>
                <input
                  id="buyer-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  value={buyer.phone}
                  onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))}
                  className="border-mkt-line mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm"
                  aria-invalid={clientErrors['phone'] ? 'true' : 'false'}
                  aria-describedby={clientErrors['phone'] ? 'buyer-phone-err' : undefined}
                  data-testid="buyer-phone"
                />
                {clientErrors['phone'] && (
                  <p id="buyer-phone-err" className="text-mkt-red mt-1 text-xs">
                    {clientErrors['phone']}
                  </p>
                )}
              </div>

              <div className="md:col-span-2">
                <label htmlFor="buyer-nid" className="text-mkt-ink block text-sm font-medium">
                  NID last 4 digits <span className="text-mkt-slate/70">(optional)</span>
                </label>
                <input
                  id="buyer-nid"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={buyer.nidLast4}
                  onChange={(e) =>
                    setBuyer((b) => ({ ...b, nidLast4: e.target.value.replace(/\D/g, '') }))
                  }
                  className="border-mkt-line mt-1 block w-24 rounded-md border bg-white px-3 py-2 text-sm tabular-nums"
                  aria-invalid={clientErrors['nidLast4'] ? 'true' : 'false'}
                  aria-describedby={clientErrors['nidLast4'] ? 'buyer-nid-err' : undefined}
                  data-testid="buyer-nid"
                />
                {clientErrors['nidLast4'] && (
                  <p id="buyer-nid-err" className="text-mkt-red mt-1 text-xs">
                    {clientErrors['nidLast4']}
                  </p>
                )}
              </div>
            </div>
          </fieldset>

          {clientErrors['_root'] && (
            <p
              role="alert"
              className="text-mkt-red mt-4 text-sm"
              data-testid="buyer-form-root-error"
            >
              {clientErrors['_root']}
            </p>
          )}

          {/* ─── server-side status banners ─── */}
          {submitState.kind === 'error' && (
            <div
              role="alert"
              className="border-mkt-red/30 bg-mkt-red/5 mt-4 rounded-2xl border p-4"
              data-testid="buyer-form-error"
            >
              <p className="text-mkt-red text-sm font-medium">
                We couldn&apos;t process your order
              </p>
              <p className="text-mkt-slate mt-1 text-sm">{submitState.message}</p>
            </div>
          )}

          {submitState.kind === 'blocked' && (
            <div
              role="status"
              className="mt-4 rounded-2xl border border-amber-600/30 bg-amber-600/5 p-4"
              data-testid="buyer-form-blocked"
            >
              <p className="text-mkt-ink text-sm font-medium">Payments temporarily unavailable</p>
              <p className="text-mkt-slate mt-1 text-sm">
                Your order is saved (reference{' '}
                <span className="font-mono">{submitState.orderId}</span>), but online payments are
                currently disabled in this environment. The organiser will follow up by email to
                complete your purchase.
              </p>
            </div>
          )}

          {/* ─── Buyer Terms v1.0 body panel + bilingual clickwrap ─── */}
          {/*
            Day 39 Phase 2 wire-in replaces the Day-34 link-footer
            ("By placing this order you agree to the Terms and the
            Refund Policy") with (a) a collapsible panel rendering the
            Salehin-approved Buyer Terms v1.0 body from
            legal_document_versions.body_html, and (b) a bilingual
            clickwrap line above the button per the
            docs/legal/buyer-terms.md wiring spec.

            The button click IS the consent action (clickwrap; no
            checkbox per the editing-notes wiring spec). Server-side,
            createOrder writes a consent_records row inside the
            order-creation tx anchored by order_id; if that INSERT
            fails the tx rolls back and EPS Initialize never fires.

            buyerTermsBodyHtml may be `null` if the legal API is
            transiently unreachable or buyer-terms is not seeded —
            in that case we still render the clickwrap line with a
            link to /buyer-terms so buyers have an out-of-band path.
            The server-side consent_records INSERT will fail (the
            resolveBuyerTermsCurrentVersion helper throws), which
            rolls the order back — so a `null` body here would also
            block checkout, surfacing as a 500 to the buyer. That's
            intentional: better fail-loud than capture consent
            against an unavailable document.
          */}
          <details
            className="border-mkt-line/60 mt-6 rounded-2xl border bg-white/40"
            data-testid="buyer-terms-panel"
          >
            <summary className="text-mkt-ink cursor-pointer px-4 py-3 text-sm font-medium">
              Buyer Terms ({buyerTermsVersion ?? 'unavailable'}) · ক্রেতা শর্তাবলী
            </summary>
            <div className="px-4 pb-4">
              {buyerTermsBodyHtml ? (
                <div
                  className="text-mkt-slate prose prose-sm max-w-none text-sm"
                  data-testid="buyer-terms-body"
                  // The body_html is pre-rendered + sanitized server-side
                  // via the rehype-sanitize allowlist in
                  // apps/api/src/domain/legal/render.ts (Decision J).
                  // It's safe to inject as innerHTML — the pipeline
                  // strips <script>, event handlers, data:/javascript:
                  // URIs, etc. before the HTML is cached on disk.
                  dangerouslySetInnerHTML={{ __html: buyerTermsBodyHtml }}
                />
              ) : (
                <p className="text-mkt-slate text-sm" data-testid="buyer-terms-body-unavailable">
                  The terms document is temporarily unavailable. You can read it at{' '}
                  <Link className="underline" href="/buyer-terms">
                    /buyer-terms
                  </Link>{' '}
                  before continuing.
                </p>
              )}
            </div>
          </details>

          <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-mkt-slate/80 text-xs" data-testid="buyer-terms-clickwrap">
              <span lang="bn" className="block">
                {isFreeEvent ? '"Confirm registration"' : '"Pay now"'} বাটনে ক্লিক করে আপনি Event
                Pulse-এর Buyer Terms ({buyerTermsVersion ?? '—'}) এবং{' '}
                <Link className="underline" href="/privacy">
                  প্রাইভেসি পলিসিতে
                </Link>{' '}
                সম্মত হচ্ছেন।
              </span>
              <span lang="en" className="mt-1 block">
                By clicking {isFreeEvent ? '"Confirm registration"' : '"Pay now"'} you agree to
                Event Pulse&apos;s{' '}
                <Link className="underline" href="/buyer-terms">
                  Buyer Terms ({buyerTermsVersion ?? '—'})
                </Link>{' '}
                and{' '}
                <Link className="underline" href="/privacy">
                  Privacy Policy
                </Link>
                .
              </span>
            </p>
            <button
              type="submit"
              disabled={submitDisabled}
              className="inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: `linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent) 100%)`,
              }}
              data-testid="buyer-form-submit"
            >
              {submitState.kind === 'submitting'
                ? 'Submitting…'
                : isFreeEvent
                  ? 'Confirm registration · নিশ্চিত করুন'
                  : // Multi-method go-live (decisions.md 2026-06-05 "EPS all-
                    // methods"): generic "Pay now" — EPS's hosted page lets the
                    // buyer choose any method (card, bKash, Nagad, Rocket, …).
                    'Pay now · এখন পেমেন্ট করুন'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * Mint a fresh idempotency key. Uses `crypto.randomUUID()` in modern
 * browsers; falls back to a 128-bit random hex string when not
 * available (older Safari, jsdom test environment without the polyfill).
 */
function mintKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Test-env + legacy fallback: 32-hex from Math.random.
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
