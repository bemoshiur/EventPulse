/**
 * BuyerForm component tests — Sprint 4 Day 34 Phase 1.
 *
 * Pins:
 *   - form renders + tier cards + quantity steppers
 *   - client validation (empty name, invalid email, etc.)
 *   - FREE-event happy path → success state with order ID
 *   - PRICED + ready path → window.location.assign(redirectUrl)
 *   - PRICED + STAGING_PAYMENT_BLOCK refused → sensible blocked state
 *   - server-error envelope (TIER_SOLD_OUT, INTERNAL_ERROR) → inline message
 *   - Idempotency-Key header sent on submit
 *   - double-submit-click does NOT fire two requests (button disabled in-flight)
 *   - bilingual labels (Bangla sub-labels present per R12)
 *   - axe accessibility
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BuyerForm } from './buyer-form'
import type { PublicEventTierWire, PublicEventWire } from '@/lib/public-events'

const baseEvent: PublicEventWire = {
  id: 'evt-1',
  slug: 'summer-sounds-2026',
  type: 'concert',
  title: 'Summer Sounds 2026',
  titleBn: null,
  description: null,
  descriptionBn: null,
  startsAt: '2026-06-15T14:00:00.000Z',
  endsAt: '2026-06-15T17:00:00.000Z',
  timezone: 'Asia/Dhaka',
  venue: { type: 'physical', name: 'Test Hall' },
  capacity: 500,
  bannerImageUrl: null,
  visibility: 'public',
  status: 'on_sale',
  publishedAt: '2026-05-01T00:00:00.000Z',
}

const paidTier: PublicEventTierWire = {
  id: 'tier-paid',
  name: 'General',
  description: 'Standing',
  pricePaisa: '100000', // 1,000.00 BDT
  capacity: 100,
  sold: 25,
  salesStartAt: null,
  salesEndAt: null,
  isComplimentary: false,
  sortOrder: 0,
}

const freeTier: PublicEventTierWire = {
  id: 'tier-free',
  name: 'RSVP',
  description: 'Free entry',
  pricePaisa: '0',
  capacity: 100,
  sold: 0,
  salesStartAt: null,
  salesEndAt: null,
  isComplimentary: true,
  sortOrder: 0,
}

// ─── fetch mocking helper ─────────────────────────────────────────

type FetchSpy = ReturnType<typeof vi.fn>

function mockFetchOnce(body: unknown, init: { status?: number; ok?: boolean } = {}): FetchSpy {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 201,
        headers: { 'content-type': 'application/json' },
      }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(global as any).fetch = spy
  return spy
}

beforeEach(() => {
  // Ensure crypto.randomUUID is callable in jsdom; if not, our mintKey() fallback runs.
})

afterEach(() => {
  vi.restoreAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch
})

// ─── tests ────────────────────────────────────────────────────────

describe('<BuyerForm>', () => {
  it('renders tier card + quantity stepper + buyer fields', () => {
    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    expect(screen.getByTestId('tier-card-tier-paid')).toBeInTheDocument()
    expect(screen.getByTestId('qty-input-tier-paid')).toBeInTheDocument()
    expect(screen.getByTestId('buyer-name')).toBeInTheDocument()
    expect(screen.getByTestId('buyer-email')).toBeInTheDocument()
    expect(screen.getByTestId('buyer-phone')).toBeInTheDocument()
    expect(screen.getByTestId('buyer-form-submit')).toBeInTheDocument()
  })

  it('renders bilingual labels (R12) — English + Bangla sub-labels', () => {
    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    // Heading has Bangla "টিকিট" alongside English "Tickets".
    expect(screen.getByText('· টিকিট')).toBeInTheDocument()
    // Buyer fieldset legend has Bangla.
    expect(screen.getByText('· আপনার তথ্য')).toBeInTheDocument()
  })

  // v1.0 single-method launch honest framing per decisions.md 2026-05-31
  // "EPS fee-model structural decision — Option 3 CHOSEN" + Day 38 Phase 3.
  // Pin both the bKash-only notice AND the submit button label so a future
  // edit that silently regresses to multi-method-implying copy surfaces in
  // the test diff (which is the operator review surface).
  describe('v1.0 single-method launch — bKash-only honest framing', () => {
    it('paid tier renders the bKash-only notice (bilingual) below subtotal', async () => {
      const user = userEvent.setup()
      render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
      const qty = screen.getByTestId('qty-input-tier-paid') as HTMLInputElement
      await user.clear(qty)
      await user.type(qty, '1')
      // The notice is gated on `!isFreeEvent && hasAnyTier` — paid tier
      // selected → notice visible.
      const notice = screen.getByTestId('payment-methods-notice')
      expect(notice).toBeInTheDocument()
      expect(notice.textContent).toMatch(/cards, bKash, Nagad, Rocket/)
      // Bilingual per R12: Bengali line present alongside English.
      expect(notice.textContent).toMatch(/বিকাশ, নগদ, রকেট/)
    })

    it('paid-tier submit button reads "Pay now · এখন পেমেন্ট করুন"', async () => {
      const user = userEvent.setup()
      render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
      const qty = screen.getByTestId('qty-input-tier-paid') as HTMLInputElement
      await user.clear(qty)
      await user.type(qty, '1')
      const btn = screen.getByTestId('buyer-form-submit')
      // Generic multi-method label (EPS hosted page offers all methods).
      expect(btn.textContent).toBe('Pay now · এখন পেমেন্ট করুন')
    })

    it('free-event keeps the registration-confirmation label (NOT a bKash label)', async () => {
      // Free events do NOT route through EPS / bKash — the calculator
      // returns all zeros and the order is born paid. The label must
      // stay neutral; bumping it to a bKash label would mislead. Note
      // `isFreeEvent` requires a tier qty > 0 (hasAnyTier branch); the
      // button defaults to the paid-tier label when nothing's selected.
      const user = userEvent.setup()
      render(<BuyerForm event={baseEvent} tiers={[freeTier]} />)
      const qty = screen.getByTestId('qty-input-tier-free') as HTMLInputElement
      await user.clear(qty)
      await user.type(qty, '1')
      const btn = screen.getByTestId('buyer-form-submit')
      expect(btn.textContent).toBe('Confirm registration · নিশ্চিত করুন')
    })

    it('free-event does NOT render the payment-methods notice', async () => {
      const user = userEvent.setup()
      render(<BuyerForm event={baseEvent} tiers={[freeTier]} />)
      const qty = screen.getByTestId('qty-input-tier-free') as HTMLInputElement
      await user.clear(qty)
      await user.type(qty, '1')
      // The notice is gated on `!isFreeEvent && hasAnyTier`; with a
      // free-tier qty > 0, `isFreeEvent` is true → notice is suppressed.
      expect(screen.queryByTestId('payment-methods-notice')).not.toBeInTheDocument()
    })
  })

  it('disables submit when no tier quantity selected', () => {
    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    expect(screen.getByTestId('buyer-form-submit')).toBeDisabled()
  })

  it('enables submit once a tier qty > 0 is set', async () => {
    const user = userEvent.setup()
    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    const qty = screen.getByTestId('qty-input-tier-paid') as HTMLInputElement
    await user.clear(qty)
    await user.type(qty, '2')
    expect(screen.getByTestId('buyer-form-submit')).not.toBeDisabled()
  })

  it('client validation: rejects empty name + invalid email + short phone', async () => {
    const user = userEvent.setup()
    const fetchSpy = mockFetchOnce({})
    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    const qty = screen.getByTestId('qty-input-tier-paid') as HTMLInputElement
    await user.clear(qty)
    await user.type(qty, '1')
    await user.type(screen.getByTestId('buyer-email'), 'not-an-email')
    await user.type(screen.getByTestId('buyer-phone'), '12')
    await user.click(screen.getByTestId('buyer-form-submit'))
    await screen.findByText('Name is required.')
    expect(screen.getByText('Enter a valid email.')).toBeInTheDocument()
    expect(screen.getByText('Phone is too short.')).toBeInTheDocument()
    // Fetch must NOT fire when client validation fails.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('FREE-event happy path → success state with order ID', async () => {
    const user = userEvent.setup()
    mockFetchOnce({
      data: {
        orderId: 'ord-free-123',
        merchantTransactionId: 'TXN-FREE-123',
        status: 'paid',
        paymentInitState: 'free',
        redirectUrl: null,
        fees: {
          subtotalPaisa: '0',
          platformFeePaisa: '0',
          epsFeePaisa: '0',
          buyerTotalPaisa: '0',
          organiserNetPaisa: '0',
          platformRevenuePaisa: '0',
        },
      },
    })
    render(<BuyerForm event={baseEvent} tiers={[freeTier]} />)
    await user.clear(screen.getByTestId('qty-input-tier-free'))
    await user.type(screen.getByTestId('qty-input-tier-free'), '1')
    await user.type(screen.getByTestId('buyer-name'), 'Aminul Islam')
    await user.type(screen.getByTestId('buyer-email'), 'aminul@example.com')
    await user.type(screen.getByTestId('buyer-phone'), '01711-123456')
    await user.click(screen.getByTestId('buyer-form-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('buyer-form-success-free')).toBeInTheDocument()
    })
    expect(screen.getByTestId('success-order-id')).toHaveTextContent('ord-free-123')
  })

  it('PRICED + ready path → window.location.assign(redirectUrl)', async () => {
    const user = userEvent.setup()
    mockFetchOnce({
      data: {
        orderId: 'ord-paid-456',
        merchantTransactionId: 'TXN-PAID-456',
        status: 'awaiting_payment',
        paymentInitState: 'ready',
        redirectUrl: 'https://eps.example/pay/abc',
        fees: {
          subtotalPaisa: '100000',
          platformFeePaisa: '250',
          epsFeePaisa: '2500',
          buyerTotalPaisa: '102750',
          organiserNetPaisa: '100000',
          platformRevenuePaisa: '250',
        },
      },
    })
    const assignSpy = vi.fn()
    // Replace window.location.assign without redefining the whole location object.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignSpy },
    })

    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    await user.clear(screen.getByTestId('qty-input-tier-paid'))
    await user.type(screen.getByTestId('qty-input-tier-paid'), '1')
    await user.type(screen.getByTestId('buyer-name'), 'Rahim')
    await user.type(screen.getByTestId('buyer-email'), 'rahim@example.com')
    await user.type(screen.getByTestId('buyer-phone'), '01711000000')
    await user.click(screen.getByTestId('buyer-form-submit'))
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('https://eps.example/pay/abc')
    })
  })

  it('PRICED + STAGING_PAYMENT_BLOCK → sensible blocked state (no crash)', async () => {
    const user = userEvent.setup()
    mockFetchOnce({
      data: {
        orderId: 'ord-blocked-789',
        merchantTransactionId: 'TXN-BLOCK-789',
        status: 'awaiting_payment',
        paymentInitState: 'blocked',
        redirectUrl: null,
        fees: {
          subtotalPaisa: '100000',
          platformFeePaisa: '250',
          epsFeePaisa: '2500',
          buyerTotalPaisa: '102750',
          organiserNetPaisa: '100000',
          platformRevenuePaisa: '250',
        },
      },
    })
    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    await user.clear(screen.getByTestId('qty-input-tier-paid'))
    await user.type(screen.getByTestId('qty-input-tier-paid'), '1')
    await user.type(screen.getByTestId('buyer-name'), 'Karim')
    await user.type(screen.getByTestId('buyer-email'), 'karim@example.com')
    await user.type(screen.getByTestId('buyer-phone'), '01700000000')
    await user.click(screen.getByTestId('buyer-form-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('buyer-form-blocked')).toBeInTheDocument()
    })
    expect(screen.getByText(/Payments temporarily unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/ord-blocked-789/)).toBeInTheDocument()
  })

  it('TIER_SOLD_OUT 409 → inline error message', async () => {
    const user = userEvent.setup()
    mockFetchOnce(
      { error: { code: 'TIER_SOLD_OUT', message: 'tier is sold out' } },
      { status: 409 },
    )
    render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    await user.clear(screen.getByTestId('qty-input-tier-paid'))
    await user.type(screen.getByTestId('qty-input-tier-paid'), '2')
    await user.type(screen.getByTestId('buyer-name'), 'Sara')
    await user.type(screen.getByTestId('buyer-email'), 'sara@example.com')
    await user.type(screen.getByTestId('buyer-phone'), '01700000001')
    await user.click(screen.getByTestId('buyer-form-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('buyer-form-error')).toBeInTheDocument()
    })
    expect(screen.getByText('tier is sold out')).toBeInTheDocument()
  })

  it('sends Idempotency-Key header on every submit', async () => {
    const user = userEvent.setup()
    const fetchSpy = mockFetchOnce({
      data: {
        orderId: 'ord-X',
        merchantTransactionId: 'TXN-X',
        status: 'paid',
        paymentInitState: 'free',
        redirectUrl: null,
        fees: {
          subtotalPaisa: '0',
          platformFeePaisa: '0',
          epsFeePaisa: '0',
          buyerTotalPaisa: '0',
          organiserNetPaisa: '0',
          platformRevenuePaisa: '0',
        },
      },
    })
    render(<BuyerForm event={baseEvent} tiers={[freeTier]} />)
    await user.clear(screen.getByTestId('qty-input-tier-free'))
    await user.type(screen.getByTestId('qty-input-tier-free'), '1')
    await user.type(screen.getByTestId('buyer-name'), 'Test')
    await user.type(screen.getByTestId('buyer-email'), 'test@example.com')
    await user.type(screen.getByTestId('buyer-phone'), '01700000002')
    await user.click(screen.getByTestId('buyer-form-submit'))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const key = headers['Idempotency-Key']
    expect(key).toBeTruthy()
    expect(typeof key).toBe('string')
    expect(key!.length).toBeGreaterThan(8)
  })

  it('double-submit-click does NOT fire two requests (button disabled in-flight)', async () => {
    const user = userEvent.setup()
    // Slow response so the button stays "submitting" long enough to test
    // a re-click cannot fire a second fetch.
    const fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(
                  JSON.stringify({
                    data: {
                      orderId: 'ord-slow',
                      merchantTransactionId: 'TXN-SLOW',
                      status: 'paid',
                      paymentInitState: 'free',
                      redirectUrl: null,
                      fees: {
                        subtotalPaisa: '0',
                        platformFeePaisa: '0',
                        epsFeePaisa: '0',
                        buyerTotalPaisa: '0',
                        organiserNetPaisa: '0',
                        platformRevenuePaisa: '0',
                      },
                    },
                  }),
                  { status: 201, headers: { 'content-type': 'application/json' } },
                ),
              ),
            100,
          ),
        ),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = fetchSpy

    render(<BuyerForm event={baseEvent} tiers={[freeTier]} />)
    await user.clear(screen.getByTestId('qty-input-tier-free'))
    await user.type(screen.getByTestId('qty-input-tier-free'), '1')
    await user.type(screen.getByTestId('buyer-name'), 'Slow')
    await user.type(screen.getByTestId('buyer-email'), 'slow@example.com')
    await user.type(screen.getByTestId('buyer-phone'), '01700000003')
    const submit = screen.getByTestId('buyer-form-submit')
    await user.click(submit)
    // Submit button now shows "Submitting…" + is disabled. Try clicking again.
    expect(submit).toBeDisabled()
    await user.click(submit)
    await waitFor(() => {
      expect(screen.getByTestId('buyer-form-success-free')).toBeInTheDocument()
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('has no axe accessibility violations (with form)', async () => {
    const { container } = render(<BuyerForm event={baseEvent} tiers={[paidTier]} />)
    expect(await axe(container)).toHaveNoViolations()
  })

  // ──────────────────────────────────────────────────────────────────
  // Day 39 Phase 2 — Buyer Terms v1.0 clickwrap wire-in.
  // ──────────────────────────────────────────────────────────────────
  describe('Buyer Terms v1.0 clickwrap (Day 39 Phase 2)', () => {
    const BODY_HTML = '<h2>Buyer Terms Body</h2><p>SALEHIN_APPROVED_MARKER content goes here.</p>'

    it('Day-34 link-footer text is GONE', () => {
      render(
        <BuyerForm
          event={baseEvent}
          tiers={[paidTier]}
          buyerTermsBodyHtml={BODY_HTML}
          buyerTermsVersion="v1.0"
        />,
      )
      // The exact Day-34 footer phrasing must not appear anywhere.
      expect(screen.queryByText(/By placing this order you agree to the/i)).toBeNull()
    })

    it('renders the body_html panel (paid event) with the Salehin-approved marker', () => {
      render(
        <BuyerForm
          event={baseEvent}
          tiers={[paidTier]}
          buyerTermsBodyHtml={BODY_HTML}
          buyerTermsVersion="v1.0"
        />,
      )
      const panel = screen.getByTestId('buyer-terms-panel')
      expect(panel).toBeInTheDocument()
      const body = screen.getByTestId('buyer-terms-body')
      expect(body.innerHTML).toContain('SALEHIN_APPROVED_MARKER')
      expect(body.innerHTML).toContain('<h2>')
      // Fallback message should NOT be present when body is provided.
      expect(screen.queryByTestId('buyer-terms-body-unavailable')).toBeNull()
    })

    it('renders fallback panel when buyerTermsBodyHtml is null', () => {
      render(
        <BuyerForm
          event={baseEvent}
          tiers={[paidTier]}
          buyerTermsBodyHtml={null}
          buyerTermsVersion={null}
        />,
      )
      const panel = screen.getByTestId('buyer-terms-panel')
      expect(panel).toBeInTheDocument()
      const fallback = screen.getByTestId('buyer-terms-body-unavailable')
      expect(fallback).toBeInTheDocument()
      expect(fallback.textContent).toMatch(/temporarily unavailable/i)
      expect(screen.queryByTestId('buyer-terms-body')).toBeNull()
    })

    it('bilingual clickwrap line names the version + button label (paid → "Pay now")', () => {
      render(
        <BuyerForm
          event={baseEvent}
          tiers={[paidTier]}
          buyerTermsBodyHtml={BODY_HTML}
          buyerTermsVersion="v1.0"
        />,
      )
      const clickwrap = screen.getByTestId('buyer-terms-clickwrap')
      expect(clickwrap.textContent).toContain('Pay now')
      expect(clickwrap.textContent).toContain('v1.0')
      // BN parallel present (canonical "Buyer Terms" header + clickwrap phrasing).
      expect(clickwrap.textContent).toMatch(/সম্মত হচ্ছেন/u)
    })

    it('bilingual clickwrap line names the FREE-event button label ("Confirm registration") once a free tier is selected', async () => {
      const user = userEvent.setup()
      render(
        <BuyerForm
          event={baseEvent}
          tiers={[freeTier]}
          buyerTermsBodyHtml={BODY_HTML}
          buyerTermsVersion="v1.0"
        />,
      )
      // isFreeEvent requires hasAnyTier && previewSubtotalPaisa === 0n;
      // need to pick a free-tier qty > 0 to land on the free branch.
      await user.clear(screen.getByTestId('qty-input-tier-free'))
      await user.type(screen.getByTestId('qty-input-tier-free'), '1')
      const clickwrap = screen.getByTestId('buyer-terms-clickwrap')
      expect(clickwrap.textContent).toContain('Confirm registration')
      expect(clickwrap.textContent).not.toContain('Pay now')
    })

    it('clickwrap line renders even when version is null (fallback dash)', () => {
      render(
        <BuyerForm
          event={baseEvent}
          tiers={[paidTier]}
          buyerTermsBodyHtml={null}
          buyerTermsVersion={null}
        />,
      )
      const clickwrap = screen.getByTestId('buyer-terms-clickwrap')
      expect(clickwrap.textContent).toContain('Pay now')
      // The dash placeholder appears in BOTH the BN and EN halves
      // when the version is unavailable — there's no version string
      // to surface.
      expect(clickwrap.textContent).toContain('—')
    })
  })
})
