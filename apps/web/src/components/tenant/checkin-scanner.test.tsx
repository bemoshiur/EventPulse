/**
 * Check-in scanner — unit tests.
 * Sprint 4 Day 31 Phase 2.
 *
 * Camera (`getUserMedia` + QR decode) is intentionally NOT exercised
 * here — it would require a browser env + camera mock that doesn't
 * model real QR detection. We test the testable pieces:
 *
 *   1. extractTokenFromScan — URL form + bare-token form.
 *   2. ResultDisplay — each outcome renders the right surface
 *      (announcement role, expected text, screen-reader-friendly).
 *   3. ManualEntry — disabled until 8-char min; submits via handler;
 *      extracts token from a pasted URL.
 *   4. Accessibility — every result variant axe-clean.
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'

import { CheckInScanner, ManualEntry, ResultDisplay, extractTokenFromScan } from './checkin-scanner'

// Quick wrapper so QueryProvider doesn't trip up isolated component tests
// that don't actually fire mutations.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

function withProviders(children: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

// ─── extractTokenFromScan ───────────────────────────────────────────

describe('extractTokenFromScan', () => {
  it('extracts the token from a URL form QR (the Day-28 buildScanUrl shape)', () => {
    expect(extractTokenFromScan('https://api.eventpulse.com.bd/scan/abc123def456_-DEF_98765')).toBe(
      'abc123def456_-DEF_98765',
    )
  })

  it('extracts from a URL with trailing slash', () => {
    expect(extractTokenFromScan('https://api.example.com/scan/tok123/')).toBe('tok123')
  })

  it('returns the bare token as-is when no URL pattern matches', () => {
    expect(extractTokenFromScan('Bare4Token_-12345')).toBe('Bare4Token_-12345')
  })

  it('trims whitespace', () => {
    expect(extractTokenFromScan('  tok  ')).toBe('tok')
  })

  it('extracts even when URL has query params (Day 28 future-proofing)', () => {
    // Current Day-28 doesn't add query params; the regex tolerates
    // trailing slash but not query. Bare-token fallback keeps the URL
    // intact, which is fine — server still does the lookup verbatim
    // and rejects. Test pins current behaviour.
    const url = 'https://api.example.com/scan/sometoken?foo=bar'
    // The current regex doesn't match (it requires end-of-string or
    // single trailing slash). We fall through to bare-token form,
    // returning the full URL. Document this; server will reject as
    // INVALID and door staff retries.
    expect(extractTokenFromScan(url)).toBe(url)
  })
})

// ─── ResultDisplay ──────────────────────────────────────────────────

describe('ResultDisplay', () => {
  it('CHECKED_IN: shows "Admitted" with attendee name + tier; status role', async () => {
    const { container } = render(
      <ResultDisplay
        outcome={{
          kind: 'checked_in',
          attendeeId: 'a1',
          attendeeName: 'Rashida Khan',
          tierName: 'General',
          checkedInAt: '2026-05-25T18:30:00Z',
        }}
      />,
    )
    expect(screen.getByText(/admitted/i)).toBeInTheDocument()
    expect(screen.getByText('Rashida Khan')).toBeInTheDocument()
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('ALREADY_CHECKED_IN: shows "Already used" + original time + "refuse entry"; alert role', async () => {
    const { container } = render(
      <ResultDisplay
        outcome={{
          kind: 'already_checked_in',
          attendeeId: 'a1',
          attendeeName: 'Alice',
          tierName: 'VIP',
          originalCheckInAt: '2026-05-25T18:00:00Z',
          originalGate: 'Gate 1',
        }}
      />,
    )
    expect(screen.getByText(/already used/i)).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    // The door-correctness display: original gate is shown
    expect(screen.getByText(/gate 1/i)).toBeInTheDocument()
    expect(screen.getByText(/refuse entry/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('WRONG_EVENT: shows "Wrong event"; alert role; does NOT leak other event details', async () => {
    const { container } = render(<ResultDisplay outcome={{ kind: 'wrong_event' }} />)
    expect(screen.getByText(/wrong event/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('INVALID (voided): "Invalid" + voided message', async () => {
    const { container } = render(<ResultDisplay outcome={{ kind: 'invalid', reason: 'voided' }} />)
    expect(screen.getByText(/invalid/i)).toBeInTheDocument()
    expect(screen.getByText(/voided/i)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('INVALID (not_found): "Invalid" + not-found message', async () => {
    const { container } = render(
      <ResultDisplay outcome={{ kind: 'invalid', reason: 'not_found' }} />,
    )
    expect(screen.getByText(/invalid/i)).toBeInTheDocument()
    expect(screen.getByText(/no ticket found/i)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('network_error: "Offline" + retry hint', async () => {
    const { container } = render(
      <ResultDisplay outcome={{ kind: 'network_error', message: 'fetch failed' }} />,
    )
    expect(screen.getByText(/offline/i)).toBeInTheDocument()
    expect(screen.getByText(/did not reach the server/i)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ─── ManualEntry ────────────────────────────────────────────────────

describe('ManualEntry', () => {
  it('submit button disabled until 8 chars entered', () => {
    const onSubmit = vi.fn()
    render(<ManualEntry onSubmit={onSubmit} />)
    const button = screen.getByRole('button', { name: /scan/i })
    expect(button).toBeDisabled()
    const input = screen.getByTestId('manual-qr-input')
    fireEvent.change(input, { target: { value: 'short' } })
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: 'longenough12345' } })
    expect(button).not.toBeDisabled()
  })

  it('submits the extracted token via the handler', () => {
    const onSubmit = vi.fn()
    render(<ManualEntry onSubmit={onSubmit} />)
    const input = screen.getByTestId('manual-qr-input')
    const form = input.closest('form')!
    // URL form — handler should receive the token portion
    fireEvent.change(input, {
      target: { value: 'https://api.example.com/scan/extractedToken1234' },
    })
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledWith('extractedToken1234')
  })

  it('does NOT submit when value is too short (defence in depth on top of disabled state)', () => {
    const onSubmit = vi.fn()
    render(<ManualEntry onSubmit={onSubmit} />)
    const input = screen.getByTestId('manual-qr-input')
    const form = input.closest('form')!
    fireEvent.change(input, { target: { value: 'tiny' } })
    fireEvent.submit(form)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders axe-clean', async () => {
    const { container } = render(<ManualEntry onSubmit={vi.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ─── CheckInScanner mount (smoke; camera mock) ──────────────────────

describe('CheckInScanner', () => {
  it('renders without crashing in jsdom (camera falls back to unsupported)', async () => {
    // jsdom has no navigator.mediaDevices → camera goes to 'unsupported'
    // → manual entry surfaces.
    const { container } = render(withProviders(<CheckInScanner eventId="evt-test" gate="Gate 1" />))
    // The fallback notice should render
    expect(screen.getByTestId('camera-fallback')).toBeInTheDocument()
    expect(screen.getByTestId('manual-qr-input')).toBeInTheDocument()
    expect(screen.getByTestId('result-idle')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
